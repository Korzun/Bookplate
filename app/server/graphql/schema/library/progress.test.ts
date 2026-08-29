import * as fs from 'fs';
import * as path from 'path';

import { reimportBook } from '../../../services/book-lifecycle';
import { seedBook } from '../../../test-support/seed-book';
import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');
// Only the one 'returns only the current-id entry after a reimport...' test
// below drives reimportBook's now-direct parseEpub/partialMD5 imports, and it
// arms both with mockImplementationOnce right before the call it's testing —
// no other test in this file exercises either, so there's no shared default
// to re-arm in a beforeEach (contrast book-lifecycle.test.ts, which does).
vi.mock('../../../services/epub-parser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/epub-parser')>()),
  parseEpub: vi.fn(),
  partialMD5: vi.fn(),
}));

import { parseEpub, partialMD5 } from '../../../services/epub-parser';

let harness: Harness;

const seedProgress = async (userId: string, document: string, timestamp: number) => {
  await harness.prisma.progress.create({
    data: {
      userId,
      document,
      progress: '/x',
      percentage: 0.5,
      device: 'Kobo',
      deviceId: 'dev-1',
      timestamp,
    },
  });
};

beforeEach(async () => {
  harness = await createHarness();
  // Descending timestamps, so the connection's `timestamp desc` order is p3, p2, p1.
  await seedProgress(harness.aliceOwner.userId, '1'.repeat(32), 1_700_000_001);
  await seedProgress(harness.aliceOwner.userId, '2'.repeat(32), 1_700_000_002);
  await seedProgress(harness.aliceOwner.userId, '3'.repeat(32), 1_700_000_003);
  await seedProgress(harness.bobOwner.userId, '9'.repeat(32), 1_700_000_009);
});

afterEach(async () => {
  await harness.cleanup();
});

const PAGE = `
  query ($first: Int, $after: String) {
    viewer { library { progress(first: $first, after: $after) {
      edges { cursor node { document } }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    } } }
  }
`;

/**
 * The same query with the backward args this connection gained when it became
 * a `t.prismaConnection`. Kept separate from `PAGE` so every forward-paging
 * test above still sends a document that names only `first`/`after` — the
 * shape the client actually sends.
 */
const BIDI_PAGE = `
  query ($first: Int, $after: String, $last: Int, $before: String) {
    viewer { library { progress(first: $first, after: $after, last: $last, before: $before) {
      edges { cursor node { document } }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    } } }
  }
`;

type PageData = {
  viewer: {
    library: {
      progress: {
        edges: { cursor: string; node: { document: string } }[];
        pageInfo: {
          hasNextPage: boolean;
          hasPreviousPage: boolean;
          startCursor: string | null;
          endCursor: string | null;
        };
      };
    };
  };
};

const readPage = async (
  variables: Record<string, unknown>,
  viewer: Harness['aliceViewer'] = harness.aliceViewer
) => {
  const result = await harness.execute(PAGE, { viewer, variables });
  expect(result.errors).toBeUndefined();
  return (result.data as PageData).viewer.library.progress;
};

