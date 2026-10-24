import { PrismaClient, Prisma } from '@prisma/client';

import { logger } from '../logger';
import { normalizeCover } from './cover-normalize';
import type { ThumbnailQueue } from './thumbnail-queue';

const log = logger('CoverBackfill');

/** Same pacing as `ThumbnailQueue`'s inter-job delay. */
const INTER_ROW_DELAY_MS = 200;

type NormalizeFn = typeof normalizeCover;

export interface CoverBackfillResult {
  /** Rows probed this run (covers present and not yet marked normalized). */
  checked: number;
  /** Rows whose bytes were rewritten (thumbnails dropped and re-queued). */
  reencoded: number;
  /** Rows sharp could not decode; left as-is and still unmarked. */
  undecodable: number;
}

/**
 * Startup backfill that brings every pre-existing stored cover under the
 * `normalizeCover` guarantee (baseline sRGB JPEG, long edge ≤ 2000 px).
 *
 * Candidates are rows with a cover and `coverNormalized = false` — the
 * column's migration default, so the first boot after upgrade probes every
 * book once, including JPEGs (that is how a progressive JPEG already stored
 * as `image/jpeg` gets caught). Each row is read, probed/re-encoded, and
 * written back on its own, paced by `INTER_ROW_DELAY_MS` like
 * `ThumbnailQueue`, so a few thousand books take minutes in the background
 * rather than blocking the boot.
 *
 * Idempotent and safe to interrupt: a row is committed as it finishes, every
 * later run only sees rows still unmarked, and the write is a compare-and-set
 * on `coverNormalized = false` so a reimport that landed its own (already
 * normalized) cover between this run's read and write is never overwritten.
 * Only a row whose BYTES changed loses its thumbnails and is re-queued — a
 * passed-through baseline JPEG keeps the thumbnails already derived from it.
 * If the process dies after the delete and before the queue drains,
 * `ThumbnailQueue.start()`'s reconcile rebuilds them on the next boot.
 */
export class CoverBackfill {
  private running = false;
  private readonly normalize: NormalizeFn;
  private readonly delayMs: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly thumbnails: Pick<ThumbnailQueue, 'enqueue'>,
    opts: { normalize?: NormalizeFn; delayMs?: number } = {}
  ) {
    this.normalize = opts.normalize ?? normalizeCover;
    this.delayMs = opts.delayMs ?? INTER_ROW_DELAY_MS;
  }

  /** Fire-and-forget: runs in the background and logs, never throws. */
  start(): void {
    if (this.running) return;
    void this.run().catch((err: unknown) => {
      log.error(`Cover backfill failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  stop(): void {
    this.running = false;
  }

  async run(): Promise<CoverBackfillResult> {
    this.running = true;
    const result: CoverBackfillResult = { checked: 0, reencoded: 0, undecodable: 0 };
    // Ids only: the blobs are fetched one at a time below.
    const pending = await this.prisma.book.findMany({
      where: { coverData: { not: null }, coverNormalized: false },
      select: { userId: true, id: true },
      orderBy: [{ userId: 'asc' }, { id: 'asc' }],
    });
    if (pending.length === 0) {
      this.running = false;
      return result;
    }
    log.info(`Cover backfill: ${pending.length} cover(s) to check`);

    for (let i = 0; i < pending.length; i++) {
      if (!this.running) break;
      const { userId, id } = pending[i];
      try {
        const outcome = await this.processRow(userId, id);
        if (outcome !== 'skipped') result.checked++;
        if (outcome === 'reencoded') result.reencoded++;
        if (outcome === 'undecodable') result.undecodable++;
      } catch (err: unknown) {
        log.warn(
          `Cover backfill: failed for book ${id}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      if (i < pending.length - 1) await delay(this.delayMs);
    }
    this.running = false;
    log.info(
      `Cover backfill: ${result.checked} checked, ${result.reencoded} re-encoded, ` +
        `${result.undecodable} left as-is (undecodable)`
    );
    return result;
  }

  private async processRow(
    userId: string,
    id: string
  ): Promise<'skipped' | 'passthrough' | 'reencoded' | 'undecodable'> {
    const row = await this.prisma.book.findUnique({
      where: { userId_id: { userId, id } },
      select: { coverData: true, coverMime: true, coverNormalized: true },
    });
    // Gone, cover removed, or marked by a concurrent write since the id scan.
    if (!row || row.coverData === null || row.coverNormalized) return 'skipped';

    const original = Buffer.from(row.coverData);
    const cover = await this.normalize(original, row.coverMime);
    if (!cover.normalized) return 'undecodable'; // normalizeCover already warned
    const changed = !cover.data.equals(original);

    const written = await this.prisma.$transaction(async (tx) => {
      // Compare-and-set: a reimport in the meantime marked the row and stored
      // its own normalized cover, which must win.
      const { count } = await tx.book.updateMany({
        where: { userId, id, coverNormalized: false },
        data: changed
          ? {
              coverData: cover.data as unknown as Prisma.Bytes,
              coverMime: cover.mime,
              coverNormalized: true,
            }
          : { coverMime: cover.mime, coverNormalized: true },
      });
      if (count === 1 && changed) {
        await tx.bookThumbnail.deleteMany({ where: { userId, bookId: id } });
      }
      return count === 1;
    });
    if (!written) return 'skipped';
    if (changed) {
      this.thumbnails.enqueue(userId, id);
      return 'reencoded';
    }
    return 'passthrough';
  }
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
