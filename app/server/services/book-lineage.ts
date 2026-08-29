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
  const rows = await prisma.$queryRaw<Array<{ current_id: string }>>`
    SELECT current_id FROM book_id_history WHERE user_id = ${userId} AND old_id = ${id}
  `;
  if (rows.length > 0) return rows[0].current_id;
  const editions = await prisma.$queryRaw<Array<{ original_book_id: string }>>`
    SELECT original_book_id FROM device_editions WHERE user_id = ${userId} AND edition_id = ${id} LIMIT 1
  `;
  if (editions.length > 0) return editions[0].original_book_id;
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
    const existing = await tx.$queryRaw<Array<{ current_id: string }>>`
      SELECT current_id FROM book_id_history
      WHERE user_id = ${owner.userId} AND old_id = ${documentId}
    `;
    if (existing.length > 0) throw new DocumentAlreadyLinkedError(documentId);

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

    await tx.$executeRaw`
      INSERT INTO book_id_history (user_id, old_id, current_id, timestamp, type)
      VALUES (${owner.userId}, ${documentId}, ${bookId}, ${Date.now()}, 'merge')
    `;
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
    const rows = await tx.$queryRaw<Array<{ type: string }>>`
      SELECT type FROM book_id_history
      WHERE user_id = ${owner.userId} AND old_id = ${documentId} AND current_id = ${bookId}
    `;
    if (rows.length === 0) return 'not_found';
    if (rows[0].type === 'edit') return 'edit_row';

    // By design, unlinking does not reverse the progress migration.
    // Progress that was migrated from documentId to bookId during linkDocument stays on bookId.
    await tx.$executeRaw`
      DELETE FROM book_id_history
      WHERE user_id = ${owner.userId} AND old_id = ${documentId} AND current_id = ${bookId}
    `;
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
  return await prisma.$executeRaw`
    DELETE FROM book_id_history
    WHERE user_id = ${owner.userId}
      AND type = 'edit'
      AND (old_id = ${id} OR current_id = ${id})
  `;
}
