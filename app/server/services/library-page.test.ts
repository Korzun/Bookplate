import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import { runMigrations } from '../db/migrate';
import { decodeCursor, encodeCursor } from '../graphql/schema/library/entries-cursor';
import { seedBook } from '../test-support/seed-book';
import { EpubMeta, Owner, PageCursor } from '../types';
import { listBooksPage, type LibraryPageItem } from './library-page';

vi.mock('../logger');

const OWNER: Owner = { userId: 'usr_test000000000000000', username: 'alice' };

function stage(id: string, content: string | Buffer = 'x'): string {
  const p = path.join(booksDir, `staged-${id}.epub`);
  fs.writeFileSync(p, content);
  return p;
}

async function insertProgress(bookId: string, percentage: number): Promise<void> {
  await prisma.progress.create({
    data: {
      userId: OWNER.userId,
      document: bookId,
      progress: `epub:/${bookId}/${percentage}`,
      percentage,
      device: 'Kobo',
      deviceId: 'dev1',
      timestamp: Date.now(),
    },
  });
}

// Strips each item's `row` down to the bare type/id shape most assertions
// below care about — `row` (task 8's contract change) carries the real
// `Book`/`Series` row precisely so `Library.entries` doesn't have to
// re-fetch it, but most of these tests only need to know WHICH display units
// came back and in what order, not their full column set.
//
// WHERE `BOOK_SELECT` IS COVERED, AND WHY NOT HERE: the `Book` half of that
// read is no longer a full row — task 5 gave it a `select` (`BOOK_SELECT`,
// `library-page.ts`) that drops `coverData`. The guard for it lives in
// `graphql/schema/library/entries.test.ts`'s "Library.entries — Book column
// selection" describe, not in this file, and deliberately so: the property
// that matters is not "the select has these keys" (which this file could
// assert) but "every `Book` field a client can ask for still resolves off
// the trimmed row", and only the GraphQL layer can execute a query against
// the real schema to prove that. A column dropped from `BOOK_SELECT` by
// mistake would leave every test in THIS file green — the seeds here set
// `coverData` and nothing reads it back.
type ItemShape = { type: 'series'; seriesName: string } | { type: 'standalone'; bookId: string };
function itemsShape(items: LibraryPageItem[]): ItemShape[] {
  return items.map((item) =>
    item.type === 'standalone'
      ? { type: 'standalone', bookId: item.bookId }
      : { type: 'series', seriesName: item.seriesName }
  );
}

const FAKE_META: EpubMeta = {
  title: 'Test Book',
  author: 'Author Name',
  description: 'A test description',
  publisher: 'Test Publisher',
  series: 'Test Series',
  seriesIndex: 1,
  titleSort: '',
  authorSort: '',
  publishDate: '',
  identifiers: [{ scheme: 'ISBN', value: '978-0000000000' }],
  subjects: ['Fiction'],
  coverData: Buffer.from('fake-cover'),
  coverMime: 'image/jpeg',
  chapterCount: 0,
  chapterSpineMap: [],
  chapterNames: [],
  pageCount: 0,
};

let prisma: PrismaClient;
let booksRoot: string;
// Per-user library folder (<booksRoot>/<OWNER.username>). Tests stage files here
// and assert on-disk paths here.
let booksDir: string;
let dbPath: string;

beforeEach(async () => {
  booksRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'books-test-'));
  booksDir = path.join(booksRoot, OWNER.username);
  fs.mkdirSync(booksDir, { recursive: true });
  dbPath = path.join(
    os.tmpdir(),
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksRoot);
  await prisma.user.create({ data: { id: OWNER.userId, username: OWNER.username } });
  // Still used to seed rows via `addBook` — `listBooksPage` itself is called
  // directly below, not through `BookStore`, matching how
  // `graphql/schema/library/model.ts` calls it (task 8).
});

afterEach(async () => {
  await prisma.$disconnect();
  try {
    fs.unlinkSync(dbPath);
  } catch {
    /* best-effort cleanup */
  }
  fs.rmSync(booksRoot, { recursive: true });
});

