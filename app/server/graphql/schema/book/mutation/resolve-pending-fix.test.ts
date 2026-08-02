import { encodeGlobalID } from '@pothos/plugin-relay';

import { BookHashCollisionError } from '../../../../services/book-store';
import { createHarness, type Harness } from '../../../test-util';
import { EMPTY_COUNTS, seedEditableBook } from './test-helpers';

vi.mock('../../../../logger');
// assertValidEpub: pass by default — see update-metadata.test.ts's identical
// mock and rationale. Individual tests override with `mockRejectedValueOnce`.
vi.mock('../../../../services/epub-validator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/epub-validator')>();
  return {
    ...actual,
    assertValidEpub: vi.fn().mockResolvedValue({
      valid: true,
      messages: [],
      counts: { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 },
    }),
  };
});

import { assertValidEpub, EpubValidationError } from '../../../../services/epub-validator';

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
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

const TITLE_PROPOSAL = {
  field: 'title',
  kind: 'replace',
  from: 'Old Title',
  to: 'New Title',
  changes: { title: 'New Title' },
};

const SUBJECTS_SPLIT_PROPOSAL = {
  field: 'subjects',
  kind: 'subjects-split',
  from: 'Fiction/Fantasy',
  to: null,
  changes: {},
  fromChips: ['Fiction/Fantasy'],
  toChips: ['Fiction', 'Fantasy'],
};

const seedPendingFix = (
  bookId: string,
  state: { proposals?: unknown[]; undo?: unknown },
  updatedAt = Date.now()
) =>
  harness.prisma.pendingFix.create({
    data: {
      userId: harness.aliceOwner.userId,
      bookId,
      fileName: 'book.epub',
      fileSize: 1024,
      state: JSON.stringify({
        autoFixes: [],
        appliedFixes: [],
        proposals: [],
        undo: null,
        ...state,
      }),
      updatedAt,
    },
  });

const pendingFixRowFor = (bookId: string) =>
  harness.prisma.pendingFix.findUnique({
    where: { userId_bookId: { userId: harness.aliceOwner.userId, bookId } },
  });

const titleOf = async (userId: string, id: string): Promise<string | null> =>
  (await harness.prisma.book.findUnique({ where: { userId_id: { userId, id } } }))?.title ?? null;

const MUTATION = `
  mutation ResolvePendingFix($input: BookResolvePendingFixInput!) {
    bookResolvePendingFix(input: $input) {
      __typename
      ... on BookResolvePendingFixPayload {
        book { bookId title subjects pendingFix { fileName } }
      }
      ... on InvalidInputError {
        message
        issues { path message }
      }
      ... on BookNotValidatedError {
        message
        validation { valid }
      }
      ... on BookHashCollisionError {
        message
        collidingBook { bookId title }
      }
      ... on EpubValidationError {
        message
        messages { code severity message }
      }
    }
  }
`;

