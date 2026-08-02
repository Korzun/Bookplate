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

  it('resolves to null for an admin when the encoded owner does not exist', async () => {
    // Covers `validate.ts`'s `if (owner === null) return null;` branch — a
    // well-formed Book gid whose decoded userId names no real user. Only
    // reachable past `authScopes` for an admin viewer (a non-admin fails
    // `ownerOf` first, same as the malformed-id case above), and review
    // proved it was otherwise untested in this file (replacing the guarded
    // return with a throw left the suite green). Also restores, in the new
    // input's terms, the assertion the old two-argument shape's "refuses a
    // User global ID that names no user" test used to carry.
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { id: bookGlobalId('no-such-user', BOOK_ID) } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookValidate).toBeNull();
  });

  // Arg-layer rejection classes (malformed / wrong-type) are exercised ONCE,
  // here, on this representative mutation — per the plan, not duplicated on
  // every book mutation the pattern is later applied to: the relay arg
  // mapper that does the rejecting is shared machinery, not per-field logic.
  it('rejects a wrong-type global id (Series) before the resolver runs', async () => {
    // Deliberately a `Series`-typed id whose LOCAL part is otherwise a
    // well-formed Book compound id (`[alice.userId, BOOK_ID]`) — not
    // `seedNodeFor('Series')`'s plain `seed-series-1` local id, which
    // `parseCompoundId` would reject on its own. That earlier version made
    // this test pass for the wrong reason: authScopes' own
    // `parseCompoundId(...) === null → NO_MATCH_USER_ID → FORBIDDEN` path
    // (proven by review: deleting `for: book` from validate.ts still failed
    // this test, but only via that fallback, not via the arg-layer rejection
    // under test) would have produced the same observable shape even with no
    // typename enforcement at all. With a local id that DOES parse, a bypass
    // of `for: book` would sail through `authScopes` (alice is the decoded
    // owner) and reach the resolver's `getBookById` call — so the spy below
    // is now load-bearing, not vacuous.
    const wrongTypeGlobalId = encodeGlobalID(
      'Series',
      JSON.stringify([harness.aliceOwner.userId, BOOK_ID])
    );
    // Independent proof the resolver body never executes, not just that the
    // response shape looks like it didn't: the resolver's third store call
    // (after `parseCompoundId` and `loadOwner`) is `getBookById`, so a spy on
    // it catching zero calls is direct evidence, not an inference from the
    // error message alone.
    const getBookByIdSpy = vi.spyOn(harness.stores.book, 'getBookById');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: wrongTypeGlobalId } },
    });

    // Rejected by Pothos's relay plugin's argMapper, which decodes the global
    // id against the arg's `for: book` typename before `wrapResolve` (and so
    // before `ScopeAuthPlugin`'s own wrapper) ever runs (`validate.ts:83-90`
    // traces the plugin ordering this relies on) — not GraphQL argument
    // coercion, and distinct from any value the resolver could itself
    // produce. Arg-layer errors carry no `extensions.code` (a scope-layer
    // FORBIDDEN would); that, independent of the message's exact wording, is
    // what proves this happened before `authScopes`. The field is still
    // nullable, so `data.bookValidate` reads back as `null` rather than being
    // omitted — that alone wouldn't prove the resolver never ran; the
    // `extensions.code` check and the spy both do.
    expect(result.errors?.[0]?.message).toMatch(/is not of type: Book/);
    expect(result.errors?.[0]?.extensions?.code).toBeUndefined();
    expect(result.data?.bookValidate ?? null).toBeNull();
    expect(getBookByIdSpy).not.toHaveBeenCalled();
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
