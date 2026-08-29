import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import { runMigrations } from '../db/migrate';
import { seedBook } from '../test-support/seed-book';
import { EpubMeta, Owner } from '../types';
import {
  getAuthors,
  getBookById,
  getSubjects,
  listBooks,
  listBooksByAuthor,
  listBooksBySeries,
  listBooksBySubject,
  listBooksByStatus,
  listSeries,
} from './book-catalog';

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
// and assert on-disk paths here, matching the owner-scoped `seedBook` used
// only for setup (`addBook`) — every read under test goes through the
// imported book-catalog functions directly.
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

// Moved from `book-store.test.ts`'s `describe('addBook and listBooks', ...)` —
// only the `it`s whose assertion is about `listBooks`'/`getBookById`'s own
// contract (field mapping via `prismaBookToBook`, and `sortByTitle`'s tie
// break order), not about `addBook`'s write path. `addBook` itself, and the
// few `it`s that exercise nothing but its own mechanics (duplicate-id
// rejection, file move, size/mtime stat-ing, per-owner isolation), went to
// `book-lifecycle.test.ts`'s `describe('addBook', ...)` instead.
describe('listBooks and getBookById — field mapping', () => {
  it('inserts a book and lists it', async () => {
    await seedBook(prisma, { booksRoot }, OWNER, 'abc123', stage('abc123'), FAKE_META);
    const books = await listBooks(prisma, booksRoot, OWNER);
    expect(books).toHaveLength(1);
    expect(books[0].id).toBe('abc123');
    expect(books[0].title).toBe('Test Book');
    expect(books[0].author).toBe('Author Name');
    expect(books[0].hasCover).toBe(true);
  });

  it('sorts by title', async () => {
    await seedBook(prisma, { booksRoot }, OWNER, 'id1', stage('id1'), {
      ...FAKE_META,
      title: 'Zebra',
    });
    await seedBook(prisma, { booksRoot }, OWNER, 'id2', stage('id2'), {
      ...FAKE_META,
      title: 'Apple',
    });
    const books = await listBooks(prisma, booksRoot, OWNER);
    expect(books[0].title).toBe('Apple');
    expect(books[1].title).toBe('Zebra');
  });

  it('returns hasCover false when no cover', async () => {
    await seedBook(prisma, { booksRoot }, OWNER, 'id1', stage('id1'), {
      ...FAKE_META,
      coverData: null,
      coverMime: null,
    });
    const books = await listBooks(prisma, booksRoot, OWNER);
    expect(books[0].hasCover).toBe(false);
  });

  it('persists titleSort on stored books', async () => {
    const meta: EpubMeta = {
      ...FAKE_META,
      title: 'Foundation',
      author: 'Isaac Asimov',
      titleSort: 'Asimov, Isaac',
    };
    await seedBook(prisma, { booksRoot }, OWNER, 'id1', stage('id1'), meta);
    const book = await getBookById(prisma, booksRoot, OWNER, 'id1');
    expect(book!.titleSort).toBe('Asimov, Isaac');
  });

  it('stores trimmed titleSort even when metadata has extra whitespace', async () => {
    const meta: EpubMeta = {
      ...FAKE_META,
      titleSort: '  Asimov, Isaac  ',
    };
    await seedBook(prisma, { booksRoot }, OWNER, 'id2', stage('id2'), meta);
    const book = await getBookById(prisma, booksRoot, OWNER, 'id2');
    expect(book!.titleSort).toBe('Asimov, Isaac');
  });

  it('sorts by titleSort before title', async () => {
    await seedBook(prisma, { booksRoot }, OWNER, 'id-a', stage('id-a'), {
      ...FAKE_META,
      title: 'Zzz',
      titleSort: 'Apple, A.',
    });
    await seedBook(prisma, { booksRoot }, OWNER, 'id-z', stage('id-z'), {
      ...FAKE_META,
      title: 'Aaa',
      titleSort: 'Zulu, Z.',
    });
    const books = await listBooks(prisma, booksRoot, OWNER);
    expect(books[0].id).toBe('id-a');
    expect(books[1].id).toBe('id-z');
  });

  it('falls back to title when titleSort is empty', async () => {
    await seedBook(prisma, { booksRoot }, OWNER, 'id-b', stage('id-b'), {
      ...FAKE_META,
      title: 'Banana',
      titleSort: '',
    });
    await seedBook(prisma, { booksRoot }, OWNER, 'id-a', stage('id-a'), {
      ...FAKE_META,
      title: 'Apple',
      titleSort: '',
    });
    const books = await listBooks(prisma, booksRoot, OWNER);
    expect(books[0].id).toBe('id-a');
    expect(books[1].id).toBe('id-b');
  });

  it('persists authorSort on stored books', async () => {
    const meta: EpubMeta = {
      ...FAKE_META,
      author: 'Isaac Asimov',
      authorSort: 'Asimov, Isaac',
    };
    await seedBook(prisma, { booksRoot }, OWNER, 'id-as', stage('id-as'), meta);
    const book = await getBookById(prisma, booksRoot, OWNER, 'id-as');
    expect(book!.authorSort).toBe('Asimov, Isaac');
  });

  it('persists publishDate on stored books', async () => {
    const meta: EpubMeta = {
      ...FAKE_META,
      publishDate: '2001-01-16',
    };
    await seedBook(prisma, { booksRoot }, OWNER, 'id-pd', stage('id-pd'), meta);
    const book = await getBookById(prisma, booksRoot, OWNER, 'id-pd');
    expect(book!.publishDate).toBe('2001-01-16');
  });

  it('stores and retrieves chapterNames (JSON round-trip)', async () => {
    await seedBook(prisma, { booksRoot }, OWNER, 'ch1', stage('ch1'), {
      ...FAKE_META,
      chapterCount: 2,
      chapterSpineMap: [1, 2],
      chapterNames: ['The Storm', 'The Calm'],
    });
    const book = await getBookById(prisma, booksRoot, OWNER, 'ch1');
    expect(book?.chapterNames).toEqual(['The Storm', 'The Calm']);
  });

  it('returns empty chapterNames array when column is NULL (pre-migration books)', async () => {
    // Simulate a book inserted without chapter_names (NULL default)
    await prisma.$executeRawUnsafe(
      `INSERT INTO books (user_id, id, title, size, mtime, added_at, chapter_count, chapter_spine_map) VALUES ('${OWNER.userId}', 'old-book', 'Old Book', 100, 0, 0, 0, '[]')`
    );
    const book = await getBookById(prisma, booksRoot, OWNER, 'old-book');
    expect(book?.chapterNames).toEqual([]);
  });

  it('exposes book.filename as the computed download name', async () => {
    await seedBook(prisma, { booksRoot }, OWNER, 'fname-1', stage('fname-1'), {
      ...FAKE_META,
      author: 'Frank Herbert',
      series: '',
      seriesIndex: 0,
      title: 'Dune',
    });
    const book = await getBookById(prisma, booksRoot, OWNER, 'fname-1');
    expect(book!.filename).toBe('Frank_Herbert-Dune.epub');
  });

  it('exposes book.path as <booksDir>/<id>.epub regardless of stored path', async () => {
    await seedBook(prisma, { booksRoot }, OWNER, 'path-1', stage('path-1'), FAKE_META);
    const book = await getBookById(prisma, booksRoot, OWNER, 'path-1');
    expect(book!.path).toBe(path.join(booksDir, 'path-1.epub'));
  });
});

