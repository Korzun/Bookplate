import type { Book, PrismaClient } from '@prisma/client';

import { createPairLoader, groupByPair, type PairLoader } from './pair-loader';

export type BookByDocumentLoader = PairLoader<Book | null>;

/**
 * Batches `(userId, book id)` lookups so a page of N rows that each name a book
 * by its raw content hash issues one `findMany` instead of N `findUnique`
 * calls. See `pair-loader.ts` for the shared mechanics.
 *
 * ITS CONSUMERS ARE `LinkedDocument.oldBook` AND `LinkedDocument.newBook`
 * (`schema/linked-document/model.ts`). It served `Progress.book` too until that
 * field became a `t.relation` over the real `Progress` <-> `Book` relation; the
 * loader stays because those two do not have that option. They hang off
 * `Book.lineage`, which hangs off `Library.entries` — permanently hand-built,
 * so never plugin-planned, so a `t.relation` there would take the per-row
 * fallback. Measured on the `Progress.book` conversion when `Library.progress`
 * was still hand-built: a page of 8 went from 2 queries to 9. See
 * `pair-loader.ts` for the mechanism and for what changed when
 * `Library.progress` stopped being hand-built.
 *
 * **A lineage entry's `oldId`/`newId`, like `Progress.document`, IS a book's
 * raw id** — all three hold the same KOReader content hash — so this is a
 * `(userId, id)` pair query on `book`, not a join through any foreign key.
 *
 * Batched by explicit `{userId, id}` pairs, never `id IN (...)`: a content
 * hash is the same string for the same file on two users' shelves, so a bare
 * `id` filter would return one tenant's book to another.
 *
 * Returns WHOLE `Book` rows rather than a `select`-narrowed projection: the
 * consuming fields are plain `t.field`s, so there is no per-field `query` to
 * merge into the batched call.
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