describe('listBooksPage()', () => {
  it('returns empty result for an empty library', async () => {
    const result = await listBooksPage(prisma, OWNER, null, 20);
    expect(result).toEqual({ items: [], nextCursor: null });
  });

  it('returns standalone books as display units', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Beta',
      series: '',
    });
    const result = await listBooksPage(prisma, OWNER, null, 20);
    expect(itemsShape(result.items)).toEqual([
      { type: 'standalone', bookId: 'b1' },
      { type: 'standalone', bookId: 'b2' },
    ]);
    expect(result.nextCursor).toBeNull();
  });

  it('returns a series as a single display unit', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Dune 2',
      series: 'Dune',
    });
    const result = await listBooksPage(prisma, OWNER, null, 20);
    expect(itemsShape(result.items)).toEqual([{ type: 'series', seriesName: 'Dune' }]);
    expect(result.nextCursor).toBeNull();
  });

  // Each item's `row` is the real row it was ordered by (task 8's contract
  // change) — not a DTO built up from a separate hydration pass — so a
  // series item's `row` is the `Series` row itself, never its member books.
  // (Those are available to a caller through `Series.books`, a lazily
  // resolved relation — `graphql/schema/library/entries.test.ts`'s "resolves
  // a nested relation" test exercises that path.)
  it('a series item carries the real Series row, not its member books', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'D1',
      series: 'Dune',
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'D2',
      series: 'Dune',
    });
    const result = await listBooksPage(prisma, OWNER, null, 20);
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    if (item.type !== 'series') throw new Error('expected a series item');
    expect(item.row.name).toBe('Dune');
    expect(item.row.bookCount).toBe(2);
  });

  it('merges series and standalones in title/name order', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Apple',
      series: '',
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Cherry',
      series: 'Banana',
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b3', stage('b3'), {
      ...FAKE_META,
      title: 'Dates',
      series: '',
    });
    const result = await listBooksPage(prisma, OWNER, null, 20);
    expect(itemsShape(result.items)).toEqual([
      { type: 'standalone', bookId: 'b1' },
      { type: 'series', seriesName: 'Banana' },
      { type: 'standalone', bookId: 'b3' },
    ]);
  });

  it('returns nextCursor when take is less than total display units', async () => {
    for (let i = 1; i <= 5; i++) {
      await seedBook(prisma, { booksRoot: booksRoot }, OWNER, `b${i}`, stage(`b${i}`), {
        ...FAKE_META,
        title: `Book ${String.fromCharCode(64 + i)}`,
        series: '',
      });
    }
    const result = await listBooksPage(prisma, OWNER, null, 3);
    expect(result.items).toHaveLength(3);
    expect(result.nextCursor).not.toBeNull();
  });

  it('advances the cursor to load the next page', async () => {
    for (let i = 1; i <= 4; i++) {
      await seedBook(prisma, { booksRoot: booksRoot }, OWNER, `b${i}`, stage(`b${i}`), {
        ...FAKE_META,
        title: `Book ${String.fromCharCode(64 + i)}`,
        series: '',
      });
    }
    const page1 = await listBooksPage(prisma, OWNER, null, 2);
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const cursor = JSON.parse(
      Buffer.from(page1.nextCursor!, 'base64').toString('utf-8')
    ) as PageCursor;
    const page2 = await listBooksPage(prisma, OWNER, cursor, 2);
    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();
    const allIds = [...page1.items, ...page2.items].map((item) =>
      item.type === 'standalone' ? item.bookId : item.seriesName
    );
    expect(new Set(allIds).size).toBe(4);
  });

  it('does not skip standalones with duplicate titles at a page boundary', async () => {
    // b1 and b2 share the same title; b3 is distinct. With take=1, the cursor
    // after b1 must land correctly on b2 rather than skipping to b3.
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Same',
      series: '',
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Same',
      series: '',
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b3', stage('b3'), {
      ...FAKE_META,
      title: 'Zzz',
      series: '',
    });

    const page1 = await listBooksPage(prisma, OWNER, null, 1);
    expect(page1.items).toHaveLength(1);
    expect(page1.nextCursor).not.toBeNull();

    const c1 = JSON.parse(Buffer.from(page1.nextCursor!, 'base64').toString('utf-8')) as PageCursor;
    const page2 = await listBooksPage(prisma, OWNER, c1, 1);
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).not.toBeNull();

    const c2 = JSON.parse(Buffer.from(page2.nextCursor!, 'base64').toString('utf-8')) as PageCursor;
    const page3 = await listBooksPage(prisma, OWNER, c2, 1);
    expect(page3.items).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();

    const allIds = [page1, page2, page3].flatMap((p) =>
      p.items.map((item) => (item.type === 'standalone' ? item.bookId : item.seriesName))
    );
    expect(new Set(allIds).size).toBe(3); // all 3 books returned, none skipped
    expect(allIds).toContain('b1');
    expect(allIds).toContain('b2');
    expect(allIds).toContain('b3');
  });
});

