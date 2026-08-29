import type { PrismaClient } from '@prisma/client';

import { createPairLoader, type PairLoader } from './pair-loader';

export type SeverityCount = { severity: string; count: number };
export type ValidationCountsLoader = PairLoader<SeverityCount[]>;

/**
 * Batches `Validation.counts` lookups so a page of N books issues ONE `groupBy`
 * rather than N COUNTs. See `pair-loader.ts` for the shared mechanics.
 *
 * `Validation.messages` IS a real Prisma relation, and `t.relationCount` still
 * cannot express this field: it returns `[ValidationSeverityCount!]!`, a tally
 * PER SEVERITY, whereas `t.relationCount` yields a single `Int`. Reproducing it
 * would need one `t.relationCount` per severity with a `where` filter, which is
 * both an SDL change (one list field becomes N scalars) and a break of the
 * zero-count contract below, since a fixed field cannot be absent.
 *
 * ZERO-COUNT SEVERITIES ARE OMITTED, mirroring REST exactly: `epub-validator.ts`
 * only ever populates `counts[s]` when a message of that severity exists, and
 * `ValidationDetailModal` renders the same summary either way. A book with no
 * messages at all resolves `[]` (the `absent` value below), not `undefined`.
 *
 * Batched by explicit `{userId, bookId}` PAIRS, not a bare `bookId IN (...)`: a
 * book's raw id is a content hash and the same file imported by two users
 * yields the SAME id under different `userId`s (`@@id([userId, bookId])` on
 * `ValidationMessage`), so a bare filter would cross tenants.
 *
 * Builds its map directly rather than through `groupByPair`: rows ACCUMULATE
 * per key (one per severity), so each entry is appended to rather than
 * overwritten.
 */
export const createValidationCountsLoader = (prisma: PrismaClient): ValidationCountsLoader =>
  createPairLoader<SeverityCount[]>(async (pairs) => {
    const rows = await prisma.validationMessage.groupBy({
      by: ['userId', 'bookId', 'severity'],
      where: { OR: pairs.map(({ userId, key }) => ({ userId, bookId: key })) },
      _count: { _all: true },
    });

    const byUser = new Map<string, Map<string, SeverityCount[]>>();
    for (const row of rows) {
      const byBook = byUser.get(row.userId) ?? new Map<string, SeverityCount[]>();
      byBook.set(row.bookId, [
        ...(byBook.get(row.bookId) ?? []),
        { severity: row.severity, count: row._count._all },
      ]);
      byUser.set(row.userId, byBook);
    }
    return byUser;
  }, []);
