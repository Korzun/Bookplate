import { randomUUID } from 'crypto';

import { Prisma, PrismaClient } from '@prisma/client';

import { Book, EpubMeta, Owner } from '../types';
import { seriesSortKey } from '../utils/series-sort-key';
import { BOOK_SELECT, prismaBookToBook } from './book-catalog';

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

/**
 * Books in one of the owner's collections, ordered by position (nulls last),
 * then title, then id. Returns `[]` for an unknown or another user's collection.
 */
export async function listBooksByCollection(
  prisma: PrismaClient,
  booksRoot: string,
  owner: Owner,
  collectionId: string
): Promise<Book[]> {
  const rows = await prisma.bookCollection.findMany({
    where: { userId: owner.userId, collectionId },
    select: { position: true, book: { select: BOOK_SELECT } },
  });
  rows.sort((a, b) => {
    if (a.position !== b.position) {
      if (a.position === null) return 1;
      if (b.position === null) return -1;
      return a.position - b.position;
    }
    if (a.book.title !== b.book.title) return a.book.title < b.book.title ? -1 : 1;
    return a.book.id < b.book.id ? -1 : a.book.id > b.book.id ? 1 : 0;
  });
  return rows.map((r) => prismaBookToBook(booksRoot, owner, r.book));
}

/** Collections each of the given books belongs to, keyed by book id, ordered by sortKey. */
export async function collectionsForBooks(
  prisma: PrismaClient,
  owner: Owner,
  bookIds: string[]
): Promise<Map<string, { id: string; name: string }[]>> {
  const map = new Map<string, { id: string; name: string }[]>();
  if (bookIds.length === 0) return map;
  const rows = await prisma.bookCollection.findMany({
    where: { userId: owner.userId, bookId: { in: bookIds } },
    select: { bookId: true, collection: { select: { id: true, name: true, sortKey: true } } },
  });
  rows.sort((a, b) =>
    a.collection.sortKey < b.collection.sortKey
      ? -1
      : a.collection.sortKey > b.collection.sortKey
        ? 1
        : 0
  );
  for (const r of rows) {
    const list = map.get(r.bookId) ?? [];
    list.push({ id: r.collection.id, name: r.collection.name });
    map.set(r.bookId, list);
  }
  return map;
}
