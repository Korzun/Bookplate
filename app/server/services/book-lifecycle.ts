import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { PrismaClient, Prisma } from '@prisma/client';

import { logger } from '../logger';
import { Book, EpubMeta, Owner } from '../types';
import { seriesSortKey } from '../utils/series-sort-key';
import { getBookById } from './book-catalog';
import { BookAlreadyExistsError, BookHashCollisionError } from './book-errors';
import { bookPath, getUserDir } from './book-paths';
import { purgeForBook } from './edition';
import { parseEpub, partialMD5 } from './epub-parser';
import { isPrismaError } from './prisma-errors';
import type { ScanProgress } from './scan-events';

const log = logger('BookLifecycle');

/** Compares two cover blobs (or their absence) for equality. */
function buffersEqual(a: Buffer | Uint8Array | null, b: Buffer | Uint8Array | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Buffer.from(a).equals(Buffer.from(b));
}

/**
 * Recomputes a series' denormalized aggregate columns (subjects, bookCount,
 * author, publisher, totalPages, totalSize) from its current member books.
 * Called from every write path that can change a series' membership or a
 * member book's aggregated fields — add, delete, reimport.
 *
 * NO DIRECT TESTS, DELIBERATELY: this was `services/series-meta.ts`'s exported
 * `recomputeSeriesMeta` until Phase 4 task 6 folded it in here as a private
 * function of its only importer (the file it left is now
 * `services/series-next-index.ts`, which records the same move). It is
 * covered transitively, through the write paths above that call it —
 * `book-lifecycle.test.ts`'s `describe('series aggregate metadata', ...)` and
 * its three `describe('Series lifecycle — ...', ...)` blocks. Do not read the
 * absence of a `recomputeSeriesMeta` describe as an absence of coverage.
 */
async function recomputeSeriesMeta(
  client: Pick<PrismaClient, 'book' | 'series'>,
  seriesId: string
): Promise<void> {
  const books = await client.book.findMany({
    where: { seriesId },
    select: { subjects: true, author: true, publisher: true, pageCount: true, size: true },
    orderBy: [{ addedAt: 'asc' }, { id: 'asc' }],
  });

  const bookCount = books.length;
  const totalPages = books.reduce((sum, b) => sum + b.pageCount, 0);
  const totalSize = books.reduce((sum, b) => sum + b.size, 0);

  const seenSubjects = new Map<string, string>();
  for (const book of books) {
    let parsedSubjects: string[];
    try {
      const parsed: unknown = JSON.parse(book.subjects);
      parsedSubjects = Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      parsedSubjects = [];
    }
    for (const s of parsedSubjects) {
      const key = s.toLowerCase();
      if (!seenSubjects.has(key)) seenSubjects.set(key, s);
    }
  }
  const subjects = [...seenSubjects.values()].sort((a, b) => a.localeCompare(b));

  const seenAuthors = new Map<string, string>();
  for (const book of books) {
    if (book.author) {
      const key = book.author.toLowerCase();
      if (!seenAuthors.has(key)) seenAuthors.set(key, book.author);
    }
  }
  const author = [...seenAuthors.values()].join(', ');

  const seenPublishers = new Map<string, string>();
  for (const book of books) {
    if (book.publisher) {
      const key = book.publisher.toLowerCase();
      if (!seenPublishers.has(key)) seenPublishers.set(key, book.publisher);
    }
  }
  const publisher = [...seenPublishers.values()].join(', ');

  await client.series.update({
    where: { id: seriesId },
    data: {
      subjects: JSON.stringify(subjects),
      bookCount,
      author,
      publisher,
      totalPages,
      totalSize,
    },
  });
}

