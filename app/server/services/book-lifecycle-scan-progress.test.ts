import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import { runMigrations } from '../db/migrate';
import { EpubMeta, Owner } from '../types';
import { BookStore } from './book-store';
import type { ScanProgress } from './scan-events';

// Dedicated coverage for BookStore.scan()'s onProgress hook — kept in its own
// file rather than folded into book-lifecycle.test.ts (already the largest
// suite in this task), following the same "new file, existing suite
// unedited" split this file's predecessor (book-store-scan-progress.test.ts)
// used against book-store.test.ts. Renamed/retargeted for task 7: `scan()`
// now lives in `./book-lifecycle`, reached here (as before) through the
// `BookStore` facade.

vi.mock('../logger');
// `ScanImporter` is gone — `scan` now imports `parseEpub`/`partialMD5`
// directly from `./epub-parser`. `vi.fn(actual.X)` self-heals back to the
// real implementation on every `mockReset` (see book-lifecycle.test.ts's
// longer note on this same seam), so every test below stubs both right
// before the `scan()` call it targets via `armImporter`.
vi.mock('./epub-parser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./epub-parser')>();
  return { ...actual, parseEpub: vi.fn(actual.parseEpub), partialMD5: vi.fn(actual.partialMD5) };
});

import { parseEpub, partialMD5 } from './epub-parser';

const OWNER: Owner = { userId: 'usr_test000000000000000', username: 'alice' };

const FAKE_META: EpubMeta = {
  title: 'Test Book',
  author: 'Author Name',
  description: '',
  publisher: '',
  series: '',
  seriesIndex: 0,
  titleSort: '',
  authorSort: '',
  publishDate: '',
  identifiers: [],
  subjects: [],
  coverData: null,
  coverMime: null,
  chapterCount: 0,
  chapterSpineMap: [],
  chapterNames: [],
  pageCount: 0,
};

// Arms parseEpub/partialMD5 with a persistent (not "once") stub, matching how
// the old `makeMockImporter(): ScanImporter` handed a fresh importer object
// to each `scan()` call. `idFor`, when given, replaces the default
// filePath-keyed md5 hash — mirroring `makeMockImporter`'s own `idFor` param.
function armImporter(idFor?: (filePath: string) => string): void {
  vi.mocked(parseEpub).mockImplementation((): EpubMeta => ({ ...FAKE_META, title: 'Mock Title' }));
  vi.mocked(partialMD5).mockImplementation((filePath: string): string =>
    idFor ? idFor(filePath) : crypto.createHash('md5').update(filePath).digest('hex')
  );
}

let prisma: PrismaClient;
let booksRoot: string;
let booksDir: string;
let bookStore: BookStore;
let dbPath: string;
let editionsRoot: string;