// Cursor byte-compatibility: `entries-cursor.ts`'s `encodeCursor` mints
// cursors that must stay interchangeable with `listBooksPage`'s own
// `nextCursor` — that file's doc comment says so, but promises aren't proof.
// Both directions are exercised here rather than inspected: a cursor minted
// by `listBooksPage` must decode to the exact `PageCursor` `encodeCursor`
// would encode for the same row, AND a cursor minted independently via
// `encodeCursor` must resume `listBooksPage` at the same place its own
// `nextCursor` would.
describe('listBooksPage() cursor compatibility with entries-cursor.ts', () => {
  it('nextCursor is byte-identical to encodeCursor() for the same last row', async () => {
    for (let i = 1; i <= 3; i++) {
      await seedBook(prisma, { booksRoot: booksRoot }, OWNER, `b${i}`, stage(`b${i}`), {
        ...FAKE_META,
        title: `Book ${String.fromCharCode(64 + i)}`,
        series: '',
      });
    }
    const page1 = await listBooksPage(prisma, OWNER, null, 2);
    expect(page1.nextCursor).not.toBeNull();
    const last = page1.items[page1.items.length - 1];
    if (last.type !== 'standalone') throw new Error('expected a standalone item');
    const independentlyMinted = encodeCursor({ k: last.row.title, t: 'b', id: last.row.id });
    expect(page1.nextCursor).toBe(independentlyMinted);
  });

  it('a cursor minted by encodeCursor() resumes listBooksPage at the same place as its own nextCursor', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 's1b1', stage('s1b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 's1b2', stage('s1b2'), {
      ...FAKE_META,
      title: 'Dune 2',
      series: 'Dune',
      seriesIndex: 2,
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Zzz',
      series: '',
    });

    const page1 = await listBooksPage(prisma, OWNER, null, 1);
    expect(page1.items).toEqual([{ type: 'series', seriesName: 'Dune', row: page1.items[0].row }]);
    expect(page1.nextCursor).not.toBeNull();

    // Resume using `listBooksPage`'s own cursor…
    const viaOwnCursor = await listBooksPage(prisma, OWNER, decodeCursor(page1.nextCursor), 1);

    // …and using an independently minted, byte-identical cursor for the same row.
    const item = page1.items[0];
    if (item.type !== 'series') throw new Error('expected a series item');
    const independentCursor = encodeCursor({ k: item.row.sortKey, t: 's', id: item.row.id });
    const viaEncodeCursor = await listBooksPage(prisma, OWNER, decodeCursor(independentCursor), 1);

    expect(itemsShape(viaEncodeCursor.items)).toEqual(itemsShape(viaOwnCursor.items));
    expect(itemsShape(viaOwnCursor.items)).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });
});

