import type { PendingFix, PrismaClient } from '@prisma/client';

export type PendingFixLoader = (userId: string, bookId: string) => Promise<PendingFix | null>;

type PendingLookup = {
  userId: string;
  bookId: string;
  resolve: (row: PendingFix | null) => void;
  reject: (err: unknown) => void;
};

/**
 * Batches `PendingFix` lookups for the life of one request so that a page of
 * N books each resolving `Book.pendingFix` issues one `findMany` instead of N
 * `findUnique` calls.
 *
 * A direct mirror of `createProgressLoader` (`progress-loader.ts`) — same
 * shape of problem: a non-relation, compound-keyed (`@@id([userId, bookId])`)
 * per-book lookup reached from `Book`, and `Book` is reachable from a list
 * (`Library.entries`). Every doc comment below restates that file's
 * reasoning with `document` renamed to `bookId`; see it for the fuller
 * rationale.
 *
 * Unlike `createOwnerLoader` (which only dedupes *repeated* lookups of the
 * *same* key), this loader must collapse lookups of N *different* keys — one
 * per book on a page — into a single query, so per-key memoization alone
 * would not help. It collects every `(userId, bookId)` pair requested during
 * the current microtask into `pending`, then flushes them as one `findMany`
 * keyed by an explicit list of `{ userId, bookId }` pairs (not a single
 * `userId` + `bookId IN (...)`), so a batch can never cross a lookup for one
 * user's book into another user's row — book ids are content hashes
 * (partial MD5), so two users routinely hold a book with the identical id
 * for the identical file (see `progress-loader.ts` and
 * `node-scope.ts`'s `NO_MATCH_USER_ID` doc comment for the same hazard).
 *
 * `cache` is keyed `userId -> bookId -> promise` rather than a single
 * concatenated string key, so there is no delimiter to pick and therefore no
 * possibility of two distinct `(userId, bookId)` pairs colliding onto the
 * same cache entry. As with `createOwnerLoader`, each entry holds the
 * pending/resolved *promise*, not the resolved value, so concurrent
 * sibling-field resolution for the same key shares one query instead of
 * racing two.
 *
 * Every pending lookup's `resolve` *and* `reject` are captured up front and
 * both are guaranteed to be called exactly once by `flush`: unlike
 * `createOwnerLoader`, which just returns a Prisma promise chain and lets a
 * rejection propagate on its own, this loader owns the settling of each
 * batched caller's promise once it takes over via `new Promise`. If
 * `findMany` (or the grouping/matching that follows it) throws, every lookup
 * in that batch is rejected instead of being left permanently unsettled — an
 * unsettled resolver promise never surfaces as a GraphQL error, it just
 * hangs the request. (`createProgressLoader` shipped once without this and a
 * transient DB error hung the request; this loader is written with the fix
 * already in place, not repeating that gap.)
 */
export const createPendingFixLoader = (prisma: PrismaClient): PendingFixLoader => {
  const cache = new Map<string, Map<string, Promise<PendingFix | null>>>();
  let pending: PendingLookup[] = [];
  let flushScheduled = false;

  const flush = async (): Promise<void> => {
    const batch = pending;
    pending = [];
    flushScheduled = false;

    try {
      const rows = await prisma.pendingFix.findMany({
        where: { OR: batch.map(({ userId, bookId }) => ({ userId, bookId })) },
      });
      const byUser = new Map<string, Map<string, PendingFix>>();
      for (const row of rows) {
        const byBookId = byUser.get(row.userId) ?? new Map<string, PendingFix>();
        byBookId.set(row.bookId, row);
        byUser.set(row.userId, byBookId);
      }

      for (const lookup of batch) {
        lookup.resolve(byUser.get(lookup.userId)?.get(lookup.bookId) ?? null);
      }
    } catch (err) {
      for (const lookup of batch) lookup.reject(err);
    }
  };

  return (userId: string, bookId: string): Promise<PendingFix | null> => {
    const byBookId = cache.get(userId) ?? new Map<string, Promise<PendingFix | null>>();
    cache.set(userId, byBookId);

    const cached = byBookId.get(bookId);
    if (cached !== undefined) return cached;

    const result = new Promise<PendingFix | null>((resolve, reject) => {
      pending.push({ userId, bookId, resolve, reject });
      if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(() => void flush());
      }
    });
    byBookId.set(bookId, result);
    return result;
  };
};
