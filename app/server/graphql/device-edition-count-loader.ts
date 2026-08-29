import type { PrismaClient } from '@prisma/client';

export type DeviceEditionCountLoader = (userId: string, bookId: string) => Promise<number>;

type PendingLookup = {
  userId: string;
  bookId: string;
  resolve: (value: number) => void;
  reject: (err: unknown) => void;
};

/**
 * Batches `Book.deviceEditionCount` lookups for the life of one request, so a
 * page of N books each resolving the field issues ONE `groupBy` rather than N
 * COUNTs. Same shape as `createValidationCountsLoader`
 * (`validation-counts-loader.ts`), which it mirrors rather than inventing a
 * second batching idiom — see `progress-loader.ts`'s doc comment for the fuller
 * rationale on why per-key memoization alone would not collapse N *different*
 * keys into one query.
 *
 * WHY A LOADER AND NOT `t.relationCount`: this field is the one per-row `Book`
 * aggregate that had no batching at all, and the obvious-looking fix does not
 * work. Adding a `DeviceEdition` -> `Book` relation and switching to
 * `t.relationCount('deviceEditions')` was implemented and MEASURED: on the
 * `Library.book` path it does save a query (2 -> 1), but on `Library.entries` —
 * the path with the up-to-100 multiplier, and the only reason this field's cost
 * matters — it made things no better and probably worse, replacing N narrow
 * `deviceEdition.count` calls with N `book.findUniqueOrThrow` calls that re-read
 * the whole book row plus a `_count` subquery.
 *
 * The mechanism, so nobody re-attempts it: `@pothos/plugin-prisma`'s
 * `wrapResolve` (`lib/index.js`) takes its fast path only when
 * `(!loadedCheck || loadedCheck(parent, info)) && mapping`, where `mapping` is
 * the plugin's own record of a query IT planned (`getLoaderMapping`).
 * `Library.entries` builds its query by hand (`services/library-page.ts`'s
 * `listBooksPage`), so no mapping exists and every `select`-carrying field on
 * those rows falls through to `ModelLoader.loadSelection`, which re-queries per
 * row. The plugin never inspects the parent for `_count`, so selecting
 * `_count` inside `BOOK_SELECT` does not help either — that was tried, and
 * measured identical. Same trap `Book.pendingFix` documents for `t.relation`
 * (`book/model.ts`).
 *
 * Batched by `(userId, originalBookId)` PAIRS, not a bare
 * `originalBookId IN (...)`: a book's raw id is a content hash and the same
 * file imported by two users yields the SAME id under different `userId`s
 * (`@@id([userId, originalBookId, deviceId])` on `DeviceEdition`), so a bare
 * id filter would cross tenants and report one user's edition count to
 * another. `device-edition-count.test.ts`'s "does not count another user's
 * editions for a book sharing the same id" owns that assertion.
 *
 * A BOOK WITH NO EDITIONS IS ABSENT from the `groupBy` result, not present with
 * zero — so the lookup supplies `0` itself. The field is `Int!`, and resolving
 * `undefined` for a non-nullable field is a request-level GraphQL error rather
 * than a silent zero.
 *
 * `flush` wraps BOTH the query and the grouping in one try/catch and settles
 * every pending lookup on failure. A loader that captures only `resolve` leaves
 * unsettled promises that hang the whole request instead of surfacing a GraphQL
 * error — the exact bug `progress-loader` shipped once.
 */
export const createDeviceEditionCountLoader = (prisma: PrismaClient): DeviceEditionCountLoader => {
  const cache = new Map<string, Map<string, Promise<number>>>();
  let pending: PendingLookup[] = [];
  let flushScheduled = false;

  const flush = async (): Promise<void> => {
    const batch = pending;
    pending = [];
    flushScheduled = false;

    try {
      const rows = await prisma.deviceEdition.groupBy({
        by: ['userId', 'originalBookId'],
        where: { OR: batch.map(({ userId, bookId }) => ({ userId, originalBookId: bookId })) },
        _count: { _all: true },
      });

      const countsByUser = new Map<string, Map<string, number>>();
      for (const row of rows) {
        const byBook = countsByUser.get(row.userId) ?? new Map<string, number>();
        byBook.set(row.originalBookId, row._count._all);
        countsByUser.set(row.userId, byBook);
      }

      for (const lookup of batch) {
        lookup.resolve(countsByUser.get(lookup.userId)?.get(lookup.bookId) ?? 0);
      }
    } catch (err) {
      for (const lookup of batch) lookup.reject(err);
    }
  };

  return (userId: string, bookId: string): Promise<number> => {
    const byBookId = cache.get(userId) ?? new Map<string, Promise<number>>();
    cache.set(userId, byBookId);

    const cached = byBookId.get(bookId);
    if (cached !== undefined) return cached;

    const result = new Promise<number>((resolve, reject) => {
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
