import type { PrismaClient, Progress } from '@prisma/client';

import { createPairLoader, groupByPair, type PairLoader } from './pair-loader';

export type ProgressLoader = PairLoader<Progress | null>;

/**
 * Batches `Book.progress` lookups so a page of N books issues one `findMany`
 * instead of N `findUnique` calls. See `pair-loader.ts` for the shared
 * mechanics and for why a loader — not `t.relation` — is the only thing that
 * batches on this path.
 *
 * `Book` -> `Progress` IS a Prisma relation (added for `Progress.book`), and
 * this loader still does not use it: `Book.progress` is reached from
 * `Library.entries`, which is hand-built, so `t.relation('progress')` measured
 * a page of 8 at 9 queries against this loader's 2. `pair-loader.ts` has the
 * mechanism. The join is on the KOReader `document` hash, which is *normally*
 * a book's own id. The lookup is `document = book.id` directly, without
 * consulting `getBookLineage`/`BookIdHistory`, because `reimportBook` and
 * `linkDocument` both migrate any existing progress row onto the book's new
 * id inside the same transaction that writes the lineage row, and KOReader
 * sync normalizes through `resolveBookId` before `saveProgress`
 * (`routes/kosync.ts`). A live book's progress is never stranded under a stale
 * id, so a lineage-aware lookup would find nothing this one misses and would
 * cost an extra query on every request.
 *
 * Batched by explicit `{userId, document}` pairs, never `document IN (...)`:
 * a KOReader content hash is the same string for the same file on two
 * different users' shelves (`@@id([userId, document])`), so a bare filter
 * would cross tenants.
 */
export const createProgressLoader = (prisma: PrismaClient): ProgressLoader =>
  createPairLoader<Progress | null>(async (pairs) => {
    const rows = await prisma.progress.findMany({
      where: { OR: pairs.map(({ userId, key }) => ({ userId, document: key })) },
    });
    return groupByPair(
      rows,
      (row) => row.userId,
      (row) => row.document,
      (row) => row
    );
  }, null);