// PROOF that task 8 collapsed the double read: before this task,
// `listBooksPage` fetched standalones through a hardcoded `BOOK_SELECT`
// (immediately discarded into an `items`/`books` DTO pair) AND, separately,
// fetched every series-on-the-page's member books — neither of which
// `Library.entries` ever used, since that resolver always re-fetched the
// same rows itself by id/name to get real `Book`/`Series` GraphQL nodes. For
// a page of N series plus any standalones that was `N + 2` calls to
// `prisma.book.findMany`, measured directly against the pre-task-8 code
// (`services/book-store.ts`, `BookStore.listBooksPage`) with a spy on
// `prisma.book.findMany`: 3 series x 2 books + 2 standalones => 4 calls from
// `listBooksPage` alone, plus a 5th from `Library.entries`'s own former
// second read (see `graphql/schema/library/entries.test.ts`) — 5 total.
// `listBooksPage` now returns the rows it read directly, so the resolver
// makes no second read, AND this function itself no longer touches the
// member-books-per-series path at all.
describe('listBooksPage() query count', () => {
  it('fetches every book exactly once per page, however many series share it', async () => {
    // 3 series x 2 books each + 2 standalones — the same fixture the
    // pre-task-8 code measured at 4 `prisma.book.findMany` calls from
    // `listBooksPage` alone (N=3 series => N+1).
    for (const s of ['Dune', 'Foundation', 'Expanse']) {
      for (let i = 1; i <= 2; i++) {
        await seedBook(prisma, { booksRoot: booksRoot }, OWNER, `${s}-${i}`, stage(`${s}-${i}`), {
          ...FAKE_META,
          title: `${s} ${i}`,
          series: s,
          seriesIndex: i,
        });
      }
    }
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'sa1', stage('sa1'), {
      ...FAKE_META,
      title: 'Alone A',
      series: '',
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'sa2', stage('sa2'), {
      ...FAKE_META,
      title: 'Alone B',
      series: '',
    });

    const bookSpy = vi.spyOn(prisma.book, 'findMany');
    const seriesSpy = vi.spyOn(prisma.series, 'findMany');

    const result = await listBooksPage(prisma, OWNER, null, 20);

    expect(result.items).toHaveLength(5); // 3 series + 2 standalones
    expect(bookSpy).toHaveBeenCalledTimes(1);
    expect(seriesSpy).toHaveBeenCalledTimes(1);
  });
});

