import type { PrismaClient } from '@prisma/client';

import { getLineageEntriesBatch, type LineageEntry } from '../../services/book-lineage';
import { createPairLoader, type PairLoader } from './pair-loader';

export type LineageLoader = PairLoader<LineageEntry[]>;

/**
 * Batches `Book.lineage` so a page of N books issues ONE history query rather
 * than 2N. See `pair-loader.ts` for the shared mechanics.
 *
 * MEASURED, 8 books reached through `Library.entries`: 17 queries before
 * (1 page read + 8 redundant `book.findUnique` existence checks + 8 history
 * reads), 2 after. At the page cap (`CONNECTION_LIMITS.libraryEntries.maxSize`,
 * 100) that was 201.
 *
 * Two separate wins, worth keeping distinct:
 *  - the history reads are batched into one query by
 *    `getLineageEntriesBatch` (`services/book-lineage.ts`);
 *  - the per-book existence check disappears entirely, because this field's
 *    parent is an already-resolved `Book`. `getBookLineage` keeps that check
 *    and its `null` contract for single-book callers; this path provably does
 *    not need it, and `Book.lineage` mapped `null` and `[]` to the same empty
 *    list anyway.
 *
 * Keyed by the book's own id (its `current_id` in `book_id_history`), batched
 * as explicit `(userId, currentId)` pairs — book ids are content hashes shared
 * across tenants, so a bare id filter would hand one user's lineage to another.
 *
 * `absent` is `[]`: a book with no history is simply not in the result, and the
 * field is `[LinkedDocument!]!`.
 */
export const createLineageLoader = (prisma: PrismaClient): LineageLoader =>
  createPairLoader<LineageEntry[]>(
    (pairs) =>
      getLineageEntriesBatch(
        prisma,
        pairs.map(({ userId, key }) => ({ userId, currentId: key }))
      ),
    []
  );
