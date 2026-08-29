import type { PrismaClient } from '@prisma/client';

import { createPairLoader, groupByPair, type PairLoader } from './pair-loader';

export type DeviceEditionCountLoader = PairLoader<number>;

/**
 * Batches `Book.deviceEditionCount` lookups so a page of N books issues ONE
 * `groupBy` rather than N COUNTs. See `pair-loader.ts` for the shared
 * mechanics.
 *
 * WHY A LOADER AND NOT `t.relationCount`: adding a `DeviceEdition` -> `Book`
 * relation and switching to `t.relationCount('deviceEditions')` was implemented
 * and MEASURED. On the `Library.book` path it does save a query (2 -> 1), but
 * on `Library.entries` — the path with the up-to-100 multiplier, and the only
 * reason this field's cost matters — it made things no better and probably
 * worse, replacing N narrow `deviceEdition.count` calls with N
 * `book.findUniqueOrThrow` calls that re-read the whole book row plus a
 * `_count` subquery. Selecting `_count` inside `BOOK_SELECT` does not help
 * either; that was tried and measured identical, because the plugin never
 * inspects the parent for it. See `pair-loader.ts` for the mechanism.
 *
 * Batched by explicit `{userId, originalBookId}` PAIRS, not a bare
 * `originalBookId IN (...)`: book ids are content hashes shared across users
 * (`@@id([userId, originalBookId, deviceId])`), so a bare filter would report
 * one user's edition count to another. `device-edition-count.test.ts`'s "does
 * not count another user's editions for a book sharing the same id" owns that
 * assertion.
 *
 * A BOOK WITH NO EDITIONS IS ABSENT from the `groupBy` result, not present with
 * zero — hence the `0` below. The field is `Int!`, so resolving `undefined`
 * would be a request-level GraphQL error rather than a silent zero.
 *
 * `countForBook` (`services/edition.ts`) is NOT dead: `getBookById` still calls
 * it for REST's `{ withEditionCount: true }` payload, which is the same number
 * from the same table — only REST has no page of books to batch across.
 */
export const createDeviceEditionCountLoader = (prisma: PrismaClient): DeviceEditionCountLoader =>
  createPairLoader<number>(async (pairs) => {
    const rows = await prisma.deviceEdition.groupBy({
      by: ['userId', 'originalBookId'],
      where: { OR: pairs.map(({ userId, key }) => ({ userId, originalBookId: key })) },
      _count: { _all: true },
    });
    return groupByPair(
      rows,
      (row) => row.userId,
      (row) => row.originalBookId,
      (row) => row._count._all
    );
  }, 0);