describe('getBookById', () => {
  it('returns the book by id', async () => {
    await seedBook(prisma, { booksRoot }, OWNER, 'myid', stage('myid'), FAKE_META);
    const book = await getBookById(prisma, booksRoot, OWNER, 'myid');
    expect(book).not.toBeNull();
    expect(book!.filename).toBe('Author_Name-Test_Series-1-Test_Book.epub');
  });

  it('returns null for unknown id', async () => {
    expect(await getBookById(prisma, booksRoot, OWNER, 'unknown')).toBeNull();
  });
});

describe('getBookById deviceEditionCount', () => {
  it('includes the edition count when withEditionCount is requested', async () => {
    await seedBook(prisma, { booksRoot }, OWNER, 'cnt1', stage('cnt1'), FAKE_META);
    await prisma.device.create({
      data: { id: 'dvc', name: 'K', slug: 'k', coverFit: 'contain' },
    });
    await prisma.deviceEdition.create({
      data: {
        userId: OWNER.userId,
        originalBookId: 'cnt1',
        deviceId: 'dvc',
        editionId: 'e1',
        settingsHash: 'h',
      },
    });
    const book = await getBookById(prisma, booksRoot, OWNER, 'cnt1', { withEditionCount: true });
    expect(book?.deviceEditionCount).toBe(1);
  });

  it('omits the count when withEditionCount is not requested', async () => {
    await seedBook(prisma, { booksRoot }, OWNER, 'cnt2', stage('cnt2'), FAKE_META);
    const book = await getBookById(prisma, booksRoot, OWNER, 'cnt2');
    expect(book?.deviceEditionCount).toBeUndefined();
  });
});

