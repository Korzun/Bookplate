import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;
const BOOK_ID = '1'.repeat(32);
const EXPIRED_BOOK_ID = '2'.repeat(32);

// Mirrored from book-store.ts:31's PENDING_FIX_TTL_MS (7 days) — inlined as a
// literal so this file does not import a private store constant, same as
// derive.test.ts's isLivePendingFix suite.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

// A genuinely-pending fix: `getPendingFixes` (book-store.ts) treats a row
// with no proposals and no undo as already resolved and deletes it on read,
// so an empty `proposals` array would make `Library.pendingFixes` correctly
// return `[]` — starving the "lists" test below of any row to find, even
// though `Book.pendingFix` (a raw relation, no such cleanup) would still see
// it. A non-empty `proposals` array keeps the fixture "pending" under both
// readings.
const PROPOSAL = {
  field: 'title',
  kind: 'replace',
  from: 'Old Title',
  to: 'New Title',
  changes: {},
};
const SEEDED_STATE_JSON = JSON.stringify({ proposals: [PROPOSAL] });

// An undo-only, no-proposals row whose `updatedAt` is well past the TTL —
// `isLivePendingFix` (derive.ts) classifies this not-live, mirroring
// `getPendingFixes`'s own delete-on-read decision for the same shape.
const EXPIRED_STATE_JSON = JSON.stringify({
  proposals: [],
  undo: { kind: 'apply', proposals: [], appliedFixes: [] },
});

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.book.create({
    data: {
      userId: harness.aliceOwner.userId,
      id: BOOK_ID,
      title: 'Needs Fixing',
      size: 1,
      mtime: 1,
      addedAt: 1,
    },
  });
  await harness.prisma.pendingFix.create({
    data: {
      userId: harness.aliceOwner.userId,
      bookId: BOOK_ID,
      fileName: 'needs-fixing.epub',
      fileSize: 2048,
      state: SEEDED_STATE_JSON,
      updatedAt: 1_700_000_000_000,
    },
  });

  await harness.prisma.book.create({
    data: {
      userId: harness.aliceOwner.userId,
      id: EXPIRED_BOOK_ID,
      title: 'Already Resolved',
      size: 1,
      mtime: 1,
      addedAt: 1,
    },
  });
  await harness.prisma.pendingFix.create({
    data: {
      userId: harness.aliceOwner.userId,
      bookId: EXPIRED_BOOK_ID,
      fileName: 'already-resolved.epub',
      fileSize: 1024,
      state: EXPIRED_STATE_JSON,
      updatedAt: Date.now() - TTL_MS - 1,
    },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

// The fields selected on every MetadataFix in the assertions below, so a
// fix's structured reading can be compared field-by-field against `PROPOSAL`
// without a client-side JSON.parse.
const METADATA_FIX_FIELDS = 'field kind from to reason fromChips toChips changes';
const STATE_SELECTION = `state {
        autoFixes { ${METADATA_FIX_FIELDS} }
        appliedFixes { ${METADATA_FIX_FIELDS} }
        proposals { ${METADATA_FIX_FIELDS} }
        undo { kind proposals { ${METADATA_FIX_FIELDS} } appliedFixes { ${METADATA_FIX_FIELDS} } }
      }`;

describe('PendingFix', () => {
  it('exposes a pending fix on its book', async () => {
    const result = await harness.execute(
      `{ viewer { library { book(id: "${BOOK_ID}") { pendingFix { fileName fileSize ${STATE_SELECTION} } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const pendingFix = (
      result.data as {
        viewer: {
          library: {
            book: {
              pendingFix: {
                fileName: string;
                fileSize: number;
                state: {
                  autoFixes: unknown[];
                  appliedFixes: unknown[];
                  proposals: unknown[];
                  undo: unknown;
                };
              };
            };
          };
        };
      }
    ).viewer.library.book.pendingFix;
    expect(pendingFix).toMatchObject({ fileName: 'needs-fixing.epub', fileSize: 2048 });
    // OLD (before this task): `Book.pendingFix.state` was the raw stored
    // JSON string, and the test parsed it client-side:
    //   expect(JSON.parse(pendingFix.state)).toEqual({ proposals: [PROPOSAL] });
    // NEW: `state` is the typed `PendingFixState`, selected field by field —
    // the same seeded `PROPOSAL` still pins the reading, now with the
    // parser's defaults (`autoFixes`/`appliedFixes`: `[]`, `undo`: `null`,
    // `reason`/`fromChips`/`toChips`: `null`) made explicit rather than
    // implicit in an unparsed string.
    expect(pendingFix.state).toEqual({
      autoFixes: [],
      appliedFixes: [],
      proposals: [{ ...PROPOSAL, reason: null, fromChips: null, toChips: null }],
      undo: null,
    });
  });

  it('lists the library pending fixes', async () => {
    // OLD (before this task, against the deleted `PendingFixSummary`):
    //   const result = await harness.execute(
    //     '{ viewer { library { pendingFixes { fileName state } } } }',
    //     { viewer: harness.aliceViewer }
    //   );
    //   ...
    //   expect(JSON.parse(pendingFixes[0]?.state ?? '')).toEqual({
    //     autoFixes: [], appliedFixes: [], proposals: [PROPOSAL], undo: null,
    //   });
    // NEW: `Library.pendingFixes` now resolves the merged `PendingFix` type,
    // whose `state` is already the typed `PendingFixState` — selected field
    // by field, same as `Book.pendingFix` above, rather than parsed
    // client-side from a JSON string. The expired fixture seeded in
    // `beforeEach` (`EXPIRED_BOOK_ID`) is excluded here — `toHaveLength(1)`
    // pins that the TTL-expired row does not appear alongside the live one.
    const result = await harness.execute(
      `{ viewer { library { pendingFixes { fileName ${STATE_SELECTION} } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const pendingFixes = (
      result.data as {
        viewer: {
          library: {
            pendingFixes: {
              fileName: string;
              state: {
                autoFixes: unknown[];
                appliedFixes: unknown[];
                proposals: unknown[];
                undo: unknown;
              };
            }[];
          };
        };
      }
    ).viewer.library.pendingFixes;
    expect(pendingFixes).toHaveLength(1);
    expect(pendingFixes[0]?.fileName).toBe('needs-fixing.epub');
    // `Library.pendingFixes[].state` now shares the exact same resolver as
    // `Book.pendingFix.state` (both go through `parsePendingFixState` on a
    // real `PendingFix` row) — parsing to the same `proposals` content as the
    // raw column, confirming the two readings agree on what `state` means.
    expect(pendingFixes[0]?.state).toEqual({
      autoFixes: [],
      appliedFixes: [],
      proposals: [{ ...PROPOSAL, reason: null, fromChips: null, toChips: null }],
      undo: null,
    });
  });

  // Without this link `Library.pendingFixes` is not navigable — a client
  // would have to make a second round trip keyed on `bookId` just to render
  // which book a fix belongs to.
  it('links each fix to its book', async () => {
    // OLD (before this task, against the deleted `PendingFixSummary`, which
    // carried its own `bookId: String!` field):
    //   '{ viewer { library { pendingFixes { bookId book { bookId title } } } } }'
    //   ...
    //   expect(fixes[0]?.book.bookId).toBe(fixes[0]?.bookId);
    // NEW: the merged `PendingFix` gained `book: Book!` (a plain Prisma
    // relation) but did NOT gain a `bookId` field of its own — the review
    // gate for this task is that `PendingFix` gains exactly `book: Book!` and
    // nothing else. So the assertion below anchors on the seeded `BOOK_ID`
    // constant directly rather than a same-object `bookId` selection.
    const result = await harness.execute(
      '{ viewer { library { pendingFixes { book { bookId title } } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const fixes = (
      result.data as {
        viewer: {
          library: {
            pendingFixes: { book: { bookId: string; title: string } }[];
          };
        };
      }
    ).viewer.library.pendingFixes;
    expect(fixes[0]?.book).toEqual({ bookId: BOOK_ID, title: 'Needs Fixing' });
  });

  // Book ids are content hashes, so bob can hold a book with the identical id.
  // The link must resolve the OWNER's copy: the row carries the owner's
  // `userId` (it is a real Prisma row, not a DTO reattached with the owner
  // after the fact), so the relation must not accidentally cross tenants.
  it("links to the owner's copy when two users share a book id", async () => {
    await harness.prisma.book.create({
      data: {
        userId: harness.bobOwner.userId,
        id: BOOK_ID,
        title: "Bob's Copy",
        size: 1,
        mtime: 1,
        addedAt: 1,
      },
    });

    const result = await harness.execute(
      '{ viewer { library { pendingFixes { book { title } } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { pendingFixes: { book: { title: string } }[] } } })
        .viewer.library.pendingFixes[0]?.book.title
    ).toBe('Needs Fixing');
  });

  it('is empty for another user', async () => {
    const result = await harness.execute('{ viewer { library { pendingFixes { fileName } } } }', {
      viewer: harness.bobViewer,
    });

    expect(
      (result.data as { viewer: { library: { pendingFixes: unknown[] } } }).viewer.library
        .pendingFixes
    ).toEqual([]);
  });

  // Discriminate-check: a self-read (the test above) cannot tell "reads the
  // owner off its parent" apart from "re-derives it from the viewer" the way
  // `library/model.test.ts`'s `readAsAdmin` does for `subjects`/`authors` —
  // the config-based admin owns no books of its own, so a resolver that
  // ignored the parent `Owner` and consulted the viewer instead would return
  // an empty list here while every self-read test above kept passing.
  // Asserts CONTENTS (the live fix's `fileName`), not just presence, and that
  // the TTL-expired fixture stays excluded under admin traversal too.
  it("reads the owner off its parent — an admin sees the target user's pending fixes", async () => {
    const result = await harness.execute(
      `query ($id: ID!) { user(id: $id) { library { pendingFixes { fileName } } } }`,
      { viewer: harness.adminViewer, variables: { id: harness.aliceGlobalId } }
    );

    expect(result.errors).toBeUndefined();
    const pendingFixes = (
      result.data as { user: { library: { pendingFixes: { fileName: string }[] } } }
    ).user.library.pendingFixes;
    expect(pendingFixes).toHaveLength(1);
    expect(pendingFixes[0]?.fileName).toBe('needs-fixing.epub');
  });

  // Integration-level companion to `derive.test.ts`'s unit-level TTL-boundary
  // coverage of `isLivePendingFix`: an undo-only row seeded well past the
  // 7-day TTL must not appear in the list. See this task's report for the
  // discriminate-check that removing the predicate from `pendingFixes`
  // (library/model.ts) makes this test fail.
  it('excludes a TTL-expired undo-only fix from the library list', async () => {
    const result = await harness.execute('{ viewer { library { pendingFixes { fileName } } } }', {
      viewer: harness.aliceViewer,
    });

    expect(result.errors).toBeUndefined();
    const fileNames = (
      result.data as { viewer: { library: { pendingFixes: { fileName: string }[] } } }
    ).viewer.library.pendingFixes.map((fix) => fix.fileName);
    expect(fileNames).not.toContain('already-resolved.epub');
  });

  // Closes the drift `Book.pendingFix`'s doc comment used to document as
  // accepted (book/model.ts): before this task, `Book.pendingFix` was a bare
  // relation with no expiry check, so it would keep returning a TTL-expired
  // fix after `Library.pendingFixes` had already stopped listing it. Now both
  // readings share `isLivePendingFix`, so the expired fixture is null here
  // too, in the same test run that proved it excluded from the list above.
  it('also nulls a TTL-expired fix on Book.pendingFix, closing the list/relation drift', async () => {
    const result = await harness.execute(
      `{ viewer { library { book(id: "${EXPIRED_BOOK_ID}") { pendingFix { fileName } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (
        result.data as {
          viewer: { library: { book: { pendingFix: { fileName: string } | null } } };
        }
      ).viewer.library.book.pendingFix
    ).toBeNull();
  });
});