beforeEach(async () => {
  booksRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'books-scan-progress-'));
  booksDir = path.join(booksRoot, OWNER.username);
  fs.mkdirSync(booksDir, { recursive: true });
  dbPath = path.join(
    os.tmpdir(),
    `test-scan-progress-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksRoot);
  await prisma.user.create({ data: { id: OWNER.userId, username: OWNER.username } });
  editionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-progress-editions-'));
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
  fs.rmSync(editionsRoot, { recursive: true });
});

function collect(): { events: ScanProgress[]; onProgress: (p: ScanProgress) => void } {
  const events: ScanProgress[] = [];
  return { events, onProgress: (p) => events.push(p) };
}

describe('BookStore.scan() onProgress', () => {
  it('is never called when there is nothing on disk and nothing in the DB', async () => {
    armImporter();
    const { events, onProgress } = collect();
    await bookStore.scan(OWNER, onProgress);
    expect(events).toEqual([]);
  });

  it('emits an importing/imported event with total=1, processed=1 and the new bookId', async () => {
    fs.writeFileSync(path.join(booksDir, 'new-book.epub'), 'content');
    armImporter();
    const { events, onProgress } = collect();
    await bookStore.scan(OWNER, onProgress);

    const importing = events.filter((e) => e.phase === 'importing');
    expect(importing).toHaveLength(1);
    const [event] = importing;
    expect(event).toMatchObject({
      phase: 'importing',
      total: 1,
      processed: 1,
      filename: 'new-book.epub',
      outcome: 'imported',
    });
    expect(event.phase === 'importing' && event.bookId).toBeTruthy();
  });

  it('emits already-imported with the stem as bookId for the fast path, no id computation needed', async () => {
    const id = 'dddd4444dddd4444dddd4444dddd4444';
    const filePath = path.join(booksDir, id + '.epub');
    fs.writeFileSync(filePath, 'content');
    await bookStore.addBook(OWNER, id, filePath, FAKE_META);

    armImporter();
    const { events, onProgress } = collect();
    const result = await bookStore.scan(OWNER, onProgress);
    expect(result.imported).toEqual([]);

    const importing = events.filter((e) => e.phase === 'importing');
    expect(importing).toHaveLength(1);
    expect(importing[0]).toMatchObject({
      phase: 'importing',
      total: 1,
      processed: 1,
      filename: id + '.epub',
      outcome: 'already-imported',
      bookId: id,
    });
  });

  it('emits skipped with no bookId when the importer fails to parse the file', async () => {
    fs.writeFileSync(path.join(booksDir, 'bad.epub'), 'bad');
    vi.mocked(parseEpub).mockImplementation(() => {
      throw new Error('parse failed');
    });
    vi.mocked(partialMD5).mockImplementation((filePath) =>
      crypto.createHash('md5').update(filePath).digest('hex')
    );
    const { events, onProgress } = collect();
    await bookStore.scan(OWNER, onProgress);

    const importing = events.filter((e) => e.phase === 'importing');
    expect(importing).toHaveLength(1);
    expect(importing[0]).toMatchObject({
      phase: 'importing',
      total: 1,
      processed: 1,
      filename: 'bad.epub',
      outcome: 'skipped',
    });
    expect(importing[0].phase === 'importing' && importing[0].bookId).toBeUndefined();
  });

  it('emits skipped with the computed bookId when the canonical path is already occupied by a different file', async () => {
    const id = 'eeee5555eeee5555eeee5555eeee5555';
    const canonicalPath = path.join(booksDir, id + '.epub');
    fs.writeFileSync(canonicalPath, 'canonical content');
    await bookStore.addBook(OWNER, id, canonicalPath, FAKE_META);

    // A second, arbitrarily-named file whose importer-computed id collides
    // with the one already occupying the canonical path.
    const arbitraryPath = path.join(booksDir, 'duplicate.epub');
    fs.writeFileSync(arbitraryPath, 'duplicate content');
    armImporter(() => id);

    const { events, onProgress } = collect();
    const result = await bookStore.scan(OWNER, onProgress);
    expect(result.imported).toEqual([]);

    const importing = events.filter(
      (e) => e.phase === 'importing' && e.filename === 'duplicate.epub'
    );
    expect(importing).toHaveLength(1);
    expect(importing[0]).toMatchObject({
      phase: 'importing',
      filename: 'duplicate.epub',
      outcome: 'skipped',
      bookId: id,
    });
  });

  it('emits renamed with the bookId when a rename resolves to an id already in the DB', async () => {
    const id = 'ffff6666ffff6666ffff6666ffff6666';
    // A row exists for `id`, but its canonical file is gone — the arbitrary-
    // named file below will be renamed into that empty canonical slot and
    // recognised as already-imported, not re-added.
    const originalPath = path.join(booksDir, id + '.epub');
    fs.writeFileSync(originalPath, 'content');
    await bookStore.addBook(OWNER, id, originalPath, FAKE_META);
    fs.unlinkSync(path.join(booksDir, id + '.epub'));

    const arbitraryPath = path.join(booksDir, 'arbitrary-name.epub');
    fs.writeFileSync(arbitraryPath, 'same content, arbitrary name');
    armImporter((filePath) => (filePath.includes('arbitrary') ? id : 'other'));

    const { events, onProgress } = collect();
    const result = await bookStore.scan(OWNER, onProgress);
    expect(result.imported).toEqual([]);
    expect(fs.existsSync(path.join(booksDir, id + '.epub'))).toBe(true);

    const importing = events.filter((e) => e.phase === 'importing');
    expect(importing).toHaveLength(1);
    expect(importing[0]).toMatchObject({
      phase: 'importing',
      filename: 'arbitrary-name.epub',
      outcome: 'renamed',
      bookId: id,
    });
  });

  it('emits one pruning event per DB row checked, with total = row count and processed reaching total', async () => {
    // Two rows survive on disk, one is stale (its file is removed after insert).
    for (const id of ['aaaa1111aaaa1111aaaa1111aaaa1111', 'bbbb2222bbbb2222bbbb2222bbbb2222']) {
      const p = path.join(booksDir, id + '.epub');
      fs.writeFileSync(p, 'x');
      await bookStore.addBook(OWNER, id, p, FAKE_META);
    }
    const staleId = 'cccc3333cccc3333cccc3333cccc3333';
    const stalePath = path.join(booksDir, staleId + '.epub');
    fs.writeFileSync(stalePath, 'x');
    await bookStore.addBook(OWNER, staleId, stalePath, FAKE_META);
    fs.unlinkSync(path.join(booksDir, staleId + '.epub'));

    armImporter();
    const { events, onProgress } = collect();
    const result = await bookStore.scan(OWNER, onProgress);
    expect(result.removed).toEqual([staleId + '.epub']);

    const pruning = events.filter((e) => e.phase === 'pruning');
    expect(pruning).toHaveLength(3);
    expect(pruning.every((e) => e.phase === 'pruning' && e.total === 3)).toBe(true);
    const processedValues = pruning.map((e) => (e.phase === 'pruning' ? e.processed : -1)).sort();
    expect(processedValues).toEqual([1, 2, 3]);
    const bookIds = pruning.map((e) => (e.phase === 'pruning' ? e.bookId : null)).sort();
    expect(bookIds).toEqual(
      ['aaaa1111aaaa1111aaaa1111aaaa1111', 'bbbb2222bbbb2222bbbb2222bbbb2222', staleId].sort()
    );
  });

  it('scan() behaves identically with no onProgress supplied (optional, existing callers unaffected)', async () => {
    fs.writeFileSync(path.join(booksDir, 'no-callback.epub'), 'content');
    armImporter();
    const result = await bookStore.scan(OWNER);
    expect(result.imported).toEqual(['no-callback.epub']);
  });
});