describe('Library.progress', () => {
  it('returns the whole list newest-first when it fits on one page', async () => {
    const page = await readPage({ first: 10 });

    expect(page.edges.map((e) => e.node.document)).toEqual([
      '3'.repeat(32),
      '2'.repeat(32),
      '1'.repeat(32),
    ]);
    expect(page.pageInfo.hasNextPage).toBe(false);
    expect(page.pageInfo.hasPreviousPage).toBe(false);
  });

  it('paginates forward — after excludes what was already returned', async () => {
    const first = await readPage({ first: 2 });

    expect(first.edges.map((e) => e.node.document)).toEqual(['3'.repeat(32), '2'.repeat(32)]);
    expect(first.pageInfo.hasNextPage).toBe(true);
    expect(first.pageInfo.endCursor).not.toBeNull();

    const second = await readPage({ first: 2, after: first.pageInfo.endCursor });

    // Genuinely distinguishes "after is honored" from "after is ignored": an
    // ignored cursor would hand back page one again.
    expect(second.edges.map((e) => e.node.document)).toEqual(['1'.repeat(32)]);
    expect(second.pageInfo.hasNextPage).toBe(false);
    expect(second.pageInfo.hasPreviousPage).toBe(true);
  });

  it('accepts a per-edge cursor as `after`, not only pageInfo.endCursor', async () => {
    const all = await readPage({ first: 10 });

    // Resuming after the FIRST edge must yield exactly the entries following
    // it. Asserts the BEHAVIOUR, never the cursor's encoding: the format
    // changed with the `t.prismaConnection` conversion (it was base64
    // `{timestamp, document}` minted by the deleted
    // `utils/progress-pagination.ts`; it is now the plugin's compound-PK
    // cursor over `@@id([userId, document])`), and a test that pinned the
    // string would have failed for a change no client can observe, while
    // still not proving the cursor round-trips.
    const after = await readPage({ first: 10, after: all.edges[0].cursor });

    expect(after.edges.map((e) => e.node.document)).toEqual(['2'.repeat(32), '1'.repeat(32)]);
  });

  // Superseded by query-cost-control task 1's "reject, never clamp" ruling
  // (pagination.ts's `rejectOversizePage` doc comment): a silent clamp here
  // used to answer an out-of-range `first` with a truncated page; it now
  // rejects loudly instead, matching `Library.entries`'s own oversize test.
  it('rejects `first` above 100 instead of silently clamping it', async () => {
    const result = await harness.execute(PAGE, {
      viewer: harness.aliceViewer,
      variables: { first: 100_000 },
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0]?.extensions).toEqual({
      code: 'PAGE_SIZE_EXCEEDED',
      http: { status: 400 },
    });
  });

  it('accepts `first` exactly at 100, the max page size', async () => {
    const page = await readPage({ first: 100 });

    expect(page.edges).toHaveLength(3);
  });

  it('returns at most the default page size (50) when `first` is omitted', async () => {
    // Seed past the default so the assertion actually discriminates: the
    // `beforeEach` fixture above (3 rows) is far below 50 and would pass
    // this test even with no bound at all.
    for (let i = 0; i < 60; i++) {
      const document = `d${String(i).padStart(2, '0')}`.padEnd(32, 'z');
      await seedProgress(harness.aliceOwner.userId, document, 1_600_000_000 + i);
    }
    const page = await readPage({});

    expect(page.edges).toHaveLength(50);
    expect(page.pageInfo.hasNextPage).toBe(true);
  });

  /**
   * `last`/`before` are OFFERED AND HONOURED, which is new — and is the whole
   * of what the `t.prismaConnection` conversion changed in the SDL.
   *
   * This field previously declared neither (commit `e7f99557`), and three
   * tests here asserted GraphQL's `Unknown argument "last" on field
   * "Library.progress"` validation error. Those are replaced rather than
   * deleted: the behaviour they pinned — "this connection does not silently
   * accept an argument it cannot honour" — is still pinned, by asserting the
   * arguments now produce correct backward pages. `Library.entries` keeps the
   * unknown-argument tests, because it keeps the hand-declared shape (its node
   * type is a union over an interleaved two-table keyset; see
   * `library/model.ts`).
   */
  it('pages backward with `last`, returning the oldest rows in the same order', async () => {
    const result = await harness.execute(BIDI_PAGE, {
      viewer: harness.aliceViewer,
      variables: { last: 2 },
    });

    expect(result.errors).toBeUndefined();
    const page = (result.data as PageData).viewer.library.progress;
    // Newest-first ordering is unchanged; `last` selects the TAIL of that
    // order, so the two OLDEST rows, still newest-first between themselves.
    expect(page.edges.map((e) => e.node.document)).toEqual(['2'.repeat(32), '1'.repeat(32)]);
    expect(page.pageInfo.hasPreviousPage).toBe(true);
    expect(page.pageInfo.hasNextPage).toBe(false);
  });

  it('pages backward from a cursor with `before`', async () => {
    const all = await readPage({ first: 10 });

    const result = await harness.execute(BIDI_PAGE, {
      viewer: harness.aliceViewer,
      variables: { last: 1, before: all.edges[2].cursor },
    });

    expect(result.errors).toBeUndefined();
    const page = (result.data as PageData).viewer.library.progress;
    // The edge immediately preceding the last one — genuinely distinguishes
    // "before is honored" from "before is ignored", which would hand back the
    // newest row instead.
    expect(page.edges.map((e) => e.node.document)).toEqual(['2'.repeat(32)]);
  });

  // The reject-not-clamp ruling (`pagination.ts`) has to cover `last` now that
  // `last` exists on this field: `rejectOversizePage` checks both arguments,
  // and the plugin's own `maxSize` would otherwise CLAMP an oversize `last`
  // down to 100 with no error. Before the conversion this same input produced
  // an unknown-argument validation error instead, which is why the test that
  // asserted that is gone rather than merely renamed.
  it('rejects `last` above 100 instead of silently clamping it', async () => {
    const result = await harness.execute(BIDI_PAGE, {
      viewer: harness.aliceViewer,
      variables: { last: 100_000 },
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0]?.extensions).toEqual({
      code: 'PAGE_SIZE_EXCEEDED',
      http: { status: 400 },
    });
  });

  /**
   * THE ONE BEHAVIOUR THE CONVERSION MADE WORSE, pinned so it is a known cost
   * rather than a surprise.
   *
   * The old hand-built keyset (`timestamp < X OR (timestamp = X AND document >
   * Y)`) did not care whether the cursor row still existed — it was a
   * comparison against values carried IN the cursor. Prisma's `cursor` +
   * `skip: 1` positions at a row that must still be there, and when it is not,
   * the page comes back EMPTY with `hasNextPage: false` — measured here, not
   * assumed; it does not error.
   *
   * So a client paging through progress while deleting the exact row it last
   * paged from sees pagination end early rather than see wrong rows. The next
   * fetch from the top is correct. Accepted when this conversion was ruled on;
   * the window is narrow (a progress row is removed only by an explicit
   * `progressDelete`, or with its user or book), and the alternative was
   * keeping a hand-built connection whose every `Progress` field cost an extra
   * query.
   */
  it('ends pagination early — it does not error — when the cursor row is deleted', async () => {
    const first = await readPage({ first: 1 });
    expect(first.edges.map((e) => e.node.document)).toEqual(['3'.repeat(32)]);

    await harness.prisma.progress.delete({
      where: {
        userId_document: { userId: harness.aliceOwner.userId, document: '3'.repeat(32) },
      },
    });

    const second = await readPage({ first: 10, after: first.pageInfo.endCursor });

    expect(second.edges).toEqual([]);
    expect(second.pageInfo.hasNextPage).toBe(false);
  });

  // A malformed cursor is now a loud error rather than a silent restart from
  // the top: `decodeProgressCursor` returned `null` for anything unparseable
  // and the resolver treated that as "no cursor", so a corrupted cursor
  // quietly re-served page one. The plugin's parser throws instead. Pinned
  // because it is a client-visible difference, and because "quietly serves
  // page one" is the worse of the two behaviours to reintroduce by accident.
  it('rejects a malformed cursor instead of silently restarting from the top', async () => {
    const result = await harness.execute(PAGE, {
      viewer: harness.aliceViewer,
      variables: { first: 10, after: 'not-a-cursor' },
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0]?.message).toContain('Invalid cursor');
  });

  // Same-second timestamps are routine — KOReader syncs whole SECONDS — so the
  // `document asc` tiebreaker is what gives the order a total ordering, and
  // Prisma's cursor pagination needs one or a page boundary can repeat or skip
  // a row. This walks a tie ACROSS a page boundary, which is the only place
  // the tiebreaker can actually be observed to fail. Ported from
  // `services/progress.test.ts`'s "breaks timestamp ties by document
  // ascending", which was deleted with `getUserProgressPage`.
  it('breaks timestamp ties by document ascending, across a page boundary', async () => {
    await seedProgress(harness.aliceOwner.userId, 'y'.repeat(32), 1_700_000_500);
    await seedProgress(harness.aliceOwner.userId, 'x'.repeat(32), 1_700_000_500);

    const first = await readPage({ first: 1 });
    expect(first.edges.map((e) => e.node.document)).toEqual(['x'.repeat(32)]);

    const second = await readPage({ first: 1, after: first.pageInfo.endCursor });
    expect(second.edges.map((e) => e.node.document)).toEqual(['y'.repeat(32)]);
  });

  /**
   * Reads through `Query.user(id:).library` as the admin. This is the
   * assertion that discriminates "pages the parent Owner's progress" from
   * "pages the viewer's": the config-based admin has a null `userId` and no
   * progress of its own, so a resolver consulting the viewer instead of the
   * parent returns nothing here while every self-read test above still passes.
   */
  it("reads the owner off its parent — an admin pages the target user's progress", async () => {
    const result = await harness.execute(
      `query ($id: ID!) { user(id: $id) { library { progress(first: 10) {
        edges { node { document } }
      } } } }`,
      { viewer: harness.adminViewer, variables: { id: harness.aliceGlobalId } }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (
        result.data as {
          user: { library: { progress: { edges: { node: { document: string } }[] } } };
        }
      ).user.library.progress.edges.map((e) => e.node.document)
    ).toEqual(['3'.repeat(32), '2'.repeat(32), '1'.repeat(32)]);
  });

  it("does not page through another user's progress", async () => {
    const bobPage = await readPage({ first: 10 }, harness.bobViewer);

    expect(bobPage.edges.map((e) => e.node.document)).toEqual(['9'.repeat(32)]);
  });

  it('returns only the current-id entry after a reimport changes the book id', async () => {
    const FAKE_META = {
      title: 'T',
      author: 'A',
      series: '',
      seriesIndex: 0,
      publisher: '',
      publishDate: '',
      description: '',
      subjects: [],
      identifiers: [],
      coverData: null,
      coverMime: null,
      chapterCount: 0,
      chapterSpineMap: [],
      chapterNames: [],
      pageCount: 0,
    } as never;

    const staged = path.join(harness.config.booksDir, 'staged-lin.epub');
    fs.writeFileSync(staged, 'x');
    await seedBook(
      harness.prisma,
      { booksRoot: harness.config.booksDir },
      harness.aliceOwner,
      'lin-old',
      staged,
      FAKE_META
    );
    await harness.prisma.progress.create({
      data: {
        userId: harness.aliceOwner.userId,
        document: 'lin-old',
        progress: '/p[2]',
        percentage: 0.4,
        device: 'Kobo',
        deviceId: 'd1',
        timestamp: 1_700_000_100,
      },
    });

    vi.mocked(parseEpub).mockImplementationOnce(() => FAKE_META);
    vi.mocked(partialMD5).mockImplementationOnce(() => 'lin-new');
    await reimportBook(
      harness.prisma,
      harness.config.booksDir,
      harness.editionsRoot,
      harness.aliceOwner,
      'lin-old'
    );

    const result = await harness.execute(PAGE, { viewer: harness.aliceViewer });
    const documents = (result.data as PageData).viewer.library.progress.edges.map(
      (edge) => edge.node.document
    );

    expect(result.errors).toBeUndefined();
    expect(documents).toContain('lin-new');
    expect(documents).not.toContain('lin-old');
  });
});

