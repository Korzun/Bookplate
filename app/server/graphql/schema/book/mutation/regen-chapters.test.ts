import { encodeGlobalID } from '@pothos/plugin-relay';

import { BookHashCollisionError } from '../../../../services/book-store';
import { createHarness, type Harness } from '../../../test-util';
import { rawBookId, seedEditableBook } from './test-helpers';

vi.mock('../../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
  vi.clearAllMocks();
});

const BOOK_ID = 'a'.repeat(32);
const OTHER_BOOK_ID = 'b'.repeat(32);

const MUTATION = `
  mutation RegenChapters($input: BookRegenChaptersInput!) {
    bookRegenChapters(input: $input) {
      __typename
      ... on BookRegenChaptersPayload {
        book { id title }
      }
      ... on BookNotValidatedError {
        message
        validation { valid }
      }
      ... on BookHashCollisionError {
        message
        collidingBook { id title }
      }
    }
  }
`;

const titleOf = async (userId: string, id: string): Promise<string | null> =>
  (await harness.prisma.book.findUnique({ where: { userId_id: { userId, id } } }))?.title ?? null;

// Computed the same way the resolver decodes it — the independent check that
// the input `id` is a real, dereferenceable `Book` global ID (mirrors
// `delete.test.ts`'s `bookGlobalId`).
const bookGlobalId = (userId: string, id: string): string =>
  encodeGlobalID('Book', JSON.stringify([userId, id]));

describe('Mutation.bookRegenChapters', () => {
  it('regenerates chapters for the viewer’s own valid book and returns the updated Book', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Regen Me');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID) } },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookRegenChapters as { __typename: string; book: { title: string } };
    expect(data.__typename).toBe('BookRegenChaptersPayload');
    expect(data.book.title).toBe('Regen Me');
  });

  it('returns BookNotValidatedError and does not re-import when the book has never been validated', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Never Validated', {
      valid: null,
    });
    const spy = vi.spyOn(harness.stores.book, 'reimportBook');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID) } },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookRegenChapters as { __typename: string; validation: unknown };
    expect(data.__typename).toBe('BookNotValidatedError');
    expect(data.validation).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns BookNotValidatedError and does not re-import when the book failed validation', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Failed Validation', {
      valid: false,
    });
    const spy = vi.spyOn(harness.stores.book, 'reimportBook');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID) } },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookRegenChapters as { __typename: string };
    expect(data.__typename).toBe('BookNotValidatedError');
    expect(spy).not.toHaveBeenCalled();
    expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Failed Validation');
  });

  it('resolves to null when the book does not exist for the resolved owner', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, 'no-such-book') } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookRegenChapters).toBeNull();
  });

  it('refuses one user regenerating another user’s book, and leaves the row unchanged', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Alice’s Title');

    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID) } },
    });

    // Victim-row assertion first — see update-metadata.test.ts's identical
    // ordering rationale (a probe that merely weakens the auth guard stops
    // at the first failing assertion).
    expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Alice’s Title');
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.bookRegenChapters ?? null).toBeNull();
  });

  it('lets an admin regenerate a named user’s book (content assertion, not just no-error)', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Admin Target');

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID) } },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookRegenChapters as {
      book: { id: string; title: string };
    };
    expect(data.book.title).toBe('Admin Target');
    // Content assertion, read directly off alice's row under her own userId
    // (never the admin's, which has no library/userId at all) — proves the
    // write landed in her library rather than being lost or misfiled. Decoded
    // via `rawBookId`, not compared to the input `BOOK_ID` constant directly:
    // `reimportBook` can re-fingerprint the file (see `regen-chapters.ts`'s
    // doc comment on `BookRegenChaptersPayload.book`), so the response's own
    // id — not the id sent — is what identifies the row to look up.
    expect(await titleOf(harness.aliceOwner.userId, rawBookId(data.book.id))).toBe('Admin Target');
  });

  it('returns BookHashCollisionError, owner-scoped to the target user, when the new fingerprint collides', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Alice Book A');
    await seedEditableBook(harness, harness.aliceOwner, OTHER_BOOK_ID, 'Alice Book B');

    vi.spyOn(harness.stores.book, 'reimportBook').mockRejectedValueOnce(
      new BookHashCollisionError(OTHER_BOOK_ID)
    );

    // Admin-driven, deliberately — same rationale as update-metadata.test.ts's
    // identical case: an admin viewer has no library of its own, so a
    // re-derived-from-viewer owner bug would fail outright here instead of
    // quietly resolving the wrong user's book.
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID) } },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookRegenChapters as {
      __typename: string;
      collidingBook: { id: string; title: string };
    };
    expect(data.__typename).toBe('BookHashCollisionError');
    // The colliding book is an existing, untouched row (never re-imported),
    // so its id is exactly the raw `OTHER_BOOK_ID` it was seeded under —
    // asserted via the encoded global id, not a same-object `bookId` field.
    expect(data.collidingBook).toEqual({
      id: bookGlobalId(harness.aliceOwner.userId, OTHER_BOOK_ID),
      title: 'Alice Book B',
    });
    expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Alice Book A');
  });

  it('resolves to null for an admin when the encoded owner does not exist', async () => {
    // Well-formed Book gid whose decoded userId names no real user, only
    // reachable past `authScopes` for an admin viewer — see `validate.test.
    // ts`'s identical case.
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { id: bookGlobalId('no-such-user', BOOK_ID) } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookRegenChapters).toBeNull();
  });

  it('surfaces the untyped re-import failure and leaves the row unchanged when the store returns no book', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Untouched On Failure');
    vi.spyOn(harness.stores.book, 'reimportBook').mockResolvedValueOnce(null);

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID) } },
    });

    expect(result.errors?.[0]?.message).toMatch(/Failed to re-import book/);
    expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Untouched On Failure');
  });
});
