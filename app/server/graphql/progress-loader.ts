import type { PrismaClient, Progress } from '@prisma/client';

export type ProgressLoader = (userId: string, document: string) => Promise<Progress | null>;

type PendingLookup = {
  userId: string;
  document: string;
  resolve: (row: Progress | null) => void;
};

/**
 * Batches `Progress` lookups for the life of one request so that a page of N
 * books each resolving `Book.progress` issues one `findMany` instead of N
 * `findUnique` calls.
 *
 * Unlike `createOwnerLoader` (which only dedupes *repeated* lookups of the
 * *same* key), this loader must collapse lookups of N *different* keys — one
 * per book on a page — into a single query, so per-key memoization alone
 * would not help. It collects every `(userId, document)` pair requested
 * during the current microtask into `pending`, then flushes them as one
 * `findMany` keyed by an explicit list of `{ userId, document }` pairs (not a
 * single `userId` + `document IN (...)`), so a batch can never cross a lookup
 * for one user's document into another user's row.
 *
 * `cache` is keyed `userId -> document -> promise` rather than a single
 * concatenated string key, so there is no delimiter to pick and therefore no
 * possibility of two distinct `(userId, document)` pairs colliding onto the
 * same cache entry. As with `createOwnerLoader`, each entry holds the
 * pending/resolved *promise*, not the resolved value, so concurrent
 * sibling-field resolution for the same key shares one query instead of
 * racing two.
 */
export const createProgressLoader = (prisma: PrismaClient): ProgressLoader => {
  const cache = new Map<string, Map<string, Promise<Progress | null>>>();
  let pending: PendingLookup[] = [];
  let flushScheduled = false;

  const flush = async (): Promise<void> => {
    const batch = pending;
    pending = [];
    flushScheduled = false;

    const rows = await prisma.progress.findMany({
      where: { OR: batch.map(({ userId, document }) => ({ userId, document })) },
    });
    const byUser = new Map<string, Map<string, Progress>>();
    for (const row of rows) {
      const byDocument = byUser.get(row.userId) ?? new Map<string, Progress>();
      byDocument.set(row.document, row);
      byUser.set(row.userId, byDocument);
    }

    for (const lookup of batch) {
      lookup.resolve(byUser.get(lookup.userId)?.get(lookup.document) ?? null);
    }
  };

  return (userId: string, document: string): Promise<Progress | null> => {
    const byDocument = cache.get(userId) ?? new Map<string, Promise<Progress | null>>();
    cache.set(userId, byDocument);

    const cached = byDocument.get(document);
    if (cached !== undefined) return cached;

    const result = new Promise<Progress | null>((resolve) => {
      pending.push({ userId, document, resolve });
      if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(() => void flush());
      }
    });
    byDocument.set(document, result);
    return result;
  };
};
