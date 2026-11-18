import { randomUUID } from 'crypto';

import { Prisma } from '@prisma/client';

import { EpubMeta } from '../types';
import { seriesSortKey } from '../utils/series-sort-key';

/**
 * Replaces a book's collection join rows with `collections`, upserting each
 * Collection by (userId, name). Collections left without books are NOT removed
 * here; call `pruneEmptyCollections` once the surrounding write is done.
 */
export async function syncBookCollections(
  tx: Prisma.TransactionClient,
  userId: string,
  bookId: string,
  collections: EpubMeta['collections']
): Promise<void> {
  await tx.bookCollection.deleteMany({ where: { userId, bookId } });
  for (const { name, position } of collections) {
    const collection = await tx.collection.upsert({
      where: { userId_name: { userId, name } },
      create: { id: randomUUID(), userId, name, sortKey: seriesSortKey(name) },
      update: {},
      select: { id: true },
    });
    await tx.bookCollection.create({
      data: { userId, bookId, collectionId: collection.id, position },
    });
  }
}

/** Deletes the user's collections that no book belongs to. */
export async function pruneEmptyCollections(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<void> {
  await tx.collection.deleteMany({ where: { userId, books: { none: {} } } });
}
