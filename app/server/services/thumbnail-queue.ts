import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';

import { logger } from '../logger';
import { getCover, getMissingThumbnailPairs, pruneThumbnails, saveThumbnail } from './book-assets';

const log = logger('ThumbnailQueue');
const INTER_JOB_DELAY_MS = 200;

type ResizeFn = (buffer: Buffer, width: number) => Promise<Buffer>;

const defaultResize: ResizeFn = (buffer, width) =>
  sharp(buffer)
    .resize({ width, withoutEnlargement: true })
    .sharpen()
    .jpeg({ quality: 90 })
    .toBuffer();

interface Job {
  userId: string;
  bookId: string;
  width: number;
}

export class ThumbnailQueue {
  private readonly queue: Job[] = [];
  private running = false;
  /** Resolves when the currently-running processJob (if any) finishes. */
  private currentJobPromise: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly widths: number[],
    private readonly resize: ResizeFn = defaultResize
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    const pruned = await pruneThumbnails(this.prisma, this.widths);
    const { bookCount } = await this.reconcile();
    if (pruned > 0) {
      log.info(
        `Thumbnail widths changed — regenerating covers for ${bookCount} book(s) (pruned ${pruned} stale thumbnail(s))`
      );
    }
    this.running = true;
    void this.processLoop();
  }

  stop(): void {
    this.running = false;
  }

  enqueue(userId: string, bookId: string): void {
    for (const width of this.widths) {
      this.queue.push({ userId, bookId, width });
    }
  }

  async reconcile(): Promise<{ bookCount: number }> {
    const missing = await getMissingThumbnailPairs(this.prisma, this.widths);
    for (const pair of missing) {
      this.queue.push(pair);
    }
    return { bookCount: new Set(missing.map((p) => p.bookId)).size };
  }

  async drainForTest(): Promise<void> {
    // First wait for any job the background processLoop is currently running, then
    // drain whatever remains in the queue (processLoop won't take more since stop()
    // must have been called before drainForTest()).
    await this.currentJobPromise;
    let job: Job | undefined;
    while ((job = this.queue.shift()) !== undefined) {
      await this.processJob(job);
    }
  }

  private async processLoop(): Promise<void> {
    while (this.running) {
      const job = this.queue.shift();
      if (!job) {
        await delay(INTER_JOB_DELAY_MS);
        continue;
      }
      this.currentJobPromise = this.processJob(job);
      await this.currentJobPromise;
      if (this.queue.length > 0) {
        await delay(INTER_JOB_DELAY_MS);
      }
    }
  }

  private async processJob(job: Job): Promise<void> {
    let cover;
    try {
      cover = await getCover(this.prisma, job.userId, job.bookId);
    } catch (err: unknown) {
      log.warn(
        `Failed to get cover for book ${job.bookId}: ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }
    if (!cover) return;
    try {
      const resized = await this.resize(cover.data, job.width);
      await saveThumbnail(this.prisma, job.userId, job.bookId, job.width, resized, 'image/jpeg');
      log.info(`Generated ${job.width}px thumbnail for book ${job.bookId}`);
    } catch (err: unknown) {
      log.warn(
        `Failed to generate ${job.width}px thumbnail for book ${job.bookId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
