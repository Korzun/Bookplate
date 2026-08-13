import type { PrismaClient } from '@prisma/client';

export type SeverityCount = { severity: string; count: number };
export type ValidationCountsLoader = (userId: string, bookId: string) => Promise<SeverityCount[]>;

type PendingLookup = {
  userId: string;
  bookId: string;
  resolve: (value: SeverityCount[]) => void;
  reject: (err: unknown) => void;
};

/**
 * Batches `Validation.counts` lookups for the life of one request, so a page
 * of N books each resolving the field issues ONE `groupBy` rather than N
 * COUNTs. Same shape as `createProgressLoader`/`createPendingFixLoader`/
 * `createSeriesProgressLoader` — see `series-progress-loader.ts`'s doc comment
 * for the fuller rationale on why per-key memoization alone would not collapse
 * N different keys into one query.
 *
 * Batched by `(userId, bookId)` PAIRS, not a bare `bookId IN (...)`: a book's
 * raw id is a content hash and the same file imported by two users yields the
 * SAME id under different `userId`s (`@@id([userId, bookId])` on
 * `ValidationMessage`), so a bare `bookId` filter would cross tenants.
 *
 * ZERO-COUNT SEVERITIES ARE OMITTED, mirroring REST exactly: `epub-validator.ts`
 * only ever populates `counts[s]` when a message of that severity exists, and
 * `ValidationDetailModal` renders the same summary either way.
 *
 * `flush` wraps BOTH the query and the grouping in one try/catch and settles
 * every pending lookup on failure. A loader that captures only `resolve` leaves
 * unsettled promises that hang the whole request instead of surfacing a GraphQL
 * error — the exact bug `progress-loader` shipped once.
 */
export const createValidationCountsLoader = (prisma: PrismaClient): ValidationCountsLoader => {
  const cache = new Map<string, Map<string, Promise<SeverityCount[]>>>();
  let pending: PendingLookup[] = [];
  let flushScheduled = false;

  const flush = async (): Promise<void> => {
    const batch = pending;
    pending = [];
    flushScheduled = false;

    try {
      const rows = await prisma.validationMessage.groupBy({
        by: ['userId', 'bookId', 'severity'],
        where: { OR: batch.map(({ userId, bookId }) => ({ userId, bookId })) },
        _count: { _all: true },
      });

      const countsByUser = new Map<string, Map<string, SeverityCount[]>>();
      for (const row of rows) {
        const byBook = countsByUser.get(row.userId) ?? new Map<string, SeverityCount[]>();
        byBook.set(row.bookId, [
          ...(byBook.get(row.bookId) ?? []),
          { severity: row.severity, count: row._count._all },
        ]);
        countsByUser.set(row.userId, byBook);
      }

      for (const lookup of batch) {
        lookup.resolve(countsByUser.get(lookup.userId)?.get(lookup.bookId) ?? []);
      }
    } catch (err) {
      for (const lookup of batch) lookup.reject(err);
    }
  };

  return (userId: string, bookId: string): Promise<SeverityCount[]> => {
    const byBookId = cache.get(userId) ?? new Map<string, Promise<SeverityCount[]>>();
    cache.set(userId, byBookId);

    const cached = byBookId.get(bookId);
    if (cached !== undefined) return cached;

    const result = new Promise<SeverityCount[]>((resolve, reject) => {
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