describe('getSubjects', () => {
  it('returns sorted unique subjects across all books', async () => {
    await seedBook(prisma, { booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      subjects: ['Fiction', 'History'],
    });
    await seedBook(prisma, { booksRoot }, OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      subjects: ['Fiction', 'Science'],
    });
    const subjects = await getSubjects(prisma, OWNER);
    expect(subjects).toEqual(['Fiction', 'History', 'Science']);
  });

  it('returns empty array when no books have subjects', async () => {
    await seedBook(prisma, { booksRoot }, OWNER, 'b1', stage('b1'), { ...FAKE_META, subjects: [] });
    const subjects = await getSubjects(prisma, OWNER);
    expect(subjects).toEqual([]);
  });

  it('excludes non-string and blank subjects from mixed-type JSON', async () => {
    await prisma.$executeRaw`
      INSERT INTO books (user_id, id, title, subjects, size, mtime, added_at)
      VALUES (${OWNER.userId}, 'mixed-types', 'Mixed', '["Valid", 42, true, null, "  ", "Also Valid"]', 1, 1, 1)
    `;
    const subjects = await getSubjects(prisma, OWNER);
    expect(subjects).toEqual(['Also Valid', 'Valid']);
  });

  it('only returns subjects belonging to the given owner', async () => {
    const OTHER_ID = 'usr_other00000000000000000';
    await prisma.user.create({ data: { id: OTHER_ID, username: 'bob' } });
    const otherOwner = { userId: OTHER_ID, username: 'bob' };
    const otherDir = path.join(booksRoot, 'bob');
    fs.mkdirSync(otherDir, { recursive: true });
    const bobBook = path.join(otherDir, 'staged-b2.epub');
    fs.writeFileSync(bobBook, 'x');
    await seedBook(prisma, { booksRoot }, OWNER, 'a1', stage('a1'), {
      ...FAKE_META,
      subjects: ['AliceOnly'],
    });
    await seedBook(prisma, { booksRoot }, otherOwner, 'b2', bobBook, {
      ...FAKE_META,
      subjects: ['BobOnly'],
    });
    const subjects = await getSubjects(prisma, OWNER);
    expect(subjects).toEqual(['AliceOnly']);
    expect(subjects).not.toContain('BobOnly');
  });
});

describe('getAuthors', () => {
  it('returns empty array when no books', async () => {
    const authors = await getAuthors(prisma, OWNER);
    expect(authors).toEqual([]);
  });

  it('returns distinct authors sorted alphabetically', async () => {
    await seedBook(prisma, { booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      author: 'Zora Neale Hurston',
    });
    await seedBook(prisma, { booksRoot }, OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      author: 'Agatha Christie',
    });
    await seedBook(prisma, { booksRoot }, OWNER, 'b3', stage('b3'), {
      ...FAKE_META,
      author: 'Agatha Christie',
    });
    const authors = await getAuthors(prisma, OWNER);
    expect(authors).toEqual(['Agatha Christie', 'Zora Neale Hurston']);
  });

  it('excludes books with empty author', async () => {
    await seedBook(prisma, { booksRoot }, OWNER, 'b4', stage('b4'), { ...FAKE_META, author: '' });
    await seedBook(prisma, { booksRoot }, OWNER, 'b4b', stage('b4b'), {
      ...FAKE_META,
      author: 'Real Author',
    });
    const authors = await getAuthors(prisma, OWNER);
    expect(authors).toEqual(['Real Author']);
  });

  it('is scoped to owner', async () => {
    const alice: Owner = OWNER;
    const bob: Owner = { userId: 'usr_test000000000000001', username: 'bob' };
    await prisma.user.create({ data: { id: bob.userId, username: bob.username } });
    fs.mkdirSync(path.join(booksRoot, bob.username), { recursive: true });

    await seedBook(prisma, { booksRoot }, alice, 'b5', stage('b5'), {
      ...FAKE_META,
      author: 'Alice Author',
    });
    await seedBook(prisma, { booksRoot }, bob, 'b6', stage('b6'), {
      ...FAKE_META,
      author: 'Bob Author',
    });
    const authors = await getAuthors(prisma, alice);
    expect(authors).toContain('Alice Author');
    expect(authors).not.toContain('Bob Author');
  });
});

