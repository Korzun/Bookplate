import type { PrismaClient } from '@prisma/client';

import { parseNumberArray } from '../derive';
import { createPairLoader, groupByPair, type PairLoader } from './pair-loader';

export type ChapterSpineMapLoader = PairLoader<number[] | null>;

/**
 * Batches `Book.chapterSpineMap` lookups so a page of N `Progress` rows each
 * resolving `currentChapter` issues one `findMany` instead of N `findUnique`
 * calls. See `pair-loader.ts` for the shared mechanics.
 *
 * Reaches `Book` from `Progress` across the same non-relation seam
 * `progress.ts` describes, and on the `Library.progress` path, which is
 * hand-built — so a relation would not help here even if one existed.
 *
 * Parsing is shared with `Book.chapterSpineMap` rather than reimplemented:
 * both go through `derive.ts`'s `parseNumberArray` and its "JSON array of
 * finite numbers, malformed degrading to empty" rule, so the two readings
 * cannot disagree about what the column means.
 *
 * Returns `null` — distinct from `[]` — for a book that does not exist, so a
 * progress row whose book has been deleted is distinguishable from a book with
 * no chapters. `deriveCurrentChapter` treats both as "no chapter".
 */
export const createChapterSpineMapLoader = (prisma: PrismaClient): ChapterSpineMapLoader =>
  createPairLoader<number[] | null>(async (pairs) => {
    const rows = await prisma.book.findMany({
      where: { OR: pairs.map(({ userId, key }) => ({ userId, id: key })) },
      select: { userId: true, id: true, chapterSpineMap: true },
    });
    return groupByPair(
      rows,
      (row) => row.userId,
      (row) => row.id,
      (row) => parseNumberArray(row.chapterSpineMap)
    );
  }, null);
