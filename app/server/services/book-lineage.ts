import { Prisma, PrismaClient } from '@prisma/client';

import { Owner } from '../types';
import { DocumentAlreadyLinkedError, DocumentIsBookError, SelfLinkError } from './book-errors';

/**
 * A book's id-history lineage — extracted from `BookStore`. Covers
 * superseded-id resolution (`resolveBookId`, `getBookLineage`), manual
 * KOReader document merges (`linkDocument`, `unlinkDocument`), and organic
 * edit-chain cleanup (`clearEditLineage`). All five read or write the same
 * `book_id_history` table; `resolveBookId` additionally consults
 * `device_editions` for the device-edition-hash case.
 */

export async function resolveBookId(
  prisma: PrismaClient,
  userId: string,
  id: string
): Promise<string> {
  // `findUnique` on `@@id([userId, oldId])`, not a scan: the compound primary
  // key IS this lookup.
  const historyRow = await prisma.bookIdHistory.findUnique({
    where: { userId_oldId: { userId, oldId: id } },
    select: { currentId: true },
  });
  if (historyRow) return historyRow.currentId;
  // `findFirst`, matching the old `LIMIT 1`: `(userId, editionId)` is an
  // `@@index`, not a unique constraint, so more than one row can match in
  // principle and `findUnique` is not available.
  const edition = await prisma.deviceEdition.findFirst({
    where: { userId, editionId: id },
    select: { originalBookId: true },
  });
  if (edition) return edition.originalBookId;
  return id;
}

export type LineageEntry = {
  oldId: string;
  newId: string;
  timestamp: number;
  type: string;
};

/**
 * Turns one book's history rows — already ordered newest-first — into the
 * chain the lineage modal renders. Each entry's `newId` is its PREDECESSOR's
 * `oldId` (or the head id, for the newest), which is why the row order is
 * load-bearing rather than cosmetic: reorder two same-timestamp rows and the
 * chain silently mis-links.
 *
 * Shared by the single-book and batched readers below so the derivation has
 * exactly one definition.
 */
const deriveLineageEntries = (
  rows: readonly { old_id: string; timestamp: number; type: string }[],
  currentId: string
): LineageEntry[] =>
  rows.map((row, i, arr) => ({
    oldId: row.old_id,
    newId: i === 0 ? currentId : arr[i - 1].old_id,
    timestamp: row.timestamp,
    type: row.type,
  }));

/**
 * Lineage for MANY books in one query, keyed `userId -> currentId -> entries`.
 *
 * Exists because `Book.lineage` is reachable from `Library.entries`, a page of
 * up to 100 (`CONNECTION_LIMITS.libraryEntries.maxSize`). Read one book at a
 * time it measured 2 queries PER BOOK — one redundant existence check plus one
 * history read — i.e. 201 queries for a full page. See
 * `graphql/loaders/lineage.ts` for the loader that calls this.
 *
 * NO EXISTENCE CHECK, deliberately, and this is the difference from
 * `getBookLineage` below: the caller is a field on an already-resolved `Book`,
 * so the row provably exists. A book with no history and a book that does not
 * exist both yield no entries here, which is exactly what `Book.lineage`
 * already did with both cases (`lineage?.entries ?? []`).
 *
 * STAYS RAW, and not by oversight — the `rowid DESC` tiebreaker. `rowid` is
 * SQLite's implicit column, absent from `schema.prisma`, so Prisma cannot order
 * by it, and `BookIdHistory` has no other monotonic column (`@@id([userId,
 * oldId])`; `timestamp` collides, because `reimportBook` flattens a whole chain
 * inside ONE transaction and rows routinely share a millisecond). Fixing that
 * needs a `seq` column and a data migration — checked and recorded as audit
 * F-3, where it also turned out `@default(autoincrement())` does not validate
 * on SQLite for a non-primary-key field.
 *
 * `rowid` IS selected here, unlike in the single-book read, because grouping N
 * books' rows in JS means re-sorting per book — so the tiebreaker has to
 * survive the round trip rather than living only in the SQL `ORDER BY`.
 */
export async function getLineageEntriesBatch(
  prisma: PrismaClient,
  pairs: readonly { userId: string; currentId: string }[]
): Promise<Map<string, Map<string, LineageEntry[]>>> {
  const byUser = new Map<string, Map<string, LineageEntry[]>>();
  if (pairs.length === 0) return byUser;

  // Explicit `(user_id, current_id)` pairs, never a bare `current_id IN (...)`:
  // book ids are content hashes, so two users routinely hold the identical id
  // and a bare filter would hand one tenant's lineage to another.
  const filter = Prisma.join(
    pairs.map((p) => Prisma.sql`(user_id = ${p.userId} AND current_id = ${p.currentId})`),
    ' OR '
  );
  const rows = await prisma.$queryRaw<
    Array<{ user_id: string; current_id: string; old_id: string; timestamp: number; type: string }>
  >`
    SELECT user_id, current_id, old_id, timestamp, type, rowid AS rid
    FROM book_id_history
    WHERE ${filter}
    ORDER BY timestamp DESC, rid DESC
  `;

  const grouped = new Map<string, Map<string, typeof rows>>();
  for (const row of rows) {
    const byBook = grouped.get(row.user_id) ?? new Map<string, typeof rows>();
    byBook.set(row.current_id, [...(byBook.get(row.current_id) ?? []), row]);
    grouped.set(row.user_id, byBook);
  }

  for (const [userId, byBook] of grouped) {
    const out = new Map<string, LineageEntry[]>();
    for (const [currentId, bookRows] of byBook) {
      out.set(currentId, deriveLineageEntries(bookRows, currentId));
    }
    byUser.set(userId, out);
  }
  return byUser;
}

