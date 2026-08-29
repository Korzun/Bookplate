import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import { runMigrations } from '../db/migrate';
import { EpubMeta, Owner, PageCursor } from '../types';
import { BookStore } from './book-store';

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
// and assert on-disk paths here, matching the owner-scoped BookStore.
let booksDir: string;
let editionsRoot: string;
let bookStore: BookStore;
let dbPath: string;

beforeEach(async () => {
  booksRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'books-test-'));
  booksDir = path.join(booksRoot, OWNER.username);
  fs.mkdirSync(booksDir, { recursive: true });
  editionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'books-test-editions-'));
  dbPath = path.join(
    os.tmpdir(),
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksRoot);
  await prisma.user.create({ data: { id: OWNER.userId, username: OWNER.username } });
  bookStore = new BookStore(booksRoot, prisma, editionsRoot);
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

describe('BookStore.listBooksPage()', () => {
  it('returns empty result for an empty library', async () => {
    const result = await bookStore.listBooksPage(OWNER, null, 20);
    expect(result).toEqual({ items: [], books: [], nextCursor: null });
  });

  it('returns standalone books as display units', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, title: 'Alpha', series: '' });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), { ...FAKE_META, title: 'Beta', series: '' });
    const result = await bookStore.listBooksPage(OWNER, null, 20);
    expect(result.items).toEqual([
      { type: 'standalone', bookId: 'b1' },
      { type: 'standalone', bookId: 'b2' },
    ]);
    expect(result.books).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it('returns a series as a single display unit', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Dune 2',
      series: 'Dune',
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20);
    expect(result.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
    expect(result.books).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it('includes all series books in the books array even when only one item is a series', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'D1',
      series: 'Dune',
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'D2',
      series: 'Dune',
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20);
    const ids = result.books.map((b) => b.id).sort();
    expect(ids).toEqual(['b1', 'b2'].sort());
  });

  it('merges series and standalones in title/name order', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, title: 'Apple', series: '' });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Cherry',
      series: 'Banana',
    });
    await bookStore.addBook(OWNER, 'b3', stage('b3'), { ...FAKE_META, title: 'Dates', series: '' });
    const result = await bookStore.listBooksPage(OWNER, null, 20);
    expect(result.items).toEqual([
      { type: 'standalone', bookId: 'b1' },
      { type: 'series', seriesName: 'Banana' },
      { type: 'standalone', bookId: 'b3' },
    ]);
  });

  it('returns nextCursor when take is less than total display units', async () => {
    for (let i = 1; i <= 5; i++) {
      await bookStore.addBook(OWNER, `b${i}`, stage(`b${i}`), {
        ...FAKE_META,
        title: `Book ${String.fromCharCode(64 + i)}`,
        series: '',
      });
    }
    const result = await bookStore.listBooksPage(OWNER, null, 3);
    expect(result.items).toHaveLength(3);
    expect(result.nextCursor).not.toBeNull();
  });

  it('advances the cursor to load the next page', async () => {
    for (let i = 1; i <= 4; i++) {
      await bookStore.addBook(OWNER, `b${i}`, stage(`b${i}`), {
        ...FAKE_META,
        title: `Book ${String.fromCharCode(64 + i)}`,
        series: '',
      });
    }
    const page1 = await bookStore.listBooksPage(OWNER, null, 2);
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const cursor = JSON.parse(
      Buffer.from(page1.nextCursor!, 'base64').toString('utf-8')
    ) as PageCursor;
    const page2 = await bookStore.listBooksPage(OWNER, cursor, 2);
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
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, title: 'Same', series: '' });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), { ...FAKE_META, title: 'Same', series: '' });
    await bookStore.addBook(OWNER, 'b3', stage('b3'), { ...FAKE_META, title: 'Zzz', series: '' });

    const page1 = await bookStore.listBooksPage(OWNER, null, 1);
    expect(page1.items).toHaveLength(1);
    expect(page1.nextCursor).not.toBeNull();

    const c1 = JSON.parse(Buffer.from(page1.nextCursor!, 'base64').toString('utf-8')) as PageCursor;
    const page2 = await bookStore.listBooksPage(OWNER, c1, 1);
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).not.toBeNull();

    const c2 = JSON.parse(Buffer.from(page2.nextCursor!, 'base64').toString('utf-8')) as PageCursor;
    const page3 = await bookStore.listBooksPage(OWNER, c2, 1);
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