describe('listBooksPage with filters', () => {
  it('status=not-started returns standalone books with no progress', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Beta',
      series: '',
      seriesIndex: 0,
    });
    await insertProgress('b1', 0.5);
    const result = await listBooksPage(prisma, OWNER, null, 20, { status: 'not-started' });
    expect(itemsShape(result.items)).toEqual([{ type: 'standalone', bookId: 'b2' }]);
  });

  it('status=in-progress returns standalone books with partial progress', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Beta',
      series: '',
      seriesIndex: 0,
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b3', stage('b3'), {
      ...FAKE_META,
      title: 'Gamma',
      series: '',
      seriesIndex: 0,
    });
    await insertProgress('b1', 0.5);
    await insertProgress('b2', 1.0);
    const result = await listBooksPage(prisma, OWNER, null, 20, { status: 'in-progress' });
    expect(itemsShape(result.items)).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });

  it('status=completed returns standalone books with percentage >= 1', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Beta',
      series: '',
      seriesIndex: 0,
    });
    await insertProgress('b1', 1.0);
    const result = await listBooksPage(prisma, OWNER, null, 20, { status: 'completed' });
    expect(itemsShape(result.items)).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });

  it('status=not-started returns series where no member book has progress', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 's1b1', stage('s1b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 's2b1', stage('s2b1'), {
      ...FAKE_META,
      title: 'Foundation 1',
      series: 'Foundation',
      seriesIndex: 1,
    });
    await insertProgress('s1b1', 0.5);
    const result = await listBooksPage(prisma, OWNER, null, 20, { status: 'not-started' });
    expect(itemsShape(result.items)).toEqual([{ type: 'series', seriesName: 'Foundation' }]);
  });

  it('status=completed returns series where all member books have percentage >= 1', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 's1b1', stage('s1b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 's1b2', stage('s1b2'), {
      ...FAKE_META,
      title: 'Dune 2',
      series: 'Dune',
      seriesIndex: 2,
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 's2b1', stage('s2b1'), {
      ...FAKE_META,
      title: 'Foundation 1',
      series: 'Foundation',
      seriesIndex: 1,
    });
    await insertProgress('s1b1', 1.0);
    await insertProgress('s1b2', 1.0);
    await insertProgress('s2b1', 0.5);
    const result = await listBooksPage(prisma, OWNER, null, 20, { status: 'completed' });
    expect(itemsShape(result.items)).toEqual([{ type: 'series', seriesName: 'Dune' }]);
  });

  it('status=in-progress returns series with a book actively being read', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 's1b1', stage('s1b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 's1b2', stage('s1b2'), {
      ...FAKE_META,
      title: 'Dune 2',
      series: 'Dune',
      seriesIndex: 2,
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 's1b3', stage('s1b3'), {
      ...FAKE_META,
      title: 'Dune 3',
      series: 'Dune',
      seriesIndex: 3,
    });
    await insertProgress('s1b1', 1.0);
    await insertProgress('s1b2', 0.4);
    // s1b3 has no progress
    const result = await listBooksPage(prisma, OWNER, null, 20, { status: 'in-progress' });
    expect(itemsShape(result.items)).toEqual([{ type: 'series', seriesName: 'Dune' }]);
  });

  it('status=in-progress excludes series with only completed and unread books', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 's1b1', stage('s1b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 's1b2', stage('s1b2'), {
      ...FAKE_META,
      title: 'Dune 2',
      series: 'Dune',
      seriesIndex: 2,
    });
    await insertProgress('s1b1', 1.0);
    // s1b2 has no progress — finished book 1 but haven't started book 2
    const result = await listBooksPage(prisma, OWNER, null, 20, { status: 'in-progress' });
    expect(result.items).toEqual([]);
  });

  it('seriesName + status combined: shows only the named series when completed', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'sa1', stage('sa1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 's1b1', stage('s1b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    await insertProgress('sa1', 1.0);
    await insertProgress('s1b1', 1.0);
    const result = await listBooksPage(prisma, OWNER, null, 20, {
      seriesName: 'Dune',
      status: 'completed',
    });
    expect(itemsShape(result.items)).toEqual([{ type: 'series', seriesName: 'Dune' }]);
  });

  it('no filters returns same result as calling without filters arg', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    const withoutFilters = await listBooksPage(prisma, OWNER, null, 20);
    const withEmptyFilters = await listBooksPage(prisma, OWNER, null, 20, {});
    expect(itemsShape(withEmptyFilters.items)).toEqual(itemsShape(withoutFilters.items));
  });

  it('subjects filter returns only standalone books with that subject', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
      subjects: ['Fantasy'],
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Beta',
      series: '',
      seriesIndex: 0,
      subjects: ['Science Fiction'],
    });
    const result = await listBooksPage(prisma, OWNER, null, 20, { subjects: ['Fantasy'] });
    expect(itemsShape(result.items)).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });

  it('subjects filter does not match partial subject names', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
      subjects: ['Science'],
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Beta',
      series: '',
      seriesIndex: 0,
      subjects: ['Science Fiction'],
    });
    const result = await listBooksPage(prisma, OWNER, null, 20, { subjects: ['Science'] });
    expect(itemsShape(result.items)).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });

  it('subjects filter handles subjects containing quote characters', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
      subjects: ['He said "Hi"'],
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Beta',
      series: '',
      seriesIndex: 0,
      subjects: ['Fantasy'],
    });
    const result = await listBooksPage(prisma, OWNER, null, 20, { subjects: ['He said "Hi"'] });
    expect(itemsShape(result.items)).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });

  it('subjects filter returns series whose subject roll-up contains the subject', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 's1b1', stage('s1b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
      subjects: ['Science Fiction'],
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 's2b1', stage('s2b1'), {
      ...FAKE_META,
      title: 'Fellowship 1',
      series: 'Fellowship',
      seriesIndex: 1,
      subjects: ['Fantasy'],
    });
    const result = await listBooksPage(prisma, OWNER, null, 20, {
      subjects: ['Science Fiction'],
    });
    expect(itemsShape(result.items)).toEqual([{ type: 'series', seriesName: 'Dune' }]);
  });

  it('entryType=series returns only series display units', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    const result = await listBooksPage(prisma, OWNER, null, 20, { entryType: 'series' });
    expect(itemsShape(result.items)).toEqual([{ type: 'series', seriesName: 'Dune' }]);
  });

  it('entryType=standalone returns only standalone display units', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    const result = await listBooksPage(prisma, OWNER, null, 20, { entryType: 'standalone' });
    expect(itemsShape(result.items)).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });

  it('no entryType filter returns both series and standalone display units', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    const result = await listBooksPage(prisma, OWNER, null, 20, {});
    expect(result.items).toHaveLength(2);
    expect(itemsShape(result.items)).toEqual(
      expect.arrayContaining([
        { type: 'series', seriesName: 'Dune' },
        { type: 'standalone', bookId: 'b1' },
      ])
    );
  });
});

