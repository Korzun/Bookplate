import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import { runMigrations } from '../db/migrate';
import { EpubMeta, Owner } from '../types';
import { DocumentAlreadyLinkedError, DocumentIsBookError, SelfLinkError } from './book-errors';
import {
  clearEditLineage,
  getBookLineage,
  linkDocument,
  resolveBookId,
  unlinkDocument,
} from './book-lineage';
import { BookStore } from './book-store';

vi.mock('../logger');
// The vi.mock() factory below only sets these defaults once, at module load;
// vite.config.ts's `mockReset: true` wipes them before every test. Every
// call site here arms both with mockImplementationOnce (via `armImporter`)
// right before the reimportBook call it targets, so no shared default needs
// re-arming in a beforeEach.
vi.mock('./epub-parser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./epub-parser')>()),
  parseEpub: vi.fn(),
  partialMD5: vi.fn(),
}));

import { parseEpub, partialMD5 } from './epub-parser';

const OWNER: Owner = { userId: 'usr_test000000000000000', username: 'alice' };

function stage(id: string, content: string | Buffer = 'x'): string {
  const p = path.join(booksDir, `staged-${id}.epub`);
  fs.writeFileSync(p, content);
  return p;
}

// Direct SQL helper scoped to OWNER, keeping the per-user table shape in mind.
// Duplicated from `book-store.test.ts` (still needed there for `deleteBook`'s
// own cascade test) rather than shared, mirroring `stage`'s established
// per-file duplication (task 4's `book-catalog.test.ts`).
async function insertHistory(
  oldId: string,
  currentId: string,
  opts: { timestamp?: number; type?: string } = {}
): Promise<void> {
  const ts = opts.timestamp ?? Date.now();
  if (opts.type !== undefined) {
    await prisma.$executeRaw`
      INSERT INTO book_id_history (user_id, old_id, current_id, timestamp, type)
      VALUES (${OWNER.userId}, ${oldId}, ${currentId}, ${ts}, ${opts.type})
    `;
  } else {
    await prisma.$executeRaw`
      INSERT INTO book_id_history (user_id, old_id, current_id, timestamp)
      VALUES (${OWNER.userId}, ${oldId}, ${currentId}, ${ts})
    `;
  }
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
// and use the owner-scoped BookStore only for setup (`addBook`/`reimportBook`)
// — every read/write under test goes through the imported book-lineage
// functions directly.
let booksDir: string;
let editionsRoot: string;
let bookStore: BookStore;
let dbPath: string;

// Arms the mocked parseEpub/partialMD5 for exactly the next reimportBook
// call, so it reports `newId` as the freshly-computed hash — replaces the
// per-describe `makeImporterWithId(newId): ScanImporter` helper this file
// used before `reimportBook` took its importer via direct module imports
// instead of a constructor argument.
function armImporter(newId: string): void {
  vi.mocked(parseEpub).mockImplementationOnce(() => ({ ...FAKE_META, title: 'Lineage Book' }));
  vi.mocked(partialMD5).mockImplementationOnce(() => newId);
}

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

// Split from `book-store.test.ts`'s `describe('book_id_history table', ...)`
// (task 5): that block mixed table-schema assertions (column presence, the
// `type` CHECK constraint) with `resolveBookId`'s own behaviour. The 4 `it`s
// below are the `resolveBookId` ones; the other 3 ('creates the
// book_id_history table during migration', 'has a type column with default
// value edit', 'rejects invalid type values via CHECK constraint') stayed in
// `book-store.test.ts` — they assert on the table itself, not on any moved
// function.
describe('resolveBookId', () => {
  it('resolveBookId returns the input unchanged when no history exists', async () => {
    expect(await resolveBookId(prisma, OWNER.userId, 'unknown-id')).toBe('unknown-id');
  });

  it('resolveBookId returns current_id when a mapping exists', async () => {
    await insertHistory('old-id', 'new-id', { type: 'merge' });
    expect(await resolveBookId(prisma, OWNER.userId, 'old-id')).toBe('new-id');
  });

  it('resolveBookId is scoped to the owner — a mapping for another user is ignored', async () => {
    await prisma.user.create({ data: { id: 'usr_other00000000000000', username: 'bob' } });
    await prisma.$executeRaw`
      INSERT INTO book_id_history (user_id, old_id, current_id, timestamp, type)
      VALUES ('usr_other00000000000000', 'shared-old', 'bob-new', ${Date.now()}, 'merge')
    `;
    expect(await resolveBookId(prisma, OWNER.userId, 'shared-old')).toBe('shared-old');
  });

  it('resolveBookId maps a device edition hash to the original book', async () => {
    await prisma.device.create({
      data: { id: 'dv', name: 'K', slug: 'k', coverFit: 'contain' },
    });
    await prisma.deviceEdition.create({
      data: {
        userId: OWNER.userId,
        originalBookId: 'bookX',
        deviceId: 'dv',
        editionId: 'editionHashX',
        settingsHash: 'h',
      },
    });
    expect(await resolveBookId(prisma, OWNER.userId, 'editionHashX')).toBe('bookX');
    expect(await resolveBookId(prisma, OWNER.userId, 'unknown')).toBe('unknown');
  });
});

describe('resolveBookId — lineage via reimportBook', () => {
  it('single hop: resolveBookId(old) returns new after reimport changes ID', async () => {
    const stagedPath = stage('lineage-a');
    await bookStore.addBook(OWNER, 'id-a', stagedPath, FAKE_META);
    armImporter('id-b');
    await bookStore.reimportBook(OWNER, 'id-a');
    expect(await resolveBookId(prisma, OWNER.userId, 'id-a')).toBe('id-b');
  });

  it('multi-hop: resolveBookId(original) returns latest after two reimports', async () => {
    const stagedPath = stage('lineage-multi');
    await bookStore.addBook(OWNER, 'id-a', stagedPath, FAKE_META);
    // First hop: id-a → id-b
    armImporter('id-b');
    await bookStore.reimportBook(OWNER, 'id-a');
    // Write a file at id-b so reimportBook can stat it
    fs.writeFileSync(path.join(booksDir, 'id-b.epub'), 'epub-content');
    // Second hop: id-b → id-c (also flattens id-a → id-c)
    armImporter('id-c');
    await bookStore.reimportBook(OWNER, 'id-b');
    expect(await resolveBookId(prisma, OWNER.userId, 'id-a')).toBe('id-c');
    expect(await resolveBookId(prisma, OWNER.userId, 'id-b')).toBe('id-c');
  });

  it('no history entry when ID does not change on reimport', async () => {
    const stagedPath = stage('lineage-noop');
    await bookStore.addBook(OWNER, 'id-a', stagedPath, FAKE_META);
    armImporter('id-a');
    await bookStore.reimportBook(OWNER, 'id-a');
    expect(await resolveBookId(prisma, OWNER.userId, 'id-a')).toBe('id-a');
    const rows = await prisma.$queryRaw<Array<unknown>>`
      SELECT * FROM book_id_history WHERE old_id = 'id-a'
    `;
    expect(rows).toHaveLength(0);
  });

  describe('getBookLineage', () => {
    it('returns null for a book that does not exist', async () => {
      expect(await getBookLineage(prisma, OWNER, 'no-such-id')).toBeNull();
    });

    it('returns currentId with empty entries for a book with no history', async () => {
      await bookStore.addBook(OWNER, 'id-a', stage('id-a'), FAKE_META);
      const result = await getBookLineage(prisma, OWNER, 'id-a');
      expect(result).toEqual({ currentId: 'id-a', entries: [] });
    });

    it('returns one entry after a single reimport that changes the ID', async () => {
      const before = Date.now();
      await bookStore.addBook(OWNER, 'id-a', stage('id-a'), FAKE_META);
      const epubPath = path.join(booksDir, 'id-a.epub');
      fs.writeFileSync(epubPath, 'content-a');
      armImporter('id-b');
      await bookStore.reimportBook(OWNER, 'id-a');
      const after = Date.now();

      const result = await getBookLineage(prisma, OWNER, 'id-b');
      expect(result).not.toBeNull();
      expect(result!.currentId).toBe('id-b');
      expect(result!.entries).toHaveLength(1);
      expect(result!.entries[0].oldId).toBe('id-a');
      expect(result!.entries[0].newId).toBe('id-b');
      expect(result!.entries[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(result!.entries[0].timestamp).toBeLessThanOrEqual(after);
    });

    it('entries are ordered newest-first', async () => {
      await bookStore.addBook(OWNER, 'id-a', stage('id-a'), FAKE_META);
      fs.writeFileSync(path.join(booksDir, 'id-a.epub'), 'content-a');
      armImporter('id-b');
      await bookStore.reimportBook(OWNER, 'id-a');
      fs.writeFileSync(path.join(booksDir, 'id-b.epub'), 'content-b');
      armImporter('id-c');
      await bookStore.reimportBook(OWNER, 'id-b');

      const result = await getBookLineage(prisma, OWNER, 'id-c');
      expect(result!.entries).toHaveLength(2);
      expect(result!.entries[0].oldId).toBe('id-b');
      expect(result!.entries[0].newId).toBe('id-c');
      expect(result!.entries[1].oldId).toBe('id-a');
      expect(result!.entries[1].newId).toBe('id-b');
      expect(result!.entries[0].timestamp).toBeGreaterThanOrEqual(result!.entries[1].timestamp);
    });

    it('returns null when called with a stale (old) ID that has been reimported', async () => {
      await bookStore.addBook(OWNER, 'id-a', stage('id-a'), FAKE_META);
      fs.writeFileSync(path.join(booksDir, 'id-a.epub'), 'content-a');
      armImporter('id-b');
      await bookStore.reimportBook(OWNER, 'id-a');

      // id-a is no longer a current book; getBookLineage should return null for it
      expect(await getBookLineage(prisma, OWNER, 'id-a')).toBeNull();
      // id-b is the current book and should return normally
      expect(await getBookLineage(prisma, OWNER, 'id-b')).not.toBeNull();
    });
  });
});

describe('getBookLineage returns type on entries', () => {
  it('returns type edit for reimport-created entries', async () => {
    await bookStore.addBook(OWNER, 'id-a', stage('id-a'), FAKE_META);
    fs.writeFileSync(path.join(booksDir, 'id-a.epub'), 'content');
    armImporter('id-b');
    await bookStore.reimportBook(OWNER, 'id-a');

    const result = await getBookLineage(prisma, OWNER, 'id-b');
    expect(result!.entries[0].type).toBe('edit');
  });
});

describe('linkDocument', () => {
  it('returns null when target book does not exist', async () => {
    const result = await linkDocument(prisma, OWNER, 'no-such-book', 'orphan-1');
    expect(result).toBeNull();
  });

  it('throws SelfLinkError when documentId equals bookId', async () => {
    await bookStore.addBook(OWNER, 'self-link', stage('self-link'), FAKE_META);
    await expect(linkDocument(prisma, OWNER, 'self-link', 'self-link')).rejects.toThrow(
      SelfLinkError
    );
  });

  it('throws DocumentAlreadyLinkedError when documentId is already linked', async () => {
    await bookStore.addBook(OWNER, 'target', stage('target'), FAKE_META);
    await insertHistory('already-linked', 'target', { type: 'merge' });
    await expect(linkDocument(prisma, OWNER, 'target', 'already-linked')).rejects.toThrow(
      DocumentAlreadyLinkedError
    );
  });

  it('inserts a merge entry and migrates progress', async () => {
    await bookStore.addBook(OWNER, 'link-target', stage('link-target'), FAKE_META);
    await prisma.progress.create({
      data: {
        userId: OWNER.userId,
        document: 'orphan-doc',
        progress: '',
        percentage: 0.5,
        device: 'Kobo',
        deviceId: 'dev-1',
        timestamp: 1000,
      },
    });

    const result = await linkDocument(prisma, OWNER, 'link-target', 'orphan-doc');
    expect(result).toBe(true);

    const rows = await prisma.$queryRaw<Array<{ type: string }>>`
      SELECT type FROM book_id_history WHERE old_id = 'orphan-doc' AND current_id = 'link-target'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('merge');

    const targetProgress = await prisma.progress.findUnique({
      where: { userId_document: { userId: OWNER.userId, document: 'link-target' } },
    });
    expect(targetProgress).not.toBeNull();
    expect(targetProgress!.percentage).toBe(0.5);

    const orphanProgress = await prisma.progress.findUnique({
      where: { userId_document: { userId: OWNER.userId, document: 'orphan-doc' } },
    });
    expect(orphanProgress).toBeNull();
  });

  it('keeps newer progress when both orphan and target have records (newer-wins)', async () => {
    await bookStore.addBook(OWNER, 'nw-target', stage('nw-target'), FAKE_META);
    await prisma.progress.create({
      data: {
        userId: OWNER.userId,
        document: 'nw-orphan',
        progress: '',
        percentage: 0.3,
        device: 'Kobo',
        deviceId: 'dev-2',
        timestamp: 100,
      },
    });
    await prisma.progress.create({
      data: {
        userId: OWNER.userId,
        document: 'nw-target',
        progress: '',
        percentage: 0.8,
        device: 'Web',
        deviceId: 'dev-3',
        timestamp: 200,
      },
    });

    await linkDocument(prisma, OWNER, 'nw-target', 'nw-orphan');

    const targetProgress = await prisma.progress.findUnique({
      where: { userId_document: { userId: OWNER.userId, document: 'nw-target' } },
    });
    expect(targetProgress!.percentage).toBe(0.8);
  });

  it('orphan progress wins when it is newer', async () => {
    await bookStore.addBook(OWNER, 'ow-target', stage('ow-target'), FAKE_META);
    await prisma.progress.create({
      data: {
        userId: OWNER.userId,
        document: 'ow-orphan',
        progress: '',
        percentage: 0.9,
        device: 'Kobo',
        deviceId: 'dev-4',
        timestamp: 300,
      },
    });
    await prisma.progress.create({
      data: {
        userId: OWNER.userId,
        document: 'ow-target',
        progress: '',
        percentage: 0.1,
        device: 'Web',
        deviceId: 'dev-5',
        timestamp: 100,
      },
    });

    await linkDocument(prisma, OWNER, 'ow-target', 'ow-orphan');

    const targetProgress = await prisma.progress.findUnique({
      where: { userId_document: { userId: OWNER.userId, document: 'ow-target' } },
    });
    expect(targetProgress!.percentage).toBe(0.9);
  });

  it('throws DocumentIsBookError when documentId is an existing book', async () => {
    await bookStore.addBook(OWNER, 'doc-is-book-target', stage('doc-is-book-target'), FAKE_META);
    await bookStore.addBook(OWNER, 'doc-is-book-doc', stage('doc-is-book-doc'), FAKE_META);
    await expect(
      linkDocument(prisma, OWNER, 'doc-is-book-target', 'doc-is-book-doc')
    ).rejects.toThrow(DocumentIsBookError);
  });
});

describe('unlinkDocument', () => {
  it('returns not_found when no matching row exists', async () => {
    const result = await unlinkDocument(prisma, OWNER, 'no-book', 'no-doc');
    expect(result).toBe('not_found');
  });

  it('returns edit_row when the row has type=edit', async () => {
    await bookStore.addBook(OWNER, 'ul-target', stage('ul-target'), FAKE_META);
    await insertHistory('ul-edit-doc', 'ul-target', { type: 'edit' });
    const result = await unlinkDocument(prisma, OWNER, 'ul-target', 'ul-edit-doc');
    expect(result).toBe('edit_row');
  });

  it('deletes the merge row and returns deleted', async () => {
    await bookStore.addBook(OWNER, 'ul-target2', stage('ul-target2'), FAKE_META);
    await insertHistory('ul-merge-doc', 'ul-target2', { type: 'merge' });
    const result = await unlinkDocument(prisma, OWNER, 'ul-target2', 'ul-merge-doc');
    expect(result).toBe('deleted');

    const rows = await prisma.$queryRaw<Array<unknown>>`
      SELECT * FROM book_id_history WHERE old_id = 'ul-merge-doc'
    `;
    expect(rows).toHaveLength(0);
  });

  it('leaves progress records untouched when unlinking', async () => {
    await bookStore.addBook(OWNER, 'ul-prog-target', stage('ul-prog-target'), FAKE_META);
    await insertHistory('ul-prog-orphan', 'ul-prog-target', { type: 'merge' });
    await prisma.progress.create({
      data: {
        userId: OWNER.userId,
        document: 'ul-prog-target',
        progress: '',
        percentage: 0.6,
        device: 'Kobo',
        deviceId: 'dev-6',
        timestamp: 500,
      },
    });

    await unlinkDocument(prisma, OWNER, 'ul-prog-target', 'ul-prog-orphan');

    const progress = await prisma.progress.findUnique({
      where: { userId_document: { userId: OWNER.userId, document: 'ul-prog-target' } },
    });
    expect(progress).not.toBeNull();
    expect(progress!.percentage).toBe(0.6);
  });
});

describe('clearEditLineage', () => {
  it('deletes edit rows for the book/owner and leaves merge rows and other users', async () => {
    await bookStore.addBook(OWNER, 'cel-head', stage('cel-head'), FAKE_META);
    await insertHistory('cel-old-a', 'cel-head', { type: 'edit' });
    await insertHistory('cel-old-b', 'cel-head', { type: 'merge' });
    await prisma.$executeRaw`
      INSERT INTO book_id_history (user_id, old_id, current_id, timestamp, type)
      VALUES ('other-user', 'cel-old-c', 'cel-head', ${Date.now()}, 'edit')
    `;

    const deleted = await clearEditLineage(prisma, OWNER, 'cel-head');
    expect(deleted).toBe(1);

    const remaining = await prisma.$queryRaw<
      Array<{ old_id: string; type: string; user_id: string }>
    >`
      SELECT old_id, type, user_id FROM book_id_history WHERE current_id = 'cel-head' ORDER BY old_id`;
    expect(remaining.map((r) => r.old_id)).toEqual(['cel-old-b', 'cel-old-c']); // merge kept, other user kept
  });

  it('is a no-op (0) when there is no edit lineage for the book', async () => {
    expect(await clearEditLineage(prisma, OWNER, 'cel-nope')).toBe(0);
  });

  it('also deletes edit rows where the target id is the old_id (reverse direction)', async () => {
    await bookStore.addBook(OWNER, 'cel-target', stage('cel-target'), FAKE_META);
    // This row's old_id — not current_id — matches the target, exercising the
    // `old_id = id` side of the OR predicate.
    await insertHistory('cel-target', 'cel-other-head', { type: 'edit' });

    const deleted = await clearEditLineage(prisma, OWNER, 'cel-target');
    expect(deleted).toBe(1);

    const remaining = await prisma.$queryRaw<Array<{ old_id: string }>>`
      SELECT old_id FROM book_id_history WHERE old_id = 'cel-target'`;
    expect(remaining).toHaveLength(0);
  });
});