describe('listBooksPage with filters', () => {
  it('status=not-started returns standalone books with no progress', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Beta',
      series: '',
      seriesIndex: 0,
    });
    await insertProgress('b1', 0.5);
    const result = await bookStore.listBooksPage(OWNER, null, 20, { status: 'not-started' });
    expect(result.items).toEqual([{ type: 'standalone', bookId: 'b2' }]);
  });

  it('status=in-progress returns standalone books with partial progress', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Beta',
      series: '',
      seriesIndex: 0,
    });
    await bookStore.addBook(OWNER, 'b3', stage('b3'), {
      ...FAKE_META,
      title: 'Gamma',
      series: '',
      seriesIndex: 0,
    });
    await insertProgress('b1', 0.5);
    await insertProgress('b2', 1.0);
    const result = await bookStore.listBooksPage(OWNER, null, 20, { status: 'in-progress' });
    expect(result.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });

  it('status=completed returns standalone books with percentage >= 1', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Beta',
      series: '',
      seriesIndex: 0,
    });
    await insertProgress('b1', 1.0);
    const result = await bookStore.listBooksPage(OWNER, null, 20, { status: 'completed' });
    expect(result.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });

  it('status=not-started returns series where no member book has progress', async () => {
    await bookStore.addBook(OWNER, 's1b1', stage('s1b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    await bookStore.addBook(OWNER, 's2b1', stage('s2b1'), {
      ...FAKE_META,
      title: 'Foundation 1',
      series: 'Foundation',
      seriesIndex: 1,
    });
    await insertProgress('s1b1', 0.5);
    const result = await bookStore.listBooksPage(OWNER, null, 20, { status: 'not-started' });
    expect(result.items).toEqual([{ type: 'series', seriesName: 'Foundation' }]);
  });

  it('status=completed returns series where all member books have percentage >= 1', async () => {
    await bookStore.addBook(OWNER, 's1b1', stage('s1b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    await bookStore.addBook(OWNER, 's1b2', stage('s1b2'), {
      ...FAKE_META,
      title: 'Dune 2',
      series: 'Dune',
      seriesIndex: 2,
    });
    await bookStore.addBook(OWNER, 's2b1', stage('s2b1'), {
      ...FAKE_META,
      title: 'Foundation 1',
      series: 'Foundation',
      seriesIndex: 1,
    });
    await insertProgress('s1b1', 1.0);
    await insertProgress('s1b2', 1.0);
    await insertProgress('s2b1', 0.5);
    const result = await bookStore.listBooksPage(OWNER, null, 20, { status: 'completed' });
    expect(result.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
  });

  it('status=in-progress returns series with a book actively being read', async () => {
    await bookStore.addBook(OWNER, 's1b1', stage('s1b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    await bookStore.addBook(OWNER, 's1b2', stage('s1b2'), {
      ...FAKE_META,
      title: 'Dune 2',
      series: 'Dune',
      seriesIndex: 2,
    });
    await bookStore.addBook(OWNER, 's1b3', stage('s1b3'), {
      ...FAKE_META,
      title: 'Dune 3',
      series: 'Dune',
      seriesIndex: 3,
    });
    await insertProgress('s1b1', 1.0);
    await insertProgress('s1b2', 0.4);
    // s1b3 has no progress
    const result = await bookStore.listBooksPage(OWNER, null, 20, { status: 'in-progress' });
    expect(result.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
  });

  it('status=in-progress excludes series with only completed and unread books', async () => {
    await bookStore.addBook(OWNER, 's1b1', stage('s1b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    await bookStore.addBook(OWNER, 's1b2', stage('s1b2'), {
      ...FAKE_META,
      title: 'Dune 2',
      series: 'Dune',
      seriesIndex: 2,
    });
    await insertProgress('s1b1', 1.0);
    // s1b2 has no progress — finished book 1 but haven't started book 2
    const result = await bookStore.listBooksPage(OWNER, null, 20, { status: 'in-progress' });
    expect(result.items).toEqual([]);
  });

  it('seriesName + status combined: shows only the named series when completed', async () => {
    await bookStore.addBook(OWNER, 'sa1', stage('sa1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    await bookStore.addBook(OWNER, 's1b1', stage('s1b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    await insertProgress('sa1', 1.0);
    await insertProgress('s1b1', 1.0);
    const result = await bookStore.listBooksPage(OWNER, null, 20, {
      seriesName: 'Dune',
      status: 'completed',
    });
    expect(result.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
  });

  it('no filters returns same result as calling without filters arg', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    const withoutFilters = await bookStore.listBooksPage(OWNER, null, 20);
    const withEmptyFilters = await bookStore.listBooksPage(OWNER, null, 20, {});
    expect(withEmptyFilters.items).toEqual(withoutFilters.items);
  });

  it('subjects filter returns only standalone books with that subject', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
      subjects: ['Fantasy'],
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Beta',
      series: '',
      seriesIndex: 0,
      subjects: ['Science Fiction'],
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { subjects: ['Fantasy'] });
    expect(result.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });

  it('subjects filter does not match partial subject names', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
      subjects: ['Science'],
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Beta',
      series: '',
      seriesIndex: 0,
      subjects: ['Science Fiction'],
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { subjects: ['Science'] });
    expect(result.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });

  it('subjects filter handles subjects containing quote characters', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
      subjects: ['He said "Hi"'],
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Beta',
      series: '',
      seriesIndex: 0,
      subjects: ['Fantasy'],
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { subjects: ['He said "Hi"'] });
    expect(result.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });

  it('subjects filter returns series whose subject roll-up contains the subject', async () => {
    await bookStore.addBook(OWNER, 's1b1', stage('s1b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
      subjects: ['Science Fiction'],
    });
    await bookStore.addBook(OWNER, 's2b1', stage('s2b1'), {
      ...FAKE_META,
      title: 'Fellowship 1',
      series: 'Fellowship',
      seriesIndex: 1,
      subjects: ['Fantasy'],
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, {
      subjects: ['Science Fiction'],
    });
    expect(result.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
  });

  it('entryType=series returns only series display units', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { entryType: 'series' });
    expect(result.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
    expect(result.books).toHaveLength(1);
    expect(result.books[0].id).toBe('b2');
  });

  it('entryType=standalone returns only standalone display units', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { entryType: 'standalone' });
    expect(result.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
    expect(result.books).toHaveLength(1);
    expect(result.books[0].id).toBe('b1');
  });

  it('no entryType filter returns both series and standalone display units', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, {});
    expect(result.items).toHaveLength(2);
    expect(result.items).toEqual(
      expect.arrayContaining([
        { type: 'series', seriesName: 'Dune' },
        { type: 'standalone', bookId: 'b1' },
      ])
    );
  });
});

