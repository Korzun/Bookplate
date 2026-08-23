import type { Book, PrismaClient } from '@prisma/client';

export type BookByDocumentLoader = (userId: string, document: string) => Promise<Book | null>;

type PendingLookup = {
  userId: string;
  document: string;
  resolve: (value: Book | null) => void;
  reject: (err: unknown) => void;
};

/**
 * Batches `Progress.book` lookups for the life of one request, so a page of
 * N progress rows each resolving `book` issues ONE `findMany` rather than N
 * `findUnique` calls. Same shape as `createProgressLoader`/
 * `createPendingFixLoader`/`createValidationCountsLoader` — see
 * `progress-loader.ts`'s doc comment for the fuller rationale on why
 * per-key memoization alone would not collapse N *different* keys into one
 * query.
 *
 * **`document` IS the book's raw id.** `Progress.document` and `Book.id` are
 * the same KOReader content hash — `routes/kosync.ts` writes
 * `progress.document` as `bookStore.resolveBookId(userId, document)`'s
 * result, the very value that becomes a book's current `id` once it's
 * imported — so this lookup is a `(userId, id)` pair query on `book`, not a
 * join through any foreign key (`Progress` has none to `Book`).
 *
 * Batched by `(userId, document)` PAIRS, never a bare `document IN (...)`: a
 * KOReader content hash is the SAME string for the same file on two
 * different users' shelves (`@@id([userId, id])` on `Book`), so a bare `id`
 * filter would return one tenant's book to another asking about the
 * identical hash. `cache` is keyed `userId -> document -> promise` for the
 * same reason `progress-loader.ts`'s cache is: no delimiter to pick, so no
 * possibility of two distinct pairs colliding onto one cache entry.
 *
 * `flush` wraps BOTH the query and the grouping in one try/catch and settles
 * every pending lookup on failure. A loader that captures only `resolve`
 * leaves unsettled promises that hang the whole request instead of
 * surfacing a GraphQL error — the exact bug `progress-loader` shipped once.
 *
 * Returns WHOLE `Book` rows, not a `select`-narrowed projection: this field
 * is a plain `t.field` (see `schema/progress/model.ts`), not a
 * `t.prismaField`, so there is no per-field `query` to merge into the
 * batched call the way `Library.book`/`LinkedDocument.oldBook` merge one
 * into a single-row lookup. `Book.progress`'s own loader
 * (`progress-loader.ts`) makes the identical trade for the identical
 * reason.
 */
export const createBookByDocumentLoader = (prisma: PrismaClient): BookByDocumentLoader => {
  const cache = new Map<string, Map<string, Promise<Book | null>>>();
  let pending: PendingLookup[] = [];
  let flushScheduled = false;

  const flush = async (): Promise<void> => {
    const batch = pending;
    pending = [];
    flushScheduled = false;

    try {
      const books = await prisma.book.findMany({
        where: { OR: batch.map(({ userId, document }) => ({ userId, id: document })) },
      });

      const byUser = new Map<string, Map<string, (typeof books)[number]>>();
      for (const book of books) {
        const byDocument = byUser.get(book.userId) ?? new Map();
        byDocument.set(book.id, book);
        byUser.set(book.userId, byDocument);
      }

      for (const lookup of batch) {
        lookup.resolve(byUser.get(lookup.userId)?.get(lookup.document) ?? null);
      }
    } catch (err) {
      for (const lookup of batch) lookup.reject(err);
    }
  };

  return (userId: string, document: string): Promise<Book | null> => {
    const byDocument = cache.get(userId) ?? new Map<string, Promise<Book | null>>();
    cache.set(userId, byDocument);

    const cached = byDocument.get(document);
    if (cached !== undefined) return cached;

    const result = new Promise<Book | null>((resolve, reject) => {
      pending.push({ userId, document, resolve, reject });
      if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(() => void flush());
      }
    });
    byDocument.set(document, result);
    return result;
  };
};