describe('listBooksByAuthor', () => {
  it('returns empty array for unknown author', async () => {
    const books = await listBooksByAuthor(prisma, booksRoot, OWNER, 'No One');
    expect(books).toEqual([]);
  });

  it('returns only books by the given author', async () => {
    await seedBook(prisma, { booksRoot }, OWNER, 'c1', stage('c1'), {
      ...FAKE_META,
      author: 'Jane Austen',
      title: 'Persuasion',
    });
    await seedBook(prisma, { booksRoot }, OWNER, 'c2', stage('c2'), {
      ...FAKE_META,
      author: 'Jane Austen',
      title: 'Emma',
    });
    await seedBook(prisma, { booksRoot }, OWNER, 'c3', stage('c3'), {
      ...FAKE_META,
      author: 'Other Author',
      title: 'Other Book',
    });
    const books = await listBooksByAuthor(prisma, booksRoot, OWNER, 'Jane Austen');
    expect(books.map((b) => b.title)).toEqual(['Emma', 'Persuasion']);
  });

  it('is scoped to owner', async () => {
    const alice: Owner = OWNER;
    const bob: Owner = { userId: 'usr_test000000000000001', username: 'bob' };
    await prisma.user.create({ data: { id: bob.userId, username: bob.username } });
    fs.mkdirSync(path.join(booksRoot, bob.username), { recursive: true });

    await seedBook(prisma, { booksRoot }, alice, 'c4', stage('c4'), {
      ...FAKE_META,
      author: 'Shared Author',
      title: 'Alice Copy',
    });
    await seedBook(prisma, { booksRoot }, bob, 'c5', stage('c5'), {
      ...FAKE_META,
      author: 'Shared Author',
      title: 'Bob Copy',
    });
    const books = await listBooksByAuthor(prisma, booksRoot, alice, 'Shared Author');
    expect(books.map((b) => b.title)).toEqual(['Alice Copy']);
  });
});

describe('listSeries', () => {
  it('returns empty array when no series exist', async () => {
    const series = await listSeries(prisma, OWNER);
    expect(series).toEqual([]);
  });

  it('returns series sorted by name', async () => {
    const alice: Owner = OWNER;
    const bob: Owner = { userId: 'usr_test000000000000001', username: 'bob' };
    await prisma.user.create({ data: { id: bob.userId, username: bob.username } });
    fs.mkdirSync(path.join(booksRoot, bob.username), { recursive: true });

    await seedBook(prisma, { booksRoot }, alice, 'd1', stage('d1'), {
      ...FAKE_META,
      series: 'Dune',
      seriesIndex: 1,
    });
    await seedBook(prisma, { booksRoot }, alice, 'd2', stage('d2'), {
      ...FAKE_META,
      series: 'Foundation',
      seriesIndex: 1,
    });
    const series = await listSeries(prisma, alice);
    expect(series.map((s) => s.name)).toEqual(['Dune', 'Foundation']);
    expect(series[0].bookCount).toBe(1);
  });

  it('is scoped to owner', async () => {
    const alice: Owner = OWNER;
    const bob: Owner = { userId: 'usr_test000000000000001', username: 'bob' };
    await prisma.user.create({ data: { id: bob.userId, username: bob.username } });
    fs.mkdirSync(path.join(booksRoot, bob.username), { recursive: true });

    await seedBook(prisma, { booksRoot }, alice, 'd3', stage('d3'), {
      ...FAKE_META,
      series: 'Alice Series',
      seriesIndex: 1,
    });
    await seedBook(prisma, { booksRoot }, bob, 'd4', stage('d4'), {
      ...FAKE_META,
      series: 'Bob Series',
      seriesIndex: 1,
    });
    const series = await listSeries(prisma, alice);
    expect(series.map((s) => s.name)).toContain('Alice Series');
    expect(series.map((s) => s.name)).not.toContain('Bob Series');
  });
});

