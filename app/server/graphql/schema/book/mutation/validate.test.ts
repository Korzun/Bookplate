import { encodeGlobalID } from '@pothos/plugin-relay';

import { createHarness, type Harness } from '../../../test-util';
import { seedEditableBook } from './test-helpers';

vi.mock('../../../../logger');
// `revalidateBook` calls the real `validateEpubReport`, which shells out to
// epubcheck — mocked here exactly like `revalidate-library.test.ts` mocks it,
// so these tests don't need a real epubcheck-passing fixture and can control
// valid/invalid outcomes per test with `mockResolvedValueOnce`.
vi.mock('../../../../services/epub-validator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/epub-validator')>();
  return {
    ...actual,
    validateEpubReport: vi.fn().mockResolvedValue({
      valid: true,
      messages: [],
      counts: { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 },
      threshold: 'ERROR',
    }),
  };
});

import { validateEpubReport } from '../../../../services/epub-validator';

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
  vi.clearAllMocks();
});

const BOOK_ID = 'a'.repeat(32);

const MUTATION = `
  mutation Validate($input: BookValidateInput!) {
    bookValidate(input: $input) {
      __typename
      ... on BookValidatePayload {
        validation {
          valid
          threshold
          messages(first: 10) { edges { node { code severity message } } }
        }
      }
    }
  }
`;

const storedValidity = async (
  owner: Harness['aliceOwner'],
  bookId: string
): Promise<boolean | null> =>
  (await harness.stores.validation.getValidation(owner, bookId))?.valid ?? null;

// Computed the same way the resolver decodes it — the independent check that
// the input `id` is a real, dereferenceable `Book` global ID, not a hand-rolled
// string (mirrors `delete.test.ts`'s `bookGlobalId`).
const bookGlobalId = (userId: string, id: string): string =>
  encodeGlobalID('Book', JSON.stringify([userId, id]));

describe('Mutation.bookValidate', () => {
  it('validates the viewer’s own book, persists the report, and returns it', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Never Validated', {
      valid: null,
    });

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID) } },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookValidate as {
      __typename: string;
      validation: { valid: boolean; threshold: string; messages: { edges: unknown[] } };
    };
    expect(data.__typename).toBe('BookValidatePayload');
    expect(data.validation.valid).toBe(true);
    expect(data.validation.threshold).toBe('ERROR');
    expect(data.validation.messages.edges).toEqual([]);
    expect(await storedValidity(harness.aliceOwner, BOOK_ID)).toBe(true);
  });

  it('returns a failing report without erroring, and persists it', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Broken Book', { valid: true });
    (validateEpubReport as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      valid: false,
      messages: [{ id: 'RSC-005', severity: 'ERROR', message: 'broken reference' }],
      counts: { FATAL: 0, ERROR: 1, WARNING: 0, INFO: 0, USAGE: 0 },
      threshold: 'ERROR',
    });

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID) } },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookValidate as {
      __typename: string;
      validation: { valid: boolean; messages: { edges: { node: { code: string } }[] } };
    };
    expect(data.__typename).toBe('BookValidatePayload');
    expect(data.validation.valid).toBe(false);
    expect(data.validation.messages.edges).toEqual([
      { node: { code: 'RSC-005', severity: 'ERROR', message: 'broken reference' } },
    ]);
    expect(await storedValidity(harness.aliceOwner, BOOK_ID)).toBe(false);
  });

  it('resolves to null when the book does not exist for the resolved owner', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, 'no-such-book') } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookValidate).toBeNull();
  });

  it('refuses one user validating another user’s book, and leaves the stored report unchanged', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Alice’s Book', { valid: false });

    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID) } },
    });

    // Victim-row assertion first (a probe that merely weakens the auth guard
    // stops at the first failing assertion) — see update-metadata.test.ts's
    // identical ordering rationale.
    expect(await storedValidity(harness.aliceOwner, BOOK_ID)).toBe(false);
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.bookValidate ?? null).toBeNull();
  });

  it('lets an admin validate a named user’s book (content assertion, not just no-error)', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Admin Target', { valid: null });
    (validateEpubReport as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      valid: false,
      messages: [{ id: 'RSC-005', severity: 'ERROR', message: 'admin-triggered finding' }],
      counts: { FATAL: 0, ERROR: 1, WARNING: 0, INFO: 0, USAGE: 0 },
      threshold: 'ERROR',
    });

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID) } },
    });

    expect(result.errors).toBeUndefined();
    // Content assertion, read directly off alice's row (never the admin's,
    // which has no library/userId at all) — proves the write landed under
    // alice specifically rather than being lost, misfiled, or silently
    // re-derived from the (library-less) admin viewer.
    const stored = await harness.stores.validation.getValidation(harness.aliceOwner, BOOK_ID);
    expect(stored?.valid).toBe(false);
    expect(stored?.messages).toMatchObject([
      { id: 'RSC-005', severity: 'ERROR', message: 'admin-triggered finding' },
    ]);
  });

  // Arg-layer rejection classes (malformed / wrong-type) are exercised ONCE,
  // here, on this representative mutation — per the plan, not duplicated on
  // every book mutation the pattern is later applied to: the relay arg
  // mapper that does the rejecting is shared machinery, not per-field logic.
  it('rejects a wrong-type global id (Series) before the resolver runs', async () => {
    const seriesGlobalId = await harness.seedNodeFor('Series');
    // Independent proof the resolver body never executes, not just that the
    // response shape looks like it didn't: if the arg-layer rejection were
    // somehow bypassed, the resolver's first store call is `loadOwner`
    // (`context.loadOwner`), so a spy on it catching zero calls is direct
    // evidence, not an inference from the error message alone.
    const loadOwnerSpy = vi.spyOn(harness.stores.book, 'getBookById');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: seriesGlobalId } },
    });

    // Rejected by Pothos's relay plugin decoding the global id against the
    // arg's `for: book` typename — a top-level error at field-argument
    // coercion, distinct from any value the resolver could itself return
    // (confirmed by the exact message shape: "is not of type: Book", the same
    // class root-auth.test.ts documents for `libraryId`). The field is still
    // nullable, so `data.bookValidate` reads back as `null` rather than being
    // omitted — that alone wouldn't prove the resolver never ran; the error
    // and the spy both do.
    expect(result.errors?.[0]?.message).toMatch(/is not of type: Book/);
    expect(result.data?.bookValidate ?? null).toBeNull();
    expect(loadOwnerSpy).not.toHaveBeenCalled();
  });

  it('refuses a malformed local id for a non-admin viewer (FORBIDDEN)', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: encodeGlobalID('Book', 'not-json') } },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.bookValidate ?? null).toBeNull();
  });

  it('resolves a malformed local id to null for an admin (no such row, not a throw)', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { id: encodeGlobalID('Book', 'not-json') } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookValidate).toBeNull();
  });
});
