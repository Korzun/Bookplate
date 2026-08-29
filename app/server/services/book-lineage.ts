import { PrismaClient } from '@prisma/client';

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

export async function getBookLineage(
  prisma: PrismaClient,
  owner: Owner,
  id: string
): Promise<{
  currentId: string;
  entries: { oldId: string; newId: string; timestamp: number; type: string }[];
} | null> {
  const book = await prisma.book.findUnique({
    where: { userId_id: { userId: owner.userId, id } },
    select: { id: true },
  });
  if (!book) return null;

  // THE ONE QUERY IN THIS FILE THAT STAYS RAW, and not by oversight: the
  // `rowid DESC` tiebreaker. `rowid` is SQLite's implicit column — it is not in
  // `schema.prisma`, so Prisma cannot order by it, and `BookIdHistory` carries
  // no other monotonic column to substitute (`@@id([userId, oldId])`,
  // `timestamp` is the only ordering key and it collides: `reimportBook`
  // flattens a whole chain inside ONE transaction, so several rows routinely
  // share a millisecond).
  //
  // The ordering is load-bearing, not cosmetic: `entries` below derives each
  // row's `newId` from its PREDECESSOR in this list, so a reordering of
  // same-timestamp rows silently mis-links the chain the lineage modal renders.
  // Dropping the tiebreaker would leave that order unspecified.
  //
  // Fixing this properly means giving the model a real tiebreaker column
  // (`seq Int @default(autoincrement())`) and a data migration — recorded in
  // the audit as F-3, deliberately not done here.
  const rows = await prisma.$queryRaw<Array<{ old_id: string; timestamp: number; type: string }>>`
    SELECT old_id, timestamp, type FROM book_id_history
    WHERE user_id = ${owner.userId} AND current_id = ${id}
    ORDER BY timestamp DESC, rowid DESC
  `;

  const entries = rows.map((row, i, arr) => ({
    oldId: row.old_id,
    newId: i === 0 ? id : arr[i - 1].old_id,
    timestamp: row.timestamp,
    type: row.type,
  }));

  return { currentId: id, entries };
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