describe('listBooksPage() — search filters', () => {
  it('filters standalones by query (title contains)', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'The Fifth Season',
      series: '',
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'A Memory Called Empire',
      series: '',
    });
    const result = await listBooksPage(prisma, OWNER, null, 20, { query: 'fifth' });
    expect(itemsShape(result.items)).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });

  it('filters series by query (name contains)', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Foundation 1',
      series: 'Foundation',
    });
    const result = await listBooksPage(prisma, OWNER, null, 20, { query: 'dune' });
    // "Dune 1" sorts after the "Dune" series sortKey alphabetically ("dune" < "dune 1")
    expect(itemsShape(result.items)).toEqual([
      { type: 'series', seriesName: 'Dune' },
      { type: 'standalone', bookId: 'b1' },
    ]);
  });

  it('filters series by member book title (not just series name)', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 's1', stage('s1'), {
      ...FAKE_META,
      title: 'The Fifth Season',
      series: 'Broken Earth',
    });
    const result = await listBooksPage(prisma, OWNER, null, 20, { query: 'Fifth Season' });
    // Series sorts before book ("broken earth" < "the fifth season")
    expect(itemsShape(result.items)).toEqual([
      { type: 'series', seriesName: 'Broken Earth' },
      { type: 'standalone', bookId: 's1' },
    ]);
  });

  it('includes series member books as individual results when their title matches query', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 's1', stage('s1'), {
      ...FAKE_META,
      title: "Abaddon's Gate",
      series: 'The Expanse',
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 's2', stage('s2'), {
      ...FAKE_META,
      title: 'Leviathan Wakes',
      series: 'The Expanse',
    });
    const result = await listBooksPage(prisma, OWNER, null, 20, { query: 'gate' });
    // "Abaddon's Gate" sorts before "The Expanse" series ("abaddon" < "the expanse")
    // "Leviathan Wakes" does not match "gate" so it is absent
    expect(itemsShape(result.items)).toEqual([
      { type: 'standalone', bookId: 's1' },
      { type: 'series', seriesName: 'The Expanse' },
    ]);
  });

  it('filters standalones by author (contains, case-insensitive)', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Book A',
      author: 'N.K. Jemisin',
      series: '',
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Book B',
      author: 'Arkady Martine',
      series: '',
    });
    const result = await listBooksPage(prisma, OWNER, null, 20, { author: 'jemisin' });
    expect(itemsShape(result.items)).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });

  it('filters series by author field', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 's1', stage('s1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      author: 'Frank Herbert',
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 's2', stage('s2'), {
      ...FAKE_META,
      title: 'Foundation 1',
      series: 'Foundation',
      author: 'Isaac Asimov',
    });
    const result = await listBooksPage(prisma, OWNER, null, 20, { author: 'Herbert' });
    expect(itemsShape(result.items)).toEqual([{ type: 'series', seriesName: 'Dune' }]);
  });

  it('filters by seriesName: shows only the named series (no standalones)', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 's1', stage('s1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Standalone',
      series: '',
    });
    const result = await listBooksPage(prisma, OWNER, null, 20, { seriesName: 'Dune' });
    expect(itemsShape(result.items)).toEqual([{ type: 'series', seriesName: 'Dune' }]);
  });

  it('filters standalones by multiple subjects (AND)', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Book A',
      series: '',
      subjects: ['Fantasy', 'Fiction'],
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Book B',
      series: '',
      subjects: ['Fantasy'],
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b3', stage('b3'), {
      ...FAKE_META,
      title: 'Book C',
      series: '',
      subjects: ['Fiction'],
    });
    // Only b1 has both subjects; b2 (Fantasy only) and b3 (Fiction only) must be excluded
    const result = await listBooksPage(prisma, OWNER, null, 20, {
      subjects: ['Fantasy', 'Fiction'],
    });
    expect(itemsShape(result.items)).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });
});
