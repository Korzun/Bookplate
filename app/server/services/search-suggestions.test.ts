import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import { runMigrations } from '../db/migrate';
import { EpubMeta, Owner } from '../types';
import { BookStore } from './book-store';
import { getSearchSuggestions } from './search-suggestions';

vi.mock('../logger');

const OWNER: Owner = { userId: 'usr_test000000000000000', username: 'alice' };

function stage(id: string, content: string | Buffer = 'x'): string {
  const p = path.join(booksDir, `staged-${id}.epub`);
  fs.writeFileSync(p, content);
  return p;
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
// and use the owner-scoped BookStore only for setup (`addBook`) — every read
// under test goes through the imported `getSearchSuggestions` directly.
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

// Moved from `book-store.test.ts`'s `describe('getSearchSuggestions', ...)`
// (task 6) — assertions unchanged, calls retargeted from
// `bookStore.getSearchSuggestions(...)` to the extracted
// `getSearchSuggestions(prisma, ...)`.
describe('getSearchSuggestions', () => {
  it('returns matching authors', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'The Fifth Season',
      author: 'N.K. Jemisin',
      series: '',
      seriesIndex: 0,
      subjects: [],
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Piranesi',
      author: 'Susanna Clarke',
      series: '',
      seriesIndex: 0,
      subjects: [],
    });
    const result = await getSearchSuggestions(prisma, OWNER, { q: 'jemi', filter: {} });
    const authors = result.groups.find((g) => g.type === 'author');
    expect(authors?.items).toEqual([
      { label: 'N.K. Jemisin', value: 'N.K. Jemisin', matchStart: 5, matchLength: 4 },
    ]);
  });

  it('returns matching series', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'The Fifth Season',
      author: 'N.K. Jemisin',
      series: 'Broken Earth',
      seriesIndex: 1,
      subjects: [],
    });
    const result = await getSearchSuggestions(prisma, OWNER, { q: 'broken', filter: {} });
    const series = result.groups.find((g) => g.type === 'series');
    expect(series?.items).toEqual([
      { label: 'Broken Earth', value: 'Broken Earth', matchStart: 0, matchLength: 6 },
    ]);
  });

  it('returns matching book titles', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'The Fifth Season',
      author: 'N.K. Jemisin',
      series: '',
      seriesIndex: 0,
      subjects: [],
    });
    const result = await getSearchSuggestions(prisma, OWNER, { q: 'fifth', filter: {} });
    const books = result.groups.find((g) => g.type === 'book');
    expect(books?.items).toEqual([
      { label: 'The Fifth Season', value: 'b1', matchStart: 4, matchLength: 5 },
    ]);
  });

  it('returns matching subjects', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Foo',
      author: 'Author',
      series: '',
      seriesIndex: 0,
      subjects: ['Fantasy', 'Science Fiction'],
    });
    const result = await getSearchSuggestions(prisma, OWNER, { q: 'fan', filter: {} });
    const subjects = result.groups.find((g) => g.type === 'subject');
    expect(subjects?.items).toEqual([
      { label: 'Fantasy', value: 'Fantasy', matchStart: 0, matchLength: 3 },
    ]);
  });

  it('excludes active subject chips from subject group', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Foo',
      author: 'Author',
      series: '',
      seriesIndex: 0,
      subjects: ['Fantasy', 'Fantastic Voyage'],
    });
    const result = await getSearchSuggestions(prisma, OWNER, {
      q: 'fan',
      filter: { activeSubjects: ['Fantasy'] },
    });
    const subjects = result.groups.find((g) => g.type === 'subject');
    expect(subjects?.items.map((i) => i.value)).toEqual(['Fantastic Voyage']);
  });

  it('omits author group when filter.author is set', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Foo',
      author: 'N.K. Jemisin',
      series: '',
      seriesIndex: 0,
      subjects: [],
    });
    const result = await getSearchSuggestions(prisma, OWNER, {
      q: 'jemi',
      filter: { author: 'N.K. Jemisin' },
    });
    expect(result.groups.find((g) => g.type === 'author')).toBeUndefined();
  });

  it('omits series group when filter.seriesName is set', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Foo',
      author: 'Author',
      series: 'Broken Earth',
      seriesIndex: 1,
      subjects: [],
    });
    const result = await getSearchSuggestions(prisma, OWNER, {
      q: 'broken',
      filter: { seriesName: 'Broken Earth' },
    });
    expect(result.groups.find((g) => g.type === 'series')).toBeUndefined();
  });

  it('constrains series to active author filter', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'The Fifth Season',
      author: 'N.K. Jemisin',
      series: 'Broken Earth',
      seriesIndex: 1,
      subjects: [],
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Piranesi',
      author: 'Susanna Clarke',
      series: 'Broken Earth Fake',
      seriesIndex: 1,
      subjects: [],
    });
    const result = await getSearchSuggestions(prisma, OWNER, {
      q: 'broken',
      filter: { author: 'N.K. Jemisin' },
    });
    const series = result.groups.find((g) => g.type === 'series');
    expect(series?.items.map((i) => i.value)).toEqual(['Broken Earth']);
  });

  it('caps each group at 5 items', async () => {
    for (let i = 0; i < 7; i++) {
      await bookStore.addBook(OWNER, `b${i}`, stage(`b${i}`), {
        ...FAKE_META,
        title: `Alpha Book ${i}`,
        author: `Author${i}`,
        series: '',
        seriesIndex: 0,
        subjects: [],
      });
    }
    const result = await getSearchSuggestions(prisma, OWNER, { q: 'alpha', filter: {} });
    const books = result.groups.find((g) => g.type === 'book');
    expect(books?.items.length).toBeLessThanOrEqual(5);
  });

  it('returns empty groups for query that matches nothing', async () => {
    const result = await getSearchSuggestions(prisma, OWNER, { q: 'zzznomatch', filter: {} });
    expect(result.groups).toEqual([]);
  });

  it('returns author matching initials abbreviation (NK J → N.K. Jemisin)', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'The Fifth Season',
      author: 'N.K. Jemisin',
      series: '',
      seriesIndex: 0,
      subjects: [],
    });
    const result = await getSearchSuggestions(prisma, OWNER, { q: 'NK J', filter: {} });
    const authors = result.groups.find((g) => g.type === 'author');
    expect(authors?.items.map((i) => i.value)).toContain('N.K. Jemisin');
  });

  it('returns series matching single-char omission typo (Texcalaan → Teixcalaan)', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'A Memory Called Empire',
      author: 'Arkady Martine',
      series: 'Teixcalaan',
      seriesIndex: 1,
      subjects: [],
    });
    const result = await getSearchSuggestions(prisma, OWNER, { q: 'Texcalaan', filter: {} });
    const series = result.groups.find((g) => g.type === 'series');
    expect(series?.items.map((i) => i.value)).toContain('Teixcalaan');
  });
});
