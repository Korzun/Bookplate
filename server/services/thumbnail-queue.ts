import sharp from 'sharp';
import { BookStore } from './book-store';
import { logger } from '../logger';

const log = logger('ThumbnailQueue');
const INTER_JOB_DELAY_MS = 200;

type ResizeFn = (buffer: Buffer, width: number) => Promise<Buffer>;

const defaultResize: ResizeFn = (buffer, width) =>
  sharp(buffer).resize({ width, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();

interface Job {
  bookId: string;
  width: number;
}

export class ThumbnailQueue {
  private readonly queue: Job[] = [];
  private running = false;

  constructor(
    private readonly bookStore: BookStore,
    private readonly widths: number[],
    private readonly resize: ResizeFn = defaultResize
  ) {}

  start(): void {
    if (this.running) return;
    this.bookStore.pruneThumbnails(this.widths);
    this.reconcile();
    this.running = true;
    void this.processLoop();
  }

  stop(): void {
    this.running = false;
  }

  enqueue(bookId: string): void {
    for (const width of this.widths) {
      this.queue.push({ bookId, width });
    }
  }

  reconcile(): void {
    const missing = this.bookStore.getMissingThumbnailPairs(this.widths);
    for (const pair of missing) {
      this.queue.push(pair);
    }
    if (missing.length > 0) {
      log.info(`Queued ${missing.length} missing thumbnail(s)`);
    }
  }

  async drainForTest(): Promise<void> {
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
      await this.processJob(job);
      if (this.queue.length > 0) {
        await delay(INTER_JOB_DELAY_MS);
      }
    }
  }

  private async processJob(job: Job): Promise<void> {
    const cover = this.bookStore.getCover(job.bookId);
    if (!cover) return;
    try {
      const resized = await this.resize(cover.data, job.width);
      this.bookStore.saveThumbnail(job.bookId, job.width, resized, 'image/jpeg');
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
