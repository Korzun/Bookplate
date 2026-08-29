import { encodeGlobalID } from '@pothos/plugin-relay';

import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;
const BOOK_ID = '1'.repeat(32);
const EXPIRED_BOOK_ID = '2'.repeat(32);

// Computed the same way the resolver decodes it — the independent check that
// a `Book.id` selection is a real, dereferenceable global ID (mirrors
// `delete.test.ts`'s `bookGlobalId`).
const bookGlobalId = (userId: string, id: string): string =>
  encodeGlobalID('Book', JSON.stringify([userId, id]));

// Mirrors `derive.ts`'s own private PENDING_FIX_TTL_MS (7 days) — inlined as
// a literal so this file does not import a private module constant, same as
// derive.test.ts's isLivePendingFix suite.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

// A genuinely-pending fix: `isLivePendingFix` (derive.ts) treats a row with
// no proposals and no undo as already resolved, so an empty `proposals` array
// would make `Library.pendingFixes` correctly return `[]` — starving the
// "lists" test below of any row to find. A non-empty `proposals` array keeps
// the fixture "pending" under every reading.
const PROPOSAL = {
  field: 'title',
  kind: 'replace',
  from: 'Old Title',
  to: 'New Title',
  changes: {},
};
const SEEDED_STATE_JSON = JSON.stringify({ proposals: [PROPOSAL] });

