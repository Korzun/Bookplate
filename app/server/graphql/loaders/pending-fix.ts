import type { PendingFix, PrismaClient } from '@prisma/client';

import { createPairLoader, groupByPair, type PairLoader } from './pair-loader';

export type PendingFixLoader = PairLoader<PendingFix | null>;

/**
 * Batches `Book.pendingFix` / `Book.hasActionablePendingFix` lookups so a page
 * of N books issues one `findMany` instead of N `findUnique` calls. See
 * `pair-loader.ts` for the shared mechanics.
 *
 * `Book.pendingFix` IS a real Prisma relation (`schema.prisma`'s
 * `pendingFix PendingFix?`) — the only loader here whose subject is — and it
 * still cannot be `t.relation`, for three independent reasons:
 *
 *  1. Both consumers gate on `isLivePendingFix(parsePendingFixState(state),
 *     updatedAt, now)` — a JSON parse of the `state` text column plus a TTL
 *     against *now*. No Prisma `where` expresses it, and `t.relation`'s
 *     `resolve` option is a FALLBACK only, reached solely when the plugin's
 *     optimizer did not already eagerly select the relation, so a gate written
 *     there would silently not run on the normal path.
 *  2. `hasActionablePendingFix` is a `Boolean` derived from `state.proposals`;
 *     `t.relation` can only return the relation's own type.
 *  3. The hot path (`Library.entries`) is hand-built, so a `t.relation` would
 *     take its per-row fallback anyway — measured elsewhere at 2 -> 9 queries
 *     for a page of 8. See `pair-loader.ts`.
 *
 * Batched by explicit `{userId, bookId}` pairs, never `bookId IN (...)`: book
 * ids are content hashes (partial MD5), so two users routinely hold a book
 * with the identical id for the identical file.
 */
export const createPendingFixLoader = (prisma: PrismaClient): PendingFixLoader =>
  createPairLoader<PendingFix | null>(async (pairs) => {
    const rows = await prisma.pendingFix.findMany({
      where: { OR: pairs.map(({ userId, key }) => ({ userId, bookId: key })) },
    });
    return groupByPair(
      rows,
      (row) => row.userId,
      (row) => row.bookId,
      (row) => row
    );
  }, null);
