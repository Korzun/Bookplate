import type { Book, PrismaClient } from '@prisma/client';

import { createPairLoader, groupByPair, type PairLoader } from './pair-loader';

export type BookByDocumentLoader = PairLoader<Book | null>;

/**
 * Batches `Progress.book` lookups so a page of N progress rows issues one
 * `findMany` instead of N `findUnique` calls. See `pair-loader.ts` for the
 * shared mechanics.
 *
 * **`document` IS the book's raw id.** `Progress.document` and `Book.id` are
 * the same KOReader content hash — `routes/kosync.ts` writes
 * `progress.document` as `resolveBookId(...)`'s result, the very value that
 * becomes a book's current `id` once imported — so this is a `(userId, id)`
 * pair query on `book`, not a join through any foreign key (`Progress` has
 * none to `Book`).
 *
 * Adding that relation was tried and MEASURED: `t.relation('book')` took a
 * page of 8 from 2 queries to 9, because `Library.progress` is hand-built and
 * so never plugin-planned. See `pair-loader.ts`.
 *
 * Batched by explicit `{userId, document}` pairs, never `document IN (...)`: a
 * content hash is the same string for the same file on two users' shelves, so
 * a bare `id` filter would return one tenant's book to another.
 *
 * Returns WHOLE `Book` rows rather than a `select`-narrowed projection: the
 * consuming field is a plain `t.field` (`schema/progress/model.ts`), so there
 * is no per-field `query` to merge into the batched call.
 */
export const createBookByDocumentLoader = (prisma: PrismaClient): BookByDocumentLoader =>
  createPairLoader<Book | null>(async (pairs) => {
    const rows = await prisma.book.findMany({
      where: { OR: pairs.map(({ userId, key }) => ({ userId, id: key })) },
    });
    return groupByPair(
      rows,
      (row) => row.userId,
      (row) => row.id,
      (row) => row
    );
  }, null);