describe('listBooksBySeries', () => {
  it('returns empty array for unknown seriesId', async () => {
    const books = await listBooksBySeries(prisma, booksRoot, OWNER, 'nonexistent-uuid');
    expect(books).toEqual([]);
  });

  it('returns books sorted by seriesIndex then title', async () => {
    const alice: Owner = OWNER;
    await seedBook(prisma, { booksRoot }, alice, 'e1', stage('e1'), {
      ...FAKE_META,
      series: 'The Expanse',
      seriesIndex: 1,
      title: 'Leviathan Wakes',
    });
    await seedBook(prisma, { booksRoot }, alice, 'e2', stage('e2'), {
      ...FAKE_META,
      series: 'The Expanse',
      seriesIndex: 3,
      title: "Abaddon's Gate",
    });
    await seedBook(prisma, { booksRoot }, alice, 'e3', stage('e3'), {
      ...FAKE_META,
      series: 'The Expanse',
      seriesIndex: 2,
      title: "Caliban's War",
    });
    const allSeries = await listSeries(prisma, alice);
    const expanse = allSeries.find((s) => s.name === 'The Expanse')!;
    const books = await listBooksBySeries(prisma, booksRoot, alice, expanse.id);
    expect(books.map((b) => b.title)).toEqual([
      'Leviathan Wakes',
      "Caliban's War",
      "Abaddon's Gate",
    ]);
  });

  it('is scoped to owner', async () => {
    const alice: Owner = OWNER;
    const bob: Owner = { userId: 'usr_test000000000000001', username: 'bob' };
    await prisma.user.create({ data: { id: bob.userId, username: bob.username } });
    fs.mkdirSync(path.join(booksRoot, bob.username), { recursive: true });

    await seedBook(prisma, { booksRoot }, alice, 'e4', stage('e4'), {
      ...FAKE_META,
      series: 'Shared Series',
      seriesIndex: 1,
      title: 'Alice Book',
    });
    await seedBook(prisma, { booksRoot }, bob, 'e5', stage('e5'), {
      ...FAKE_META,
      series: 'Shared Series',
      seriesIndex: 1,
      title: 'Bob Book',
    });
    const aliceSeries = await listSeries(prisma, alice);
    const s = aliceSeries.find((series) => series.name === 'Shared Series')!;
    const books = await listBooksBySeries(prisma, booksRoot, alice, s.id);
    expect(books.map((b) => b.title)).toEqual(['Alice Book']);
  });
});

describe('listBooksBySubject', () => {
  it('returns empty array when no books have the subject', async () => {
    const books = await listBooksBySubject(prisma, booksRoot, OWNER, 'Fantasy');
    expect(books).toEqual([]);
  });

  it('returns only books tagged with the given subject', async () => {
    await seedBook(prisma, { booksRoot }, OWNER, 'f1', stage('f1'), {
      ...FAKE_META,
      title: 'A Fantasy Book',
      subjects: ['Fantasy', 'Adventure'],
    });
    await seedBook(prisma, { booksRoot }, OWNER, 'f2', stage('f2'), {
      ...FAKE_META,
      title: 'A Sci-Fi Book',
      subjects: ['Science Fiction'],
    });
    await seedBook(prisma, { booksRoot }, OWNER, 'f3', stage('f3'), {
      ...FAKE_META,
      title: 'Another Fantasy',
      subjects: ['Fantasy'],
    });
    const books = await listBooksBySubject(prisma, booksRoot, OWNER, 'Fantasy');
    expect(books.map((b) => b.title).sort()).toEqual(['A Fantasy Book', 'Another Fantasy']);
  });

  it('is scoped to owner', async () => {
    const alice: Owner = OWNER;
    const bob: Owner = { userId: 'usr_test000000000000001', username: 'bob' };
    await prisma.user.create({ data: { id: bob.userId, username: bob.username } });
    fs.mkdirSync(path.join(booksRoot, bob.username), { recursive: true });

    await seedBook(prisma, { booksRoot }, alice, 'f4', stage('f4'), {
      ...FAKE_META,
      title: 'Alice Fantasy',
      subjects: ['Fantasy'],
    });
    await seedBook(prisma, { booksRoot }, bob, 'f5', stage('f5'), {
      ...FAKE_META,
      title: 'Bob Fantasy',
      subjects: ['Fantasy'],
    });
    const books = await listBooksBySubject(prisma, booksRoot, alice, 'Fantasy');
    expect(books.map((b) => b.title)).toContain('Alice Fantasy');
    expect(books.map((b) => b.title)).not.toContain('Bob Fantasy');
  });
});