describe('Mutation.bookResolvePendingFix', () => {
  describe('DISMISS', () => {
    it('discards a live pending fix without touching the book', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Untouched');
      await seedPendingFix(BOOK_ID, { proposals: [TITLE_PROPOSAL] });

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: { userId: harness.aliceGlobalId, bookId: BOOK_ID, action: 'DISMISS' },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookResolvePendingFix as {
        __typename: string;
        book: { title: string; pendingFix: unknown };
      };
      expect(data.__typename).toBe('BookResolvePendingFixPayload');
      expect(data.book.title).toBe('Untouched');
      expect(data.book.pendingFix).toBeNull();
      expect(await pendingFixRowFor(BOOK_ID)).toBeNull();
    });

    it('is a harmless no-op when no pending fix row exists, mirroring REST’s unconditional DELETE', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'No Row');

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: { userId: harness.aliceGlobalId, bookId: BOOK_ID, action: 'DISMISS' },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookResolvePendingFix as { __typename: string };
      expect(data.__typename).toBe('BookResolvePendingFixPayload');
    });
  });

  describe('ACCEPT', () => {
    it('applies a live proposal’s stored changes and clears the pending fix (under the NEW post-edit book id)', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
      await seedPendingFix(BOOK_ID, { proposals: [TITLE_PROPOSAL] });

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: { userId: harness.aliceGlobalId, bookId: BOOK_ID, action: 'ACCEPT' },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookResolvePendingFix as {
        __typename: string;
        book: { bookId: string; title: string; pendingFix: unknown };
      };
      expect(data.__typename).toBe('BookResolvePendingFixPayload');
      expect(data.book.title).toBe('New Title');
      expect(data.book.pendingFix).toBeNull();
      expect(await pendingFixRowFor(data.book.bookId)).toBeNull();
      expect(await pendingFixRowFor(BOOK_ID)).toBeNull();
    });

    it('folds a subjects-split proposal via fromChips/toChips (empty `changes`), not a plain Object.assign', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Split Me');
      await harness.prisma.book.update({
        where: { userId_id: { userId: harness.aliceOwner.userId, id: BOOK_ID } },
        data: { subjects: JSON.stringify(['Fiction/Fantasy', 'Adventure']) },
      });
      await seedPendingFix(BOOK_ID, { proposals: [SUBJECTS_SPLIT_PROPOSAL] });

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: { userId: harness.aliceGlobalId, bookId: BOOK_ID, action: 'ACCEPT' },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookResolvePendingFix as {
        book: { subjects: string[] };
      };
      // The compound "Fiction/Fantasy" is replaced by its two parts;
      // "Adventure" (untouched by the split) survives. A naive
      // `Object.assign(changes, fix.changes)` over this fix's EMPTY `changes`
      // would silently drop the split entirely, leaving subjects unchanged —
      // this assertion is the seen-to-fail proof for that (see task report).
      expect(data.book.subjects.sort()).toEqual(['Adventure', 'Fantasy', 'Fiction']);
    });

    it('is a no-op (and cleans up a stale row) when the pending fix has no proposals and no undo', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'No Proposals');
      await seedPendingFix(BOOK_ID, {});
      const reimportSpy = vi.spyOn(harness.stores.book, 'reimportBook');

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: { userId: harness.aliceGlobalId, bookId: BOOK_ID, action: 'ACCEPT' },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookResolvePendingFix as { book: { title: string } };
      expect(data.book.title).toBe('No Proposals');
      expect(reimportSpy).not.toHaveBeenCalled();
      expect(await pendingFixRowFor(BOOK_ID)).toBeNull();
    });

    it('treats an EXPIRED (TTL-past) undo-only pending fix as not-live: no-op, and the stale row is cleaned up', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Expired');
      await seedPendingFix(
        BOOK_ID,
        { proposals: [], undo: { kind: 'apply', proposals: [], appliedFixes: [] } },
        Date.now() - TTL_MS - 1
      );
      const reimportSpy = vi.spyOn(harness.stores.book, 'reimportBook');

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: { userId: harness.aliceGlobalId, bookId: BOOK_ID, action: 'ACCEPT' },
        },
      });

      expect(result.errors).toBeUndefined();
      expect(reimportSpy).not.toHaveBeenCalled();
      expect(await pendingFixRowFor(BOOK_ID)).toBeNull();
    });

    it('is a no-op when no pending fix row exists at all', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Nothing To Accept');
      const reimportSpy = vi.spyOn(harness.stores.book, 'reimportBook');

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: { userId: harness.aliceGlobalId, bookId: BOOK_ID, action: 'ACCEPT' },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookResolvePendingFix as { book: { title: string } };
      expect(data.book.title).toBe('Nothing To Accept');
      expect(reimportSpy).not.toHaveBeenCalled();
    });

    it('returns BookNotValidatedError with a null validation and changes nothing when the book was never validated', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Never Validated', {
        valid: null,
      });
      await seedPendingFix(BOOK_ID, { proposals: [TITLE_PROPOSAL] });

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: { userId: harness.aliceGlobalId, bookId: BOOK_ID, action: 'ACCEPT' },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookResolvePendingFix as {
        __typename: string;
        validation: unknown;
      };
      expect(data.__typename).toBe('BookNotValidatedError');
      expect(data.validation).toBeNull();
      expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Never Validated');
      expect(await pendingFixRowFor(BOOK_ID)).not.toBeNull();
    });

    it('returns BookHashCollisionError, owner-scoped to the target user, when the edited book’s new fingerprint collides, leaving book+pendingFix unchanged', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Book A');
      await seedEditableBook(harness, harness.aliceOwner, OTHER_BOOK_ID, 'Book B');
      await seedPendingFix(BOOK_ID, { proposals: [TITLE_PROPOSAL] });
      vi.spyOn(harness.stores.book, 'reimportBook').mockRejectedValueOnce(
        new BookHashCollisionError(OTHER_BOOK_ID)
      );

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: { userId: harness.aliceGlobalId, bookId: BOOK_ID, action: 'ACCEPT' },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookResolvePendingFix as {
        __typename: string;
        collidingBook: { bookId: string; title: string };
      };
      expect(data.__typename).toBe('BookHashCollisionError');
      expect(data.collidingBook).toEqual({ bookId: OTHER_BOOK_ID, title: 'Book B' });
      expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Book A');
      expect(await pendingFixRowFor(BOOK_ID)).not.toBeNull();
    });

    it('returns EpubValidationError when the rewritten EPUB fails post-edit validation, leaving book+pendingFix unchanged', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Still Valid Pre-Edit');
      await seedPendingFix(BOOK_ID, { proposals: [TITLE_PROPOSAL] });
      (assertValidEpub as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new EpubValidationError(
          [{ id: 'RSC-005', severity: 'FATAL', message: 'unparseable' }],
          { ...EMPTY_COUNTS, FATAL: 1 },
          'ERROR'
        )
      );

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: { userId: harness.aliceGlobalId, bookId: BOOK_ID, action: 'ACCEPT' },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookResolvePendingFix as { __typename: string };
      expect(data.__typename).toBe('EpubValidationError');
      expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Still Valid Pre-Edit');
      expect(await pendingFixRowFor(BOOK_ID)).not.toBeNull();
    });
  });

  it('resolves to null when the book does not exist for the resolved owner', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { userId: harness.aliceGlobalId, bookId: 'no-such-book', action: 'DISMISS' },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookResolvePendingFix).toBeNull();
  });

  it('returns InvalidInputError for an empty bookId', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { userId: harness.aliceGlobalId, bookId: '', action: 'DISMISS' } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookResolvePendingFix).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [{ path: ['bookId'], message: 'bookId must not be empty' }],
    });
  });

  it('refuses one user resolving another user’s pending fix, and leaves it unchanged', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Alice’s Title');
    await seedPendingFix(BOOK_ID, { proposals: [TITLE_PROPOSAL] });

    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: {
        input: { userId: harness.aliceGlobalId, bookId: BOOK_ID, action: 'ACCEPT' },
      },
    });

    // Victim-row assertion first — see update-metadata.test.ts's identical
    // ordering rationale.
    expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Alice’s Title');
    expect(await pendingFixRowFor(BOOK_ID)).not.toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.bookResolvePendingFix ?? null).toBeNull();
  });

  it('lets an admin accept a named user’s pending fix (content assertion, not just no-error)', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Before Admin Accept');
    await seedPendingFix(BOOK_ID, { proposals: [TITLE_PROPOSAL] });

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: { userId: harness.aliceGlobalId, bookId: BOOK_ID, action: 'ACCEPT' },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookResolvePendingFix as { book: { bookId: string; title: string } };
    expect(data.book.title).toBe('New Title');
    // Content assertion of correct owner-scoping: read directly off alice's
    // own userId (never the admin's, which has no library/userId at all).
    expect(await titleOf(harness.aliceOwner.userId, data.book.bookId)).toBe('New Title');
  });

  it('refuses a User global ID that names no user', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: encodeGlobalID('User', 'no-such-user'),
          bookId: BOOK_ID,
          action: 'DISMISS',
        },
      },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });
});