export async function addBook(
  prisma: PrismaClient,
  booksRoot: string,
  owner: Owner,
  id: string,
  srcPath: string,
  meta: EpubMeta
): Promise<void> {
  const existing = await prisma.book.findUnique({
    where: { userId_id: { userId: owner.userId, id } },
    select: { id: true },
  });
  if (existing) {
    throw new BookAlreadyExistsError(id);
  }

  fs.mkdirSync(getUserDir(booksRoot, owner), { recursive: true });
  const targetPath = bookPath(booksRoot, owner, id);
  if (path.resolve(srcPath) !== path.resolve(targetPath)) {
    fs.renameSync(srcPath, targetPath);
  }

  const stat = fs.statSync(targetPath);
  const title = meta.title.trim();
  const titleSort = (meta.titleSort || '').trim();
  const authorSort = (meta.authorSort || '').trim();
  const publishDate = (meta.publishDate || '').trim();
  const author = (meta.author || '').trim();

  await prisma.$transaction(async (tx) => {
    let seriesId: string | null = null;
    const seriesName = meta.series.trim();
    if (seriesName) {
      const s = await tx.series.upsert({
        where: { userId_name: { userId: owner.userId, name: seriesName } },
        create: {
          id: randomUUID(),
          userId: owner.userId,
          name: seriesName,
          sortKey: seriesSortKey(seriesName),
        },
        update: {},
        select: { id: true },
      });
      seriesId = s.id;
    }

    await tx.book.create({
      data: {
        userId: owner.userId,
        id,
        title,
        titleSort,
        authorSort,
        publishDate,
        author,
        description: meta.description,
        publisher: meta.publisher,
        series: meta.series,
        seriesIndex: meta.seriesIndex,
        identifiers: JSON.stringify(meta.identifiers),
        subjects: JSON.stringify(meta.subjects),
        coverData: meta.coverData as unknown as Prisma.Bytes | null,
        coverMime: meta.coverMime,
        size: stat.size,
        mtime: stat.mtimeMs,
        addedAt: Date.now(),
        chapterCount: meta.chapterCount,
        chapterSpineMap: JSON.stringify(meta.chapterSpineMap),
        chapterNames: JSON.stringify(meta.chapterNames),
        pageCount: meta.pageCount,
        seriesId,
      },
    });

    if (seriesId) {
      await recomputeSeriesMeta(tx, seriesId);
    }
  });
}