// Pins the whole cost of a page, not just the values — this is the measurement
// the `t.prismaConnection` conversion was done for, and the one thing a revert
// would break while every value assertion above still passed.
//
// Measured on a page of 8 selecting `book { title }` and `currentChapter`:
// **3 queries before, 1 after**. The 3 were one `progress.findMany` plus one
// `book.findMany` per request-scoped loader — `book-by-document` for
// `Progress.book` and `chapter-spine-map` for `Progress.currentChapter`. Both
// are gone from this path: `book` is a `t.relation` and the spine map a field
// `select`, and `@pothos/plugin-prisma` merges both into the connection's own
// query because a `t.prismaConnection` is one IT planned.
//
// (The identical relation, tried against the hand-declared connection this
// field used to be, measured 2 -> 9 for a page of 8 — a per-row fallback,
// because an unplanned query has nothing to merge into. That is the whole
// mechanism, written up in `graphql/loaders/pair-loader.ts`, and it is why
// this test asserts the book delegates were not touched AT ALL rather than
// asserting some small number.)
it('reads one page of progress, with its books, in exactly one query', async () => {
  const bookIds = ['1', '2', '3'].map((n) => n.repeat(32));
  for (const id of bookIds) {
    await harness.prisma.book.create({
      data: {
        userId: harness.aliceOwner.userId,
        id,
        title: `Book ${id.slice(0, 1)}`,
        size: 1,
        mtime: 1,
        addedAt: 1,
        chapterSpineMap: JSON.stringify([0, 3, 6]),
      },
    });
  }

  const progressFindMany = vi.spyOn(harness.prisma.progress, 'findMany');
  const bookFindMany = vi.spyOn(harness.prisma.book, 'findMany');
  const bookFindUnique = vi.spyOn(harness.prisma.book, 'findUnique');
  const bookFindUniqueOrThrow = vi.spyOn(harness.prisma.book, 'findUniqueOrThrow');

  const result = await harness.execute(
    `{ viewer { library { progress(first: 10) {
        edges { cursor node { id document percentage currentChapter book { title } } }
        pageInfo { hasNextPage endCursor } } } } }`,
    { viewer: harness.aliceViewer }
  );

  expect(result.errors).toBeUndefined();
  expect(progressFindMany).toHaveBeenCalledTimes(1);
  expect(bookFindMany).not.toHaveBeenCalled();
  expect(bookFindUnique).not.toHaveBeenCalled();
  expect(bookFindUniqueOrThrow).not.toHaveBeenCalled();
});