/**
 * One book's lineage, or `null` when the book does not exist — the existence
 * check is the whole difference from `getLineageEntriesBatch` above, and it is
 * a tested contract (`book-lineage.test.ts`: "returns null for a book that does
 * not exist", "returns null when called with a stale (old) ID").
 *
 * `Book.lineage` does NOT use this: it goes through the batched reader, because
 * its parent book provably exists and it needs the batching. This stays as the
 * single-book entry point and as the place that definition lives.
 */
export async function getBookLineage(
  prisma: PrismaClient,
  owner: Owner,
  id: string
): Promise<{ currentId: string; entries: LineageEntry[] } | null> {
  const book = await prisma.book.findUnique({
    where: { userId_id: { userId: owner.userId, id } },
    select: { id: true },
  });
  if (!book) return null;

  const batch = await getLineageEntriesBatch(prisma, [{ userId: owner.userId, currentId: id }]);
  return { currentId: id, entries: batch.get(owner.userId)?.get(id) ?? [] };
}

export async function linkDocument(
  prisma: PrismaClient,
  owner: Owner,
  bookId: string,
  documentId: string
): Promise<true | null> {
  if (documentId === bookId) throw new SelfLinkError();

  const book = await prisma.book.findUnique({
    where: { userId_id: { userId: owner.userId, id: bookId } },
    select: { id: true },
  });
  if (!book) return null;

  await prisma.$transaction(async (tx) => {
    const existing = await tx.bookIdHistory.findUnique({
      where: { userId_oldId: { userId: owner.userId, oldId: documentId } },
      select: { currentId: true },
    });
    if (existing) throw new DocumentAlreadyLinkedError(documentId);

    const isBook = await tx.book.findUnique({
      where: { userId_id: { userId: owner.userId, id: documentId } },
      select: { id: true },
    });
    if (isBook) throw new DocumentIsBookError(documentId);

    // Lineage is per-user, so only the owner's progress rows migrate.
    const orphanProgress = await tx.progress.findUnique({
      where: { userId_document: { userId: owner.userId, document: documentId } },
    });
    if (orphanProgress) {
      const targetProgress = await tx.progress.findUnique({
        where: { userId_document: { userId: owner.userId, document: bookId } },
      });
      if (!targetProgress || orphanProgress.timestamp >= targetProgress.timestamp) {
        if (targetProgress) {
          await tx.progress.delete({
            where: { userId_document: { userId: owner.userId, document: bookId } },
          });
        }
        await tx.progress.delete({
          where: { userId_document: { userId: owner.userId, document: documentId } },
        });
        await tx.progress.create({ data: { ...orphanProgress, document: bookId } });
      } else {
        await tx.progress.delete({
          where: { userId_document: { userId: owner.userId, document: documentId } },
        });
      }
    }

    await tx.bookIdHistory.create({
      data: {
        userId: owner.userId,
        oldId: documentId,
        currentId: bookId,
        timestamp: Date.now(),
        type: 'merge',
      },
    });
  });

  return true;
}

export async function unlinkDocument(
  prisma: PrismaClient,
  owner: Owner,
  bookId: string,
  documentId: string
): Promise<'deleted' | 'not_found' | 'edit_row'> {
  return await prisma.$transaction(async (tx) => {
    // `@@id([userId, oldId])` makes `oldId` unique per user, so this reads the
    // one candidate row and then checks `currentId` — the old raw query filtered
    // on all three columns at once, which is the same test in one step.
    const row = await tx.bookIdHistory.findUnique({
      where: { userId_oldId: { userId: owner.userId, oldId: documentId } },
      select: { currentId: true, type: true },
    });
    if (!row || row.currentId !== bookId) return 'not_found';
    if (row.type === 'edit') return 'edit_row';

    // By design, unlinking does not reverse the progress migration.
    // Progress that was migrated from documentId to bookId during linkDocument stays on bookId.
    await tx.bookIdHistory.delete({
      where: { userId_oldId: { userId: owner.userId, oldId: documentId } },
    });
    return 'deleted';
  });
}

/**
 * Delete a book's organic "edit" lineage rows (both directions). Because
 * reimportBook flattens the chain so every historical old id points at the
 * current head, passing the head id removes the whole edit chain. Manual
 * "merge" links and other users' rows are left intact. Returns rows deleted.
 */
export async function clearEditLineage(
  prisma: PrismaClient,
  owner: Owner,
  id: string
): Promise<number> {
  const { count } = await prisma.bookIdHistory.deleteMany({
    where: {
      userId: owner.userId,
      type: 'edit',
      OR: [{ oldId: id }, { currentId: id }],
    },
  });
  return count;
}
