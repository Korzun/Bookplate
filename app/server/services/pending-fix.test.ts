import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import { runMigrations } from '../db/migrate';
import { seedBook } from '../test-support/seed-book';
import { EpubMeta, Owner } from '../types';
import { upsertPendingFix } from './pending-fix';

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
// and use `seedBook` (wrapping `addBook`) only for setup — every write under
// test goes through the imported `upsertPendingFix` directly.
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

const emptyState = () => ({ autoFixes: [], appliedFixes: [], proposals: [], undo: null });
const withProposal = () => ({
  ...emptyState(),
  proposals: [{ field: 'subjects', kind: 'subjects-split', from: 'A & B', to: null, changes: {} }],
});

// Moved from `book-store.test.ts`'s `describe('PendingFix store', ...)` — all
// 5 `it`s tested `upsertPendingFix`/`deletePendingFix`. 4 moved verbatim
// (call sites updated from `bookStore.upsertPendingFix` to the imported
// `upsertPendingFix(prisma, ...)`); `'deletePendingFix is idempotent'` was
// DROPPED, not moved — `deletePendingFix` is this phase's one inline (see
// `pending-fix.ts`'s doc comment) and no longer exists as a callable unit to
// unit-test. Its two behaviours are both covered at the call site in
// `graphql/schema/book/mutation/resolve-pending-fix.test.ts`: "CLEAR deletes
// the row outright" (deleting an existing row) and "CLEAR on a book with no
// pending-fix row succeeds as a no-op" (deleting when nothing exists, i.e.
// the idempotency this test checked).
describe('PendingFix store', () => {
  const readPendingFixes = (): Promise<{ bookId: string; state: string }[]> =>
    prisma.pendingFix.findMany({ where: { userId: OWNER.userId } });

  beforeEach(async () => {
    await seedBook(prisma, { booksRoot: booksRoot }, OWNER, 'abc123', stage('abc123'), FAKE_META);
  });

  it('upsert writes a row carrying the serialized state', async () => {
    await upsertPendingFix(prisma, OWNER, 'abc123', 'x.epub', 42, withProposal());
    const rows = await readPendingFixes();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bookId: 'abc123', fileName: 'x.epub', fileSize: 42 });
    expect(JSON.parse(rows[0].state).proposals).toHaveLength(1);
  });

  it('upsert with no proposals and no undo deletes the row', async () => {
    await upsertPendingFix(prisma, OWNER, 'abc123', 'x.epub', 42, withProposal());
    await upsertPendingFix(prisma, OWNER, 'abc123', 'x.epub', 42, emptyState());
    expect(await readPendingFixes()).toHaveLength(0);
  });

  // An undo-only row is persisted, not dropped on write — that is the
  // persist-undo-across-reload path. Whether it is still *shown* is a
  // read-time decision made by `isLivePendingFix` (`graphql/derive.ts`),
  // including its 7-day TTL boundary; see `derive.test.ts` for those cases.
  it('upsert persists an undo-only row', async () => {
    await upsertPendingFix(prisma, OWNER, 'abc123', 'x.epub', 42, {
      ...emptyState(),
      undo: { kind: 'dismiss', proposals: [], appliedFixes: [] },
    });
    const rows = await readPendingFixes();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].state).undo).not.toBeNull();
  });

  it('row follows a bookId change via FK onUpdate cascade', async () => {
    await upsertPendingFix(prisma, OWNER, 'abc123', 'x.epub', 42, withProposal());
    // Directly rename the book id to simulate reimport's tx.book.update
    await prisma.book.update({
      where: { userId_id: { userId: OWNER.userId, id: 'abc123' } },
      data: { id: 'def456' },
    });
    expect((await readPendingFixes()).map((r) => r.bookId)).toEqual(['def456']);
  });
});
