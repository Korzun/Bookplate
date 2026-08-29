import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import { runMigrations } from '../db/migrate';
import { seedBook } from '../test-support/seed-book';
import { EpubMeta, Owner } from '../types';
import { getSeriesNextIndex } from './series-next-index';

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
// and use `seedBook` (wrapping `addBook`) only for setup — every read under
// test goes through the imported `getSeriesNextIndex` directly.
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

// Originally moved from `book-store.test.ts`'s `describe('getSeriesNextIndex',
// ...)` (Phase 3 task 6) — assertions unchanged, calls retargeted from
// `bookStore.getSeriesNextIndex(...)` to the extracted
// `getSeriesNextIndex(prisma, ...)`.
//
// This file used to also hold `recomputeSeriesMeta` (as `series-meta.ts`),
// grouped by the shared word "series" rather than any shared consumer,
// helper, type, or state. Phase 4 task 6 folded `recomputeSeriesMeta` into
// `book-lifecycle.ts` as a private function — its only importer — and
// renamed this file from `series-meta.ts` to `series-next-index.ts` to match
// the single read it now holds. `recomputeSeriesMeta` has no direct tests;
// its behaviour is asserted only through the write paths that call it
// (`addBook`/`reimportBook`/`deleteBook`), covered by
// `book-lifecycle.test.ts`'s `describe('series aggregate metadata', ...)`
// and the three `describe('Series lifecycle — ...', ...)` blocks.
describe('getSeriesNextIndex', () => {
  it('returns 1 for a series with no books', async () => {
    expect(await getSeriesNextIndex(prisma, OWNER, 'Unknown')).toBe(1);
  });

  it('returns highest existing index + 1', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      series: 'Dune',
      seriesIndex: 1,
    });
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      series: 'Dune',
      seriesIndex: 3,
    });
    expect(await getSeriesNextIndex(prisma, OWNER, 'Dune')).toBe(4);
  });

  it('floors a fractional highest index before adding 1', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      series: 'Dune',
      seriesIndex: 2.5,
    });
    expect(await getSeriesNextIndex(prisma, OWNER, 'Dune')).toBe(3);
  });

  it('is scoped per user', async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      series: 'Dune',
      seriesIndex: 5,
    });
    const other = { ...OWNER, userId: `${OWNER.userId}-other` };
    expect(await getSeriesNextIndex(prisma, other, 'Dune')).toBe(1);
  });
});