export async function deleteBook(
  prisma: PrismaClient,
  booksRoot: string,
  editionsRoot: string,
  owner: Owner,
  id: string
): Promise<Book | null> {
  const book = await getBookById(prisma, booksRoot, owner, id);
  if (!book) return null;
  try {
    await prisma.$transaction(async (tx) => {
      // Capture seriesId before deleting the row
      const bookRow = await tx.book.findUnique({
        where: { userId_id: { userId: owner.userId, id } },
        select: { seriesId: true },
      });
      const seriesId = bookRow?.seriesId ?? null;

      try {
        await tx.book.delete({ where: { userId_id: { userId: owner.userId, id } } });
      } catch (err) {
        if (!isPrismaError(err, 'P2025')) throw err;
      }
      await tx.bookIdHistory.deleteMany({
        where: { userId: owner.userId, OR: [{ oldId: id }, { currentId: id }] },
      });

      if (seriesId) {
        const remaining = await tx.book.count({ where: { seriesId } });
        if (remaining === 0) {
          await tx.series.delete({ where: { id: seriesId } });
        } else {
          await recomputeSeriesMeta(tx, seriesId);
        }
      }
    });
  } finally {
    try {
      fs.unlinkSync(book.path);
    } catch {
      /* file already gone */
    }
  }
  try {
    await purgeForBook(prisma, editionsRoot, owner.userId, id);
  } catch (err) {
    log.warn(
      `deleteBook: edition-cache purge failed for "${id}" — ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return book;
}

/**
 * Deletes all cached device editions (DB rows + on-disk files) for a book
 * across every device. Returns the number cleared, or null when the book
 * does not exist. A rare recovery action for when a book's editions get into
 * a bad state; editions regenerate lazily on the next device download.
 */
export async function clearDeviceEditions(
  prisma: PrismaClient,
  booksRoot: string,
  editionsRoot: string,
  owner: Owner,
  id: string
): Promise<number | null> {
  const book = await getBookById(prisma, booksRoot, owner, id, { withEditionCount: true });
  if (!book) return null;
  const cleared = book.deviceEditionCount ?? 0;
  await purgeForBook(prisma, editionsRoot, owner.userId, id);
  return cleared;
}

export async function reimportBook(
  prisma: PrismaClient,
  booksRoot: string,
  editionsRoot: string,
  owner: Owner,
  id: string
): Promise<Book | null> {
  const exists = await prisma.book.findUnique({
    where: { userId_id: { userId: owner.userId, id } },
    select: { id: true, series: true, seriesId: true, coverData: true },
  });
  if (!exists) return null;
  const oldSeriesId = exists.seriesId;

  const filePath = bookPath(booksRoot, owner, id);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }
  const meta = parseEpub(filePath);
  const newId = partialMD5(filePath);

  // Cached per-width thumbnails are derived from the cover; if the cover changed we must
  // drop them so a stale thumbnail is never served — especially under the new immutable
  // cache URL, where it would otherwise be cached indefinitely. Regeneration happens via
  // the caller's thumbnail enqueue / reconcile.
  const coverChanged = !buffersEqual(exists.coverData, meta.coverData);

  if (newId !== id) {
    const collision = await prisma.book.findUnique({
      where: { userId_id: { userId: owner.userId, id: newId } },
      select: { id: true },
    });
    if (collision) {
      throw new BookHashCollisionError(newId);
    }
  }

  await prisma.$transaction(async (tx) => {
    // Resolve new seriesId
    let newSeriesId: string | null = null;
    const newSeriesName = meta.series.trim();
    const author = (meta.author || '').trim();
    if (newSeriesName) {
      const s = await tx.series.upsert({
        where: { userId_name: { userId: owner.userId, name: newSeriesName } },
        create: {
          id: randomUUID(),
          userId: owner.userId,
          name: newSeriesName,
          sortKey: seriesSortKey(newSeriesName),
        },
        update: {},
        select: { id: true },
      });
      newSeriesId = s.id;
    }

    if (newId !== id) {
      const oldPath = bookPath(booksRoot, owner, id);
      const newPath = bookPath(booksRoot, owner, newId);
      if (oldPath !== newPath) {
        fs.renameSync(oldPath, newPath);
      }

      // Update the book row (and cascade-update thumbnails via the FK onUpdate: Cascade).
      await tx.book.update({
        where: { userId_id: { userId: owner.userId, id } },
        data: {
          id: newId,
          title: meta.title.trim(),
          titleSort: (meta.titleSort || '').trim(),
          authorSort: (meta.authorSort || '').trim(),
          publishDate: (meta.publishDate || '').trim(),
          author,
          description: meta.description,
          publisher: meta.publisher,
          series: meta.series,
          seriesIndex: meta.seriesIndex,
          identifiers: JSON.stringify(meta.identifiers),
          subjects: JSON.stringify(meta.subjects),
          coverData: meta.coverData as unknown as Prisma.Bytes | null,
          coverMime: meta.coverMime,
          size: stat.size,
          mtime: stat.mtimeMs,
          chapterCount: meta.chapterCount,
          chapterSpineMap: JSON.stringify(meta.chapterSpineMap),
          chapterNames: JSON.stringify(meta.chapterNames),
          pageCount: meta.pageCount,
          seriesId: newSeriesId,
        },
      });

      // Progress has no FK to books and lineage is per-user, so migrate only
      // the owner's progress rows.
      const oldProgress = await tx.progress.findUnique({
        where: { userId_document: { userId: owner.userId, document: id } },
      });
      if (oldProgress) {
        const newProgress = await tx.progress.findUnique({
          where: { userId_document: { userId: owner.userId, document: newId } },
        });
        if (!newProgress || oldProgress.timestamp >= newProgress.timestamp) {
          if (newProgress) {
            await tx.progress.delete({
              where: { userId_document: { userId: owner.userId, document: newId } },
            });
          }
          await tx.progress.delete({
            where: { userId_document: { userId: owner.userId, document: id } },
          });
          await tx.progress.create({ data: { ...oldProgress, document: newId } });
        } else {
          await tx.progress.delete({
            where: { userId_document: { userId: owner.userId, document: id } },
          });
        }
      }

      // Record lineage and flatten any prior chains pointing to old id.
      //
      // `upsert` replaces an `INSERT OR REPLACE`, and `type: 'edit'` is spelled
      // out in BOTH branches to keep it equivalent. The raw statement omitted
      // `type`, and `INSERT OR REPLACE` deletes-then-inserts, so a replaced row
      // got the column DEFAULT back (`@default("edit")`). `upsert`'s update
      // branch does not — it leaves untouched columns alone — so omitting it
      // here would silently preserve a `'merge'` row's type while rewriting its
      // target, turning a manual link into something `clearEditLineage` no
      // longer collects and `unlinkDocument` still refuses. Setting it
      // explicitly reproduces the old behaviour exactly.
      const timestamp = Date.now();
      await tx.bookIdHistory.upsert({
        where: { userId_oldId: { userId: owner.userId, oldId: id } },
        create: { userId: owner.userId, oldId: id, currentId: newId, timestamp, type: 'edit' },
        update: { currentId: newId, timestamp, type: 'edit' },
      });
      // Flattening: every row that pointed at the OLD id now points at the new
      // head. Cannot touch the row just upserted — that one's `currentId` is
      // already `newId`, so it does not match this filter.
      await tx.bookIdHistory.updateMany({
        where: { userId: owner.userId, currentId: id },
        data: { currentId: newId },
      });
    } else {
      await tx.book.update({
        where: { userId_id: { userId: owner.userId, id } },
        data: {
          title: meta.title.trim(),
          titleSort: (meta.titleSort || '').trim(),
          authorSort: (meta.authorSort || '').trim(),
          publishDate: (meta.publishDate || '').trim(),
          author,
          description: meta.description,
          publisher: meta.publisher,
          series: meta.series,
          seriesIndex: meta.seriesIndex,
          identifiers: JSON.stringify(meta.identifiers),
          subjects: JSON.stringify(meta.subjects),
          coverData: meta.coverData as unknown as Prisma.Bytes | null,
          coverMime: meta.coverMime,
          size: stat.size,
          mtime: stat.mtimeMs,
          chapterCount: meta.chapterCount,
          chapterSpineMap: JSON.stringify(meta.chapterSpineMap),
          chapterNames: JSON.stringify(meta.chapterNames),
          pageCount: meta.pageCount,
          seriesId: newSeriesId,
        },
      });
    }

    // Invalidate stale thumbnails when the cover changed. In the id-change branch the
    // FK onUpdate: Cascade has already moved the rows to newId, so keying on newId
    // covers both branches.
    if (coverChanged) {
      await tx.bookThumbnail.deleteMany({
        where: { userId: owner.userId, bookId: newId },
      });
    }

    // Clean up the old Series row if it now has no books; recompute if it still has some
    if (oldSeriesId && oldSeriesId !== newSeriesId) {
      const remaining = await tx.book.count({ where: { seriesId: oldSeriesId } });
      if (remaining === 0) {
        await tx.series.delete({ where: { id: oldSeriesId } });
      } else {
        await recomputeSeriesMeta(tx, oldSeriesId);
      }
    }

    // Recompute the new series aggregates
    if (newSeriesId) {
      await recomputeSeriesMeta(tx, newSeriesId);
    }
  });

  try {
    await purgeForBook(prisma, editionsRoot, owner.userId, id);
    if (newId !== id) await purgeForBook(prisma, editionsRoot, owner.userId, newId);
  } catch (err) {
    log.warn(
      `reimportBook: edition-cache purge failed for "${id}" — ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return getBookById(prisma, booksRoot, owner, newId);
}

async function removeStaleBook(prisma: PrismaClient, userId: string, id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const book = await tx.book.findUnique({
      where: { userId_id: { userId, id } },
      select: { seriesId: true },
    });
    if (!book) return;

    await tx.book.delete({ where: { userId_id: { userId, id } } });

    if (book.seriesId) {
      const remaining = await tx.book.count({ where: { seriesId: book.seriesId } });
      if (remaining === 0) {
        await tx.series.delete({ where: { id: book.seriesId } });
      } else {
        await recomputeSeriesMeta(tx, book.seriesId);
      }
    }
  });
}