describe('BookStore.listBooksPage() — search filters', () => {
  it('filters standalones by query (title contains)', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'The Fifth Season',
      series: '',
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'A Memory Called Empire',
      series: '',
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { query: 'fifth' });
    expect(result.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });

  it('filters series by query (name contains)', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Foundation 1',
      series: 'Foundation',
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { query: 'dune' });
    // "Dune 1" sorts after the "Dune" series sortKey alphabetically ("dune" < "dune 1")
    expect(result.items).toEqual([
      { type: 'series', seriesName: 'Dune' },
      { type: 'standalone', bookId: 'b1' },
    ]);
  });

  it('filters series by member book title (not just series name)', async () => {
    await bookStore.addBook(OWNER, 's1', stage('s1'), {
      ...FAKE_META,
      title: 'The Fifth Season',
      series: 'Broken Earth',
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { query: 'Fifth Season' });
    // Series sorts before book ("broken earth" < "the fifth season")
    expect(result.items).toEqual([
      { type: 'series', seriesName: 'Broken Earth' },
      { type: 'standalone', bookId: 's1' },
    ]);
  });

  it('includes series member books as individual results when their title matches query', async () => {
    await bookStore.addBook(OWNER, 's1', stage('s1'), {
      ...FAKE_META,
      title: "Abaddon's Gate",
      series: 'The Expanse',
    });
    await bookStore.addBook(OWNER, 's2', stage('s2'), {
      ...FAKE_META,
      title: 'Leviathan Wakes',
      series: 'The Expanse',
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { query: 'gate' });
    // "Abaddon's Gate" sorts before "The Expanse" series ("abaddon" < "the expanse")
    // "Leviathan Wakes" does not match "gate" so it is absent
    expect(result.items).toEqual([
      { type: 'standalone', bookId: 's1' },
      { type: 'series', seriesName: 'The Expanse' },
    ]);
  });

  it('filters standalones by author (contains, case-insensitive)', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Book A',
      author: 'N.K. Jemisin',
      series: '',
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Book B',
      author: 'Arkady Martine',
      series: '',
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { author: 'jemisin' });
    expect(result.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });

  it('filters series by author field', async () => {
    await bookStore.addBook(OWNER, 's1', stage('s1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      author: 'Frank Herbert',
    });
    await bookStore.addBook(OWNER, 's2', stage('s2'), {
      ...FAKE_META,
      title: 'Foundation 1',
      series: 'Foundation',
      author: 'Isaac Asimov',
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { author: 'Herbert' });
    expect(result.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
  });

  it('filters by seriesName: shows only the named series (no standalones)', async () => {
    await bookStore.addBook(OWNER, 's1', stage('s1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
    });
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Standalone',
      series: '',
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { seriesName: 'Dune' });
    expect(result.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
  });

  it('filters standalones by multiple subjects (AND)', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Book A',
      series: '',
      subjects: ['Fantasy', 'Fiction'],
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Book B',
      series: '',
      subjects: ['Fantasy'],
    });
    await bookStore.addBook(OWNER, 'b3', stage('b3'), {
      ...FAKE_META,
      title: 'Book C',
      series: '',
      subjects: ['Fiction'],
    });
    // Only b1 has both subjects; b2 (Fantasy only) and b3 (Fiction only) must be excluded
    const result = await bookStore.listBooksPage(OWNER, null, 20, {
      subjects: ['Fantasy', 'Fiction'],
    });
    expect(result.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });
});
