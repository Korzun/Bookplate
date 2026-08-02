import { encodeGlobalID } from '@pothos/plugin-relay';

import { BookHashCollisionError } from '../../../../services/book-store';
import { createHarness, type Harness } from '../../../test-util';
import { EMPTY_COUNTS, rawBookId, seedEditableBook } from './test-helpers';

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

// `to` is a real joined string (`dedupedParts.join(', ')`,
// `metadata-issues.ts:412`), not `null` (review M-3: the original fixture's
// `to: null` was unfaithful to a real `subjects-split` issue and would have
// hidden I-2's missing `p.to !== null` filter — a subjects-split proposal IS
// actionable and must survive that filter).
const SUBJECTS_SPLIT_PROPOSAL = {
  field: 'subjects',
  kind: 'subjects-split',
  from: 'Fiction/Fantasy',
  to: 'Fiction, Fantasy',
  changes: {},
  fromChips: ['Fiction/Fantasy'],
  toChips: ['Fiction', 'Fantasy'],
};

// Advisory-only: `html-entity`/`title-is-filename` issues carry `to: null`
// and an empty `changes` (`metadata-issues.ts:229-236`, `:373-382`) — review
// I-2's "nothing actionable" case.
const ADVISORY_PROPOSAL = {
  field: 'title',
  kind: 'title-is-filename',
  from: 'book',
  to: null,
  changes: {},
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

// Computed the same way the resolver decodes it — the independent check that
// the input `id` is a real, dereferenceable `Book` global ID (mirrors
// `delete.test.ts`'s `bookGlobalId`).
const bookGlobalId = (userId: string, id: string): string =>
  encodeGlobalID('Book', JSON.stringify([userId, id]));

const MUTATION = `
  mutation ResolvePendingFix($input: BookResolvePendingFixInput!) {
    bookResolvePendingFix(input: $input) {
      __typename
      ... on BookResolvePendingFixPayload {
        book {
          id
          title
          subjects
          pendingFix {
            fileName
            state {
              proposals { field kind from to }
              appliedFixes { field kind from to }
              undo { kind proposals { field kind from to } appliedFixes { field kind from to } }
            }
          }
        }
        library { user { username } }
      }
      ... on BookNotValidatedError {
        message
        validation { valid }
      }
      ... on BookHashCollisionError {
        message
        collidingBook { id title }
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
          input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'DISMISS' },
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

    // Traced (schema-design review S1): this mutation invalidates
    // `Library.pendingFixes` (the nav badge), so the payload must carry the
    // `Library` a cache would otherwise have no way to address (its global id
    // is keyed on the owner's raw userId — not decodable from `Book` alone).
    it('carries the resolved owner’s library alongside the book', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Untouched');
      await seedPendingFix(BOOK_ID, { proposals: [TITLE_PROPOSAL] });

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'DISMISS' },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookResolvePendingFix as {
        library: { user: { username: string } };
      };
      expect(data.library.user.username).toBe('alice');
    });

    it('is a harmless no-op when no pending fix row exists, mirroring REST’s unconditional DELETE', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'No Row');

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'DISMISS' },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookResolvePendingFix as { __typename: string };
      expect(data.__typename).toBe('BookResolvePendingFixPayload');
    });
  });

  describe('ACCEPT', () => {
    // Review I-1: REST's client (`applyAllProposals` + the sync effect,
    // `use-upload-queue.ts:356-447`) leaves the `PendingFix` row ALIVE after
    // an accept — `proposals: []`, an appended `appliedFixes`, and an `undo`
    // snapshot — never deletes it. Deleting (the original, pre-review
    // behaviour) destroys a server-persisted undo affordance the client still
    // relies on. This is the seen-to-fail target for I-1 (see below).
    it('applies an actionable proposal’s stored changes (under the NEW post-edit book id) and PERSISTS a live PendingFix row — proposals cleared, appliedFixes appended, undo armed', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
      await seedPendingFix(BOOK_ID, { proposals: [TITLE_PROPOSAL] });

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'ACCEPT' },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookResolvePendingFix as {
        __typename: string;
        book: {
          id: string;
          title: string;
          pendingFix: {
            fileName: string;
            state: {
              proposals: unknown[];
              appliedFixes: { field: string; kind: string; from: string; to: string }[];
              undo: { kind: string; proposals: unknown[]; appliedFixes: unknown[] };
            };
          } | null;
        };
      };
      expect(data.__typename).toBe('BookResolvePendingFixPayload');
      expect(data.book.title).toBe('New Title');
      // The row survives — `Book.pendingFix` (TTL-gated) still sees it as
      // live, i.e. non-null, because `undo` is now set.
      expect(data.book.pendingFix).not.toBeNull();
      expect(data.book.pendingFix?.state.proposals).toEqual([]);
      expect(data.book.pendingFix?.state.appliedFixes).toEqual([
        { field: 'title', kind: 'replace', from: 'Old Title', to: 'New Title' },
      ]);
      expect(data.book.pendingFix?.state.undo).toEqual({
        kind: 'APPLY',
        proposals: [{ field: 'title', kind: 'replace', from: 'Old Title', to: 'New Title' }],
        appliedFixes: [],
      });
      // Cascaded onto the new id; the old id is dangling (no row left behind
      // under it — the FK moved the SAME row, not left a stale copy). Decoded
      // via `rawBookId`, not a same-object `bookId` field (removed).
      const persisted = await pendingFixRowFor(rawBookId(data.book.id));
      expect(persisted).not.toBeNull();
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
          input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'ACCEPT' },
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

    // Review I-2. Probe-confirmed regression this guards: an advisory-only
    // proposal (`to: null`) used to still reach `applyEpubChanges` with an
    // EMPTY `EpubChanges`, which still rebuilds/revalidates/re-imports the
    // EPUB — minting a pointless new content-hash book id for a semantic
    // no-op (the review's probe: book id churned from `aaaa…` to `0c90dab2…`
    // with no actual content change). This test pins the book id UNCHANGED.
    it('is a no-op for an advisory-only proposal (`to: null`): no EPUB rewrite, book id unchanged, row untouched', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Advisory Only');
      await seedPendingFix(BOOK_ID, { proposals: [ADVISORY_PROPOSAL] });
      const reimportSpy = vi.spyOn(harness.stores.book, 'reimportBook');
      const before = await pendingFixRowFor(BOOK_ID);

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'ACCEPT' },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookResolvePendingFix as {
        book: { id: string; title: string };
      };
      expect(data.book.id).toBe(bookGlobalId(harness.aliceOwner.userId, BOOK_ID));
      expect(data.book.title).toBe('Advisory Only');
      expect(reimportSpy).not.toHaveBeenCalled();
      // The row is left completely untouched — no write of any kind, not
      // even a re-persisted copy of the same content.
      expect(await pendingFixRowFor(BOOK_ID)).toEqual(before);
    });

    // Review I-1's mixed-batch case: an advisory-only proposal alongside an
    // actionable one. REST's client applies only the actionable one and
    // leaves the advisory one sitting in `proposals` (`applyPatch` only
    // removes the KEYS of the fixes it actually applied,
    // `use-upload-queue.ts:384-396`) — it is not silently dropped.
    it('applies only the actionable proposal in a mixed batch, leaving the advisory-only one in `proposals`', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
      await seedPendingFix(BOOK_ID, { proposals: [TITLE_PROPOSAL, ADVISORY_PROPOSAL] });

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'ACCEPT' },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookResolvePendingFix as {
        book: {
          title: string;
          pendingFix: { state: { proposals: { field: string; kind: string }[] } } | null;
        };
      };
      expect(data.book.title).toBe('New Title');
      expect(data.book.pendingFix?.state.proposals).toEqual([
        { field: 'title', kind: 'title-is-filename', from: 'book', to: null },
      ]);
    });

    // No store write of any kind (M-7: this happens before the `valid`
    // gate too, since there is nothing to write either way) — matches REST's
    // client, which does not issue a request when nothing survives its own
    // `p.to !== null` filter, and equally does not delete an
    // already-resolved or expired-undo-only row merely because ACCEPT was
    // invoked on it (only DISMISS ever deletes).
    it('is a no-op and leaves the row untouched when the pending fix has no proposals and no undo', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'No Proposals');
      await seedPendingFix(BOOK_ID, {});
      const reimportSpy = vi.spyOn(harness.stores.book, 'reimportBook');
      const before = await pendingFixRowFor(BOOK_ID);

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'ACCEPT' },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookResolvePendingFix as { book: { title: string } };
      expect(data.book.title).toBe('No Proposals');
      expect(reimportSpy).not.toHaveBeenCalled();
      expect(await pendingFixRowFor(BOOK_ID)).toEqual(before);
    });

    // Review M-2: renamed — the original title claimed this exercised TTL
    // behaviour, but the assertions are identical for a NON-expired
    // undo-only row (proposals: [] is why this is a no-op, not the TTL
    // predicate — see the resolver's own doc comment for the proof). This
    // still seeds an expired `updatedAt` so the fixture stays realistic, but
    // the test no longer claims TTL is what it is pinning.
    it('is a no-op for an undo-only pending fix with no proposals, regardless of TTL, and leaves the row untouched', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Expired');
      await seedPendingFix(
        BOOK_ID,
        { proposals: [], undo: { kind: 'apply', proposals: [], appliedFixes: [] } },
        Date.now() - TTL_MS - 1
      );
      const reimportSpy = vi.spyOn(harness.stores.book, 'reimportBook');
      const before = await pendingFixRowFor(BOOK_ID);

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'ACCEPT' },
        },
      });

      expect(result.errors).toBeUndefined();
      expect(reimportSpy).not.toHaveBeenCalled();
      expect(await pendingFixRowFor(BOOK_ID)).toEqual(before);
    });

    it('is a no-op when no pending fix row exists at all', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Nothing To Accept');
      const reimportSpy = vi.spyOn(harness.stores.book, 'reimportBook');

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'ACCEPT' },
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
          input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'ACCEPT' },
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
          input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'ACCEPT' },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookResolvePendingFix as {
        __typename: string;
        collidingBook: { id: string; title: string };
      };
      expect(data.__typename).toBe('BookHashCollisionError');
      // The colliding book is an existing, untouched row, so its id is
      // exactly the raw `OTHER_BOOK_ID` it was seeded under.
      expect(data.collidingBook).toEqual({
        id: bookGlobalId(harness.aliceOwner.userId, OTHER_BOOK_ID),
        title: 'Book B',
      });
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
          input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'ACCEPT' },
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
        input: { id: bookGlobalId(harness.aliceOwner.userId, 'no-such-book'), action: 'DISMISS' },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookResolvePendingFix).toBeNull();
  });

  it('refuses one user resolving another user’s pending fix, and leaves it unchanged', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Alice’s Title');
    await seedPendingFix(BOOK_ID, { proposals: [TITLE_PROPOSAL] });

    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: {
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'ACCEPT' },
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
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'ACCEPT' },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookResolvePendingFix as { book: { id: string; title: string } };
    expect(data.book.title).toBe('New Title');
    // Content assertion of correct owner-scoping: read directly off alice's
    // own userId (never the admin's, which has no library/userId at all).
    // Decoded via `rawBookId`, not a same-object `bookId` field (removed):
    // ACCEPT can re-fingerprint the file.
    expect(await titleOf(harness.aliceOwner.userId, rawBookId(data.book.id))).toBe('New Title');
  });

  it('resolves to null for an admin when the encoded owner does not exist', async () => {
    // Well-formed Book gid whose decoded userId names no real user, only
    // reachable past `authScopes` for an admin viewer — see `validate.test.
    // ts`'s identical case.
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: { id: bookGlobalId('no-such-user', BOOK_ID), action: 'DISMISS' },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookResolvePendingFix).toBeNull();
  });
});