describe('listBooksByStatus', () => {
  async function setProgress(userId: string, bookId: string, percentage: number): Promise<void> {
    await prisma.progress.upsert({
      where: { userId_document: { userId, document: bookId } },
      create: {
        userId,
        document: bookId,
        progress: String(percentage),
        percentage,
        device: 'test',
        deviceId: 'test-device',
        timestamp: Math.floor(Date.now() / 1000),
      },
      update: { percentage },
    });
  }

  it('returns all books for not-started when none have progress', async () => {
    await seedBook(prisma, { booksRoot }, OWNER, 'g1', stage('g1'), {
      ...FAKE_META,
      title: 'Book A',
    });
    const books = await listBooksByStatus(prisma, booksRoot, OWNER, 'not-started');
    expect(books.map((b) => b.id)).toContain('g1');
  });

  it('not-started excludes books with any progress', async () => {
    await seedBook(prisma, { booksRoot }, OWNER, 'g2', stage('g2'), {
      ...FAKE_META,
      title: 'Started Book',
    });
    await setProgress(OWNER.userId, 'g2', 0.5);
    const books = await listBooksByStatus(prisma, booksRoot, OWNER, 'not-started');
    expect(books.map((b) => b.id)).not.toContain('g2');
  });

  it('in-progress returns only partially read books', async () => {
    await seedBook(prisma, { booksRoot }, OWNER, 'g3', stage('g3'), {
      ...FAKE_META,
      title: 'In Progress',
    });
    await seedBook(prisma, { booksRoot }, OWNER, 'g4', stage('g4'), {
      ...FAKE_META,
      title: 'Unread',
    });
    await seedBook(prisma, { booksRoot }, OWNER, 'g5', stage('g5'), {
      ...FAKE_META,
      title: 'Done',
    });
    await setProgress(OWNER.userId, 'g3', 0.5);
    await setProgress(OWNER.userId, 'g5', 1.0);
    const books = await listBooksByStatus(prisma, booksRoot, OWNER, 'in-progress');
    expect(books.map((b) => b.id)).toEqual(['g3']);
  });

  it('completed returns only fully read books', async () => {
    await seedBook(prisma, { booksRoot }, OWNER, 'g6', stage('g6'), {
      ...FAKE_META,
      title: 'Complete',
    });
    await seedBook(prisma, { booksRoot }, OWNER, 'g7', stage('g7'), {
      ...FAKE_META,
      title: 'Partial',
    });
    await setProgress(OWNER.userId, 'g6', 1.0);
    await setProgress(OWNER.userId, 'g7', 0.3);
    const books = await listBooksByStatus(prisma, booksRoot, OWNER, 'completed');
    expect(books.map((b) => b.id)).toEqual(['g6']);
  });

  it('is scoped to owner', async () => {
    const alice: Owner = OWNER;
    const bob: Owner = { userId: 'usr_test000000000000001', username: 'bob' };
    await prisma.user.create({ data: { id: bob.userId, username: bob.username } });
    fs.mkdirSync(path.join(booksRoot, bob.username), { recursive: true });

    await seedBook(prisma, { booksRoot }, alice, 'g8', stage('g8'), {
      ...FAKE_META,
      title: 'Alice Book',
    });
    await seedBook(prisma, { booksRoot }, bob, 'g9', stage('g9'), {
      ...FAKE_META,
      title: 'Bob Book',
    });
    await setProgress(alice.userId, 'g8', 1.0);
    await setProgress(bob.userId, 'g9', 1.0);
    const books = await listBooksByStatus(prisma, booksRoot, alice, 'completed');
    expect(books.map((b) => b.id)).toContain('g8');
    expect(books.map((b) => b.id)).not.toContain('g9');
  });
});

describe('getBookById maps validation.valid', () => {
  it('reflects the stored validation valid flag, or null when unvalidated', async () => {
    await seedBook(prisma, { booksRoot }, OWNER, 'val-true', stage('val-true'), FAKE_META);
    await seedBook(prisma, { booksRoot }, OWNER, 'val-false', stage('val-false'), FAKE_META);
    await seedBook(prisma, { booksRoot }, OWNER, 'val-none', stage('val-none'), FAKE_META);
    await prisma.validation.create({
      data: {
        userId: OWNER.userId,
        bookId: 'val-true',
        valid: true,
        threshold: 'ERROR',
        validatedAt: 1,
      },
    });
    await prisma.validation.create({
      data: {
        userId: OWNER.userId,
        bookId: 'val-false',
        valid: false,
        threshold: 'ERROR',
        validatedAt: 1,
      },
    });

    expect((await getBookById(prisma, booksRoot, OWNER, 'val-true'))?.valid).toBe(true);
    expect((await getBookById(prisma, booksRoot, OWNER, 'val-false'))?.valid).toBe(false);
    expect((await getBookById(prisma, booksRoot, OWNER, 'val-none'))?.valid).toBeNull();
  });
});
