import type { PrismaClient } from '@prisma/client';

import { parseNumberArray } from './derive';

export type ChapterSpineMapLoader = (userId: string, bookId: string) => Promise<number[] | null>;

type PendingLookup = {
  userId: string;
  bookId: string;
  resolve: (spineMap: number[] | null) => void;
  reject: (err: unknown) => void;
};

/**
 * Batches `Book.chapterSpineMap` lookups for the life of one request, so a
 * page of N `Progress` rows each resolving `currentChapter` issues one
 * `findMany` instead of N `findUnique` calls — the same problem, and the same
 * shape of answer, as `progress-loader.ts`, which this deliberately mirrors
 * line for line rather than inventing a second batching idiom.
 *
 * `BookStore.getChapterSpineMaps` is the REST path's batched equivalent, and
 * it is not reused here for two reasons: it takes an `Owner` (userId +
 * username) where a loader keyed per request must batch across users, and it
 * batches only within a single call, which is exactly what a GraphQL resolver
 * cannot arrange. The *parsing* is shared instead — both go through the same
 * "JSON array of finite numbers, malformed degrading to empty" rule, this one
 * via `derive.ts`'s `parseNumberArray`, which is also what `Book.chapterSpineMap`
 * exposes. So the two paths cannot disagree about what the column means.
 *
 * Returns `null` — distinct from `[]` — for a book that does not exist, so a
 * progress row whose book has been deleted is distinguishable from a book with
 * no chapters. `deriveCurrentChapter` treats both as "no chapter".
 *
 * As in `progress-loader.ts`: the cache is keyed `userId -> bookId -> promise`
 * (no delimiter to collide on), the `findMany` filters on an explicit list of
 * `{ userId, id }` pairs rather than `id IN (...)` (so a batch can never cross
 * one user's book into another's — book ids are content hashes and are
 * routinely shared), and both `resolve` and `reject` are captured up front so
 * a failing query rejects every lookup in the batch instead of leaving them
 * permanently unsettled, which would hang the request rather than surface an
 * error.
 */
export const createChapterSpineMapLoader = (prisma: PrismaClient): ChapterSpineMapLoader => {
  const cache = new Map<string, Map<string, Promise<number[] | null>>>();
  let pending: PendingLookup[] = [];
  let flushScheduled = false;

  const flush = async (): Promise<void> => {
    const batch = pending;
    pending = [];
    flushScheduled = false;

    try {
      const rows = await prisma.book.findMany({
        where: { OR: batch.map(({ userId, bookId }) => ({ userId, id: bookId })) },
        select: { userId: true, id: true, chapterSpineMap: true },
      });
      const byUser = new Map<string, Map<string, number[]>>();
      for (const row of rows) {
        const byBook = byUser.get(row.userId) ?? new Map<string, number[]>();
        byBook.set(row.id, parseNumberArray(row.chapterSpineMap));
        byUser.set(row.userId, byBook);
      }

      for (const lookup of batch) {
        lookup.resolve(byUser.get(lookup.userId)?.get(lookup.bookId) ?? null);
      }
    } catch (err) {
      for (const lookup of batch) lookup.reject(err);
    }
  };

  return (userId: string, bookId: string): Promise<number[] | null> => {
    const byBook = cache.get(userId) ?? new Map<string, Promise<number[] | null>>();
    cache.set(userId, byBook);

    const cached = byBook.get(bookId);
    if (cached !== undefined) return cached;

    const result = new Promise<number[] | null>((resolve, reject) => {
      pending.push({ userId, bookId, resolve, reject });
      if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(() => void flush());
      }
    });
    byBook.set(bookId, result);
    return result;
  };
};