// An undo-only, no-proposals row whose `updatedAt` is well past the TTL —
// `isLivePendingFix` (derive.ts) classifies this not-live.
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
      `{ viewer { library { book(id: "${bookGlobalId(harness.aliceOwner.userId, BOOK_ID)}") { pendingFix { fileName fileSize ${STATE_SELECTION} } } } } }`,
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
  // would have to make a second round trip keyed on the book's raw id just to
  // render which book a fix belongs to.
  it('links each fix to its book', async () => {
    // OLD (before task 2, against the deleted `PendingFixSummary`, which
    // carried its own `bookId: String!` field):
    //   '{ viewer { library { pendingFixes { bookId book { bookId title } } } } }'
    //   ...
    //   expect(fixes[0]?.book.bookId).toBe(fixes[0]?.bookId);
    // The merged `PendingFix` gained `book: Book!` (a plain Prisma relation)
    // — and `Book.bookId` itself is gone too now (task 4's output removal
    // #1), so the assertion below anchors on the seeded `BOOK_ID` constant,
    // encoded the same way the resolver does, rather than a same-object
    // `bookId` selection.
    const result = await harness.execute(
      '{ viewer { library { pendingFixes { book { id title } } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const fixes = (
      result.data as {
        viewer: {
          library: {
            pendingFixes: { book: { id: string; title: string } }[];
          };
        };
      }
    ).viewer.library.pendingFixes;
    expect(fixes[0]?.book).toEqual({
      id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
      title: 'Needs Fixing',
    });
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

  // `PendingFix.id` must be byte-identical to the sibling `Book.id` in the
  // SAME selection (design doc §1, `BookDeletePayload.deletedId`'s exact
  // `encodeGlobalID('Book', JSON.stringify([userId, bookId]))` construction).
  it("exposes id byte-identical to its owning Book's id", async () => {
    const result = await harness.execute(
      '{ viewer { library { pendingFixes { id book { id } } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const fixes = (
      result.data as {
        viewer: { library: { pendingFixes: { id: string; book: { id: string } }[] } };
      }
    ).viewer.library.pendingFixes;
    expect(fixes).toHaveLength(1);
    expect(fixes[0]?.id).toBe(fixes[0]?.book.id);
    expect(fixes[0]?.id).toBe(bookGlobalId(harness.aliceOwner.userId, BOOK_ID));
  });

  // Admin-traversal-discriminating companion to the self-read test above: a
  // self-read (alice reading her own fix) cannot tell "the resolver reads
  // `userId`/`bookId` off the `PendingFix` row" apart from "the resolver
  // substitutes `context.viewer!.userId`" — both produce the same bytes when
  // the viewer IS the owner. The config-based admin's `userId` is `null`
  // (`test-util.ts`'s `adminViewer`), so a viewer-derived `id` would encode
  // `[null, bookId]` and diverge from the sibling `Book.id` (which correctly
  // reads the decoded target user's id). This is the seen-to-fail test for
  // this task's report.
  it('reads userId/bookId off its own row under admin traversal — id still matches the sibling Book.id', async () => {
    const result = await harness.execute(
      `query ($id: ID!) { user(id: $id) { library { pendingFixes { id book { id } } } } }`,
      { viewer: harness.adminViewer, variables: { id: harness.aliceGlobalId } }
    );

    expect(result.errors).toBeUndefined();
    const fixes = (
      result.data as { user: { library: { pendingFixes: { id: string; book: { id: string } }[] } } }
    ).user.library.pendingFixes;
    expect(fixes).toHaveLength(1);
    expect(fixes[0]?.id).toBe(fixes[0]?.book.id);
    expect(fixes[0]?.id).toBe(bookGlobalId(harness.aliceOwner.userId, BOOK_ID));
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
      `{ viewer { library { book(id: "${bookGlobalId(harness.aliceOwner.userId, EXPIRED_BOOK_ID)}") { pendingFix { fileName } } } } }`,
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

  // `Book.pendingFix` used to be a plain `prisma.pendingFix.findUnique` per
  // book, which is a textbook N+1 across a page of books. It now goes
  // through `context.loadPendingFix`, a request-scoped batching loader (see
  // `pending-fix-loader.ts`) — this asserts the batching actually happens
  // rather than merely trusting the loader exists. Mirrors
  // `progress/model.test.ts`'s identical batching test for `Book.progress`.
  it('batches Book.pendingFix across a page of books into a single query', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const id = i.toString().padStart(32, '3');
      ids.push(id);
      await harness.prisma.book.create({
        data: {
          userId: harness.aliceOwner.userId,
          id,
          title: `Book ${i}`,
          size: 1,
          mtime: 1,
          addedAt: 1,
        },
      });
      await harness.prisma.pendingFix.create({
        data: {
          userId: harness.aliceOwner.userId,
          bookId: id,
          fileName: `fix-${i}.epub`,
          fileSize: 1,
          state: SEEDED_STATE_JSON,
          updatedAt: 1_700_000_000_000,
        },
      });
    }

    const findUniqueSpy = vi.spyOn(harness.prisma.pendingFix, 'findUnique');
    const findManySpy = vi.spyOn(harness.prisma.pendingFix, 'findMany');

    const fields = ids
      .map(
        (id, i) =>
          `b${i}: book(id: "${bookGlobalId(harness.aliceOwner.userId, id)}") { pendingFix { fileName } }`
      )
      .join(' ');
    const result = await harness.execute(`{ viewer { library { ${fields} } } }`, {
      viewer: harness.aliceViewer,
    });

    expect(result.errors).toBeUndefined();
    expect(findUniqueSpy).not.toHaveBeenCalled();
    expect(findManySpy).toHaveBeenCalledTimes(1);
  });

  // A prior version of `createProgressLoader` (`progress-loader.ts`) captured
  // only `resolve`, never `reject`, when it took over settling each batched
  // caller's promise. A rejected `findMany` (e.g. a transient DB error) then
  // left every in-flight lookup in that batch permanently unsettled — the
  // request would hang forever instead of surfacing a GraphQL error, since
  // nothing else was watching that promise. `createPendingFixLoader` is
  // written with both `resolve` and `reject` captured from the start (see
  // `pending-fix-loader.ts`), but this regression test pins that behaviour
  // the same way `progress/model.test.ts` pins it for the progress loader.
  // This must resolve well inside the test's own timeout, not merely
  // "eventually" — a regression here should fail fast, not stall the suite.
  it('surfaces a GraphQL error instead of hanging when the pending-fix query fails', async () => {
    vi.spyOn(harness.prisma.pendingFix, 'findMany').mockRejectedValue(new Error('db unavailable'));

    const result = await harness.execute(
      `{ viewer { library { book(id: "${bookGlobalId(harness.aliceOwner.userId, BOOK_ID)}") { pendingFix { fileName } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  }, 2000);
});

/**
 * `Book.hasActionablePendingFix` — the guard `page/book-edit` renders its
 * conflict modal from, answered by the server rather than by shipping the
 * proposal list to the client and asking it there.
 *
 * The rule it encodes is not "has a pending fix": it is "has a LIVE pending
 * fix with at least one ACTIONABLE proposal". A proposal is actionable when
 * it carries a concrete `to`. An advisory one (`to: null`, "needs review")
 * has no suggested value for an edit to overwrite, and `bookResolvePendingFix`'s
 * ACCEPT filters to `to !== null` and leaves it behind — so it can never be
 * cleared by accepting, and guarding on it bounced the user straight back to
 * the screen whose Edit link sent them, with no way out.
 *
 * These tests own that discrimination. It used to live in the client, which
 * could only assert it because the client SELECTED the proposals — the very
 * selection that partially overwrote the shared `PendingFix` entity and cost
 * a spurious `LibraryPendingFixes` refetch per visit. The behaviour is
 * unchanged and still pinned by opposite mutations; it is pinned at the
 * layer that now owns the rule.
 */
describe('Book.hasActionablePendingFix', () => {
  const ADVISORY_BOOK_ID = '4'.repeat(32);
  const NO_FIX_BOOK_ID = '5'.repeat(32);
  const MIXED_BOOK_ID = '6'.repeat(32);

  const ADVISORY = { field: 'subjects', kind: 'review', from: 'x', to: null, changes: {} };

  const seedBook = (id: string) =>
    harness.prisma.book.create({
      data: {
        userId: harness.aliceOwner.userId,
        id,
        title: `Book ${id}`,
        size: 1,
        mtime: 1,
        addedAt: 1,
      },
    });

  const seedFix = (bookId: string, proposals: unknown[]) =>
    harness.prisma.pendingFix.create({
      data: {
        userId: harness.aliceOwner.userId,
        bookId,
        fileName: 'f.epub',
        fileSize: 1,
        state: JSON.stringify({ proposals }),
        updatedAt: 1_700_000_000_000,
      },
    });

  const read = async (id: string): Promise<boolean> => {
    const result = await harness.execute(
      `{ viewer { library { book(id: "${bookGlobalId(harness.aliceOwner.userId, id)}") { hasActionablePendingFix } } } }`,
      { viewer: harness.aliceViewer }
    );
    expect(result.errors).toBeUndefined();
    return (result.data as { viewer: { library: { book: { hasActionablePendingFix: boolean } } } })
      .viewer.library.book.hasActionablePendingFix;
  };

  it('is true for a live fix carrying a proposal with a concrete `to`', async () => {
    expect(await read(BOOK_ID)).toBe(true);
  });

  it('is false for a book with no pending-fix row at all', async () => {
    await seedBook(NO_FIX_BOOK_ID);
    expect(await read(NO_FIX_BOOK_ID)).toBe(false);
  });

  it('is false when every remaining proposal is advisory (`to: null`)', async () => {
    await seedBook(ADVISORY_BOOK_ID);
    await seedFix(ADVISORY_BOOK_ID, [ADVISORY]);
    expect(await read(ADVISORY_BOOK_ID)).toBe(false);
  });

  it('is true when one actionable proposal remains alongside an advisory one', async () => {
    await seedBook(MIXED_BOOK_ID);
    await seedFix(MIXED_BOOK_ID, [ADVISORY, PROPOSAL]);
    expect(await read(MIXED_BOOK_ID)).toBe(true);
  });

  // Same `isLivePendingFix` gate `Book.pendingFix` applies, so the two
  // readings cannot drift apart the way the list and the relation once did:
  // a TTL-expired undo-only row is not a conflict.
  it('is false for a TTL-expired undo-only row', async () => {
    expect(await read(EXPIRED_BOOK_ID)).toBe(false);
  });

  // Reached from `Book`, which is reachable from a list — so it goes through
  // the same request-scoped batching loader `Book.pendingFix` uses. A plain
  // `findUnique` here would be N queries for a page of N books.
  it('batches across a page of books into a single query', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const id = i.toString().padStart(32, '7');
      ids.push(id);
      await seedBook(id);
      await seedFix(id, [PROPOSAL]);
    }

    const findUniqueSpy = vi.spyOn(harness.prisma.pendingFix, 'findUnique');
    const findManySpy = vi.spyOn(harness.prisma.pendingFix, 'findMany');

    const fields = ids
      .map(
        (id, i) =>
          `b${i}: book(id: "${bookGlobalId(harness.aliceOwner.userId, id)}") { hasActionablePendingFix }`
      )
      .join(' ');
    const result = await harness.execute(`{ viewer { library { ${fields} } } }`, {
      viewer: harness.aliceViewer,
    });

    expect(result.errors).toBeUndefined();
    expect(findUniqueSpy).not.toHaveBeenCalled();
    expect(findManySpy).toHaveBeenCalledTimes(1);
  });
});