export async function scan(
  prisma: PrismaClient,
  booksRoot: string,
  owner: Owner,
  onProgress?: (progress: ScanProgress) => void
): Promise<{ imported: string[]; removed: string[] }> {
  const imported: string[] = [];
  const removed: string[] = [];
  const userDir = getUserDir(booksRoot, owner);

  const dbIdRows = await prisma.book.findMany({
    where: { userId: owner.userId },
    select: { id: true },
  });
  const dbIds = new Set(dbIdRows.map((r) => r.id));

  const diskFilenames: string[] = fs.existsSync(userDir)
    ? fs.readdirSync(userDir).filter((f) => path.extname(f).toLowerCase() === '.epub')
    : [];
  const totalImporting = diskFilenames.length;

  for (const [index, filename] of diskFilenames.entries()) {
    const processed = index + 1;
    // Reports the one outcome the branch below is about to take for this
    // file, at the exact point the loop already decides it — no branch is
    // added or reordered to make this possible. `bookId` is included only
    // when the branch has one in hand (`undefined` is dropped, never sent
    // as an explicit `bookId: undefined`).
    const emit = (
      outcome: 'imported' | 'renamed' | 'already-imported' | 'skipped',
      bookId?: string
    ): void => {
      onProgress?.({
        phase: 'importing',
        total: totalImporting,
        processed,
        filename,
        outcome,
        ...(bookId !== undefined ? { bookId } : {}),
      });
    };

    const filePath = path.join(userDir, filename);
    const stem = path.basename(filename, '.epub');

    // Fast path: file already at <id>.epub and that id is imported.
    if (/^[0-9a-f]{32}$/.test(stem) && dbIds.has(stem)) {
      emit('already-imported', stem);
      continue;
    }

    let id: string;
    let meta: EpubMeta;
    try {
      id = partialMD5(filePath);
      meta = parseEpub(filePath);
    } catch (err: unknown) {
      log.warn(
        `scan: skipping "${filename}" — ${err instanceof Error ? err.message : String(err)}`
      );
      emit('skipped');
      continue;
    }

    const canonicalPath = bookPath(booksRoot, owner, id);
    if (filePath !== canonicalPath) {
      if (fs.existsSync(canonicalPath)) {
        log.warn(`scan: skipping "${filename}" — canonical path ${id}.epub already occupied`);
        emit('skipped', id);
        continue;
      }
      fs.renameSync(filePath, canonicalPath);
    }

    if (dbIds.has(id)) {
      // Rename above was the only thing to do.
      emit('renamed', id);
      continue;
    }

    try {
      const titleFallback = meta.title.trim() || path.basename(filename, path.extname(filename));
      await addBook(prisma, booksRoot, owner, id, canonicalPath, { ...meta, title: titleFallback });
      dbIds.add(id);
      imported.push(filename);
      emit('imported', id);
    } catch (err: unknown) {
      log.warn(
        `scan: skipping "${filename}" — ${err instanceof Error ? err.message : String(err)}`
      );
      emit('skipped', id);
    }
  }

  // Stale rows: in DB but their canonical file is missing.
  const allIdRows = await prisma.book.findMany({
    where: { userId: owner.userId },
    select: { id: true },
  });
  const totalPruning = allIdRows.length;
  for (const [index, { id }] of allIdRows.entries()) {
    if (!fs.existsSync(bookPath(booksRoot, owner, id))) {
      await removeStaleBook(prisma, owner.userId, id);
      removed.push(id + '.epub');
    }
    onProgress?.({ phase: 'pruning', total: totalPruning, processed: index + 1, bookId: id });
  }

  return { imported, removed };
}
