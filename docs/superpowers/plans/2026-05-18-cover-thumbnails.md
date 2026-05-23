# Cover Thumbnails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate resized cover thumbnails for each book asynchronously and serve them via the existing cover endpoints with a `?width=` parameter.

**Architecture:** A new `ThumbnailQueue` class holds an in-memory job queue. On startup it prunes obsolete widths from SQLite, reconciles all missing `(book_id, width)` pairs, and processes them one at a time using `sharp`. New book imports enqueue jobs directly. Thumbnails live in a `book_thumbnails` table with an `ON DELETE CASCADE` FK to `books`.

**Tech Stack:** `sharp` (image resizing), `better-sqlite3`, Express, TypeScript, Jest

---

## File Map

**New files:**
- `app/services/thumbnail-queue.ts` — `ThumbnailQueue` class: in-memory job queue, sharp-based resize
- `app/services/thumbnail-queue.test.ts` — unit tests

**Modified files:**
- `app/types.ts` — add `thumbnailWidths: number[]` to `AppConfig`
- `app/config.ts` — read `thumbnail_widths` from options.json, default `[60, 170]`
- `app/services/book-store.ts` — migration v6 (`book_thumbnails` table) + 4 new methods
- `app/services/book-store.test.ts` — tests for new thumbnail methods
- `app/app.ts` — pass `thumbnailQueue` to `createUiRouter`; pass `thumbnailWidths` to `createOpdsRouter`
- `app/index.ts` — create `ThumbnailQueue`, call `start()` after scan
- `app/routes/ui.ts` — new `thumbnailQueue` param; `?width=` on cover endpoint; enqueue after upload/reimport/scan
- `app/routes/ui.test.ts` — pass mock queue to router; new cover thumbnail tests
- `app/routes/opds.ts` — new `thumbnailWidths` param; `?width=` on cover endpoint; thumbnail link in feed
- `app/routes/opds.test.ts` — pass widths to router; new cover thumbnail tests
- `client/src/component/cover/index.tsx` — add `thumbnailWidth?: number` prop
- `client/src/component/cover-stack/index.tsx` — pass `thumbnailWidth={170}`
- `client/src/component/book-row/index.tsx` — append `?width=60` to img src
- `client/src/page/book/index.tsx` — append `?width=170` to img src

---

### Task 1: Install `sharp`

**Files:**
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install the package**

```bash
cd /Users/korzun/Code/HASS-ODPS && npm install sharp
```

Expected: `sharp` appears under `"dependencies"` in `package.json`.

- [ ] **Step 2: Verify TypeScript types are bundled**

`sharp` ships its own types — no `@types/sharp` needed.

```bash
npx tsc --noEmit
```

Expected: no errors related to `sharp`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add sharp for image resizing"
```

---

### Task 2: Add `thumbnailWidths` to config

**Files:**
- Modify: `app/types.ts`
- Modify: `app/config.ts`

- [ ] **Step 1: Add field to `AppConfig` in `app/types.ts`**

Replace the `AppConfig` interface (lines 49–56):

```typescript
export interface AppConfig {
  username: string;
  password: string;
  booksDir: string;
  dataDir: string;
  port: number;
  maxConcurrentUploads: number;
  thumbnailWidths: number[];
}
```

- [ ] **Step 2: Update `Options` and `loadConfig` in `app/config.ts`**

Replace the full file:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig } from './types';
import { logger } from './logger';

const log = logger('Config');

interface Options {
  username: string;
  password: string;
  max_concurrent_uploads: number;
  thumbnail_widths: number[];
}

export function loadConfig(): AppConfig {
  const dataDir = process.env.DATA_DIR ?? '/data';
  const optionsPath = path.join(dataDir, 'options.json');

  let options: Options = {
    username: 'admin',
    password: 'changeme',
    max_concurrent_uploads: 3,
    thumbnail_widths: [60, 170],
  };

  if (fs.existsSync(optionsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(optionsPath, 'utf-8')) as Partial<Options>;
      options = {
        username: parsed.username ?? options.username,
        password: parsed.password ?? options.password,
        max_concurrent_uploads: parsed.max_concurrent_uploads ?? options.max_concurrent_uploads,
        thumbnail_widths: Array.isArray(parsed.thumbnail_widths)
          ? parsed.thumbnail_widths
          : options.thumbnail_widths,
      };
    } catch {
      log.warn(`Could not parse ${optionsPath}, using defaults`);
    }
  }

  return {
    username: process.env.ADMIN_USER ?? options.username,
    password: process.env.ADMIN_PASS ?? options.password,
    booksDir: process.env.BOOKS_DIR ?? '/media/books',
    dataDir,
    port: parseInt(process.env.PORT ?? '3000', 10),
    maxConcurrentUploads: options.max_concurrent_uploads,
    thumbnailWidths: options.thumbnail_widths,
  };
}
```

- [ ] **Step 3: Verify compilation**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/types.ts app/config.ts
git commit -m "feat: add thumbnailWidths to AppConfig"
```

---

### Task 3: Add `book_thumbnails` table and thumbnail methods to `BookStore`

**Files:**
- Modify: `app/services/book-store.ts`
- Modify: `app/services/book-store.test.ts`

- [ ] **Step 1: Write failing tests for the four new methods**

Append to `app/services/book-store.test.ts` (after all existing describe blocks):

```typescript
describe('book_thumbnails', () => {
  it('saveThumbnail stores and getThumbnail retrieves', () => {
    bookStore.addBook('bk1', 'a.epub', '/books/a.epub', 100, new Date(), FAKE_META);
    const data = Buffer.from('thumb-data');
    bookStore.saveThumbnail('bk1', 150, data, 'image/jpeg');
    const result = bookStore.getThumbnail('bk1', 150);
    expect(result).not.toBeNull();
    expect(result!.data.toString()).toBe('thumb-data');
    expect(result!.mime).toBe('image/jpeg');
  });

  it('getThumbnail returns null when not present', () => {
    bookStore.addBook('bk2', 'b.epub', '/books/b.epub', 100, new Date(), FAKE_META);
    expect(bookStore.getThumbnail('bk2', 150)).toBeNull();
  });

  it('saveThumbnail upserts on (book_id, width) conflict', () => {
    bookStore.addBook('bk3', 'c.epub', '/books/c.epub', 100, new Date(), FAKE_META);
    bookStore.saveThumbnail('bk3', 150, Buffer.from('v1'), 'image/jpeg');
    bookStore.saveThumbnail('bk3', 150, Buffer.from('v2'), 'image/jpeg');
    expect(bookStore.getThumbnail('bk3', 150)!.data.toString()).toBe('v2');
  });

  it('pruneThumbnails removes rows whose width is not in the config list', () => {
    bookStore.addBook('bk4', 'd.epub', '/books/d.epub', 100, new Date(), FAKE_META);
    bookStore.saveThumbnail('bk4', 60, Buffer.from('x'), 'image/jpeg');
    bookStore.saveThumbnail('bk4', 150, Buffer.from('y'), 'image/jpeg');
    bookStore.saveThumbnail('bk4', 300, Buffer.from('z'), 'image/jpeg');
    const removed = bookStore.pruneThumbnails([60, 150]);
    expect(removed).toBe(1);
    expect(bookStore.getThumbnail('bk4', 60)).not.toBeNull();
    expect(bookStore.getThumbnail('bk4', 150)).not.toBeNull();
    expect(bookStore.getThumbnail('bk4', 300)).toBeNull();
  });

  it('pruneThumbnails with empty array removes all thumbnails', () => {
    bookStore.addBook('bk5', 'e.epub', '/books/e.epub', 100, new Date(), FAKE_META);
    bookStore.saveThumbnail('bk5', 60, Buffer.from('x'), 'image/jpeg');
    const removed = bookStore.pruneThumbnails([]);
    expect(removed).toBe(1);
  });

  it('getMissingThumbnailPairs returns pairs without thumbnails', () => {
    const metaWithCover = { ...FAKE_META, coverData: Buffer.from('cover'), coverMime: 'image/jpeg' };
    bookStore.addBook('bk6', 'f.epub', '/books/f.epub', 100, new Date(), metaWithCover);
    bookStore.addBook('bk7', 'g.epub', '/books/g.epub', 100, new Date(), metaWithCover);
    bookStore.saveThumbnail('bk6', 60, Buffer.from('x'), 'image/jpeg'); // already has 60px

    const missing = bookStore.getMissingThumbnailPairs([60, 170]);
    // bk6 needs 170, bk7 needs both
    expect(missing).toContainEqual({ bookId: 'bk6', width: 170 });
    expect(missing).toContainEqual({ bookId: 'bk7', width: 60 });
    expect(missing).toContainEqual({ bookId: 'bk7', width: 170 });
    expect(missing).not.toContainEqual({ bookId: 'bk6', width: 60 });
  });

  it('getMissingThumbnailPairs ignores books without covers', () => {
    bookStore.addBook('bk8', 'h.epub', '/books/h.epub', 100, new Date(), {
      ...FAKE_META,
      coverData: null,
      coverMime: null,
    });
    const missing = bookStore.getMissingThumbnailPairs([60]);
    expect(missing.map((p) => p.bookId)).not.toContain('bk8');
  });

  it('deleting a book cascades to book_thumbnails', () => {
    bookStore.addBook('bk9', 'i.epub', path.join(booksDir, 'i.epub'), 100, new Date(), FAKE_META);
    bookStore.saveThumbnail('bk9', 60, Buffer.from('x'), 'image/jpeg');
    bookStore.deleteBook('bk9');
    expect(bookStore.getThumbnail('bk9', 60)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest app/services/book-store.test.ts --no-coverage
```

Expected: `TypeError: bookStore.saveThumbnail is not a function` (or similar — all new tests fail).

- [ ] **Step 3: Enable foreign keys and add migration v6 in `book-store.ts`**

In `BookStore` constructor (after `this.db = db;`, before `this.migrate()`), add:
```typescript
this.db.exec('PRAGMA foreign_keys = ON');
```

At the end of `migrate()` (after the `user_version < 5` block), add:

```typescript
if (user_version < 6) {
  this.db.exec(`
    CREATE TABLE IF NOT EXISTS book_thumbnails (
      book_id  TEXT    NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      width    INTEGER NOT NULL,
      data     BLOB    NOT NULL,
      mime     TEXT    NOT NULL,
      PRIMARY KEY (book_id, width)
    )
  `);
  this.db.exec('PRAGMA user_version = 6');
}
```

- [ ] **Step 4: Add the four new methods to `BookStore`**

Add after the existing `getCover` method (around line 345):

```typescript
saveThumbnail(bookId: string, width: number, data: Buffer, mime: string): void {
  this.db
    .prepare(
      `INSERT INTO book_thumbnails (book_id, width, data, mime) VALUES (?, ?, ?, ?)
       ON CONFLICT (book_id, width) DO UPDATE SET data = excluded.data, mime = excluded.mime`
    )
    .run(bookId, width, data, mime);
}

getThumbnail(bookId: string, width: number): { data: Buffer; mime: string } | null {
  const row = this.db
    .prepare('SELECT data, mime FROM book_thumbnails WHERE book_id = ? AND width = ?')
    .get(bookId, width) as { data: Buffer; mime: string } | undefined;
  return row ?? null;
}

pruneThumbnails(configuredWidths: number[]): number {
  if (configuredWidths.length === 0) {
    return this.db.prepare('DELETE FROM book_thumbnails').run().changes;
  }
  const placeholders = configuredWidths.map(() => '?').join(', ');
  return this.db
    .prepare(`DELETE FROM book_thumbnails WHERE width NOT IN (${placeholders})`)
    .run(...configuredWidths).changes;
}

getMissingThumbnailPairs(widths: number[]): Array<{ bookId: string; width: number }> {
  const result: Array<{ bookId: string; width: number }> = [];
  const stmt = this.db.prepare(
    `SELECT id AS bookId FROM books
     WHERE cover_data IS NOT NULL
       AND id NOT IN (SELECT book_id FROM book_thumbnails WHERE width = ?)`
  );
  for (const width of widths) {
    const rows = stmt.all(width) as { bookId: string }[];
    for (const { bookId } of rows) {
      result.push({ bookId, width });
    }
  }
  return result;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx jest app/services/book-store.test.ts --no-coverage
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/services/book-store.ts app/services/book-store.test.ts
git commit -m "feat: add book_thumbnails table and thumbnail DB methods to BookStore"
```

---

### Task 4: Create `ThumbnailQueue` service

**Files:**
- Create: `app/services/thumbnail-queue.ts`
- Create: `app/services/thumbnail-queue.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/services/thumbnail-queue.test.ts`:

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { BookStore } from './book-store';
import { ThumbnailQueue } from './thumbnail-queue';
import { EpubMeta } from '../types';

jest.mock('../logger');

const FAKE_META: EpubMeta = {
  title: 'Test',
  author: 'Author',
  description: '',
  publisher: '',
  series: '',
  seriesIndex: 0,
  fileAs: '',
  identifiers: [],
  subjects: [],
  coverData: Buffer.from('fake-cover-bytes'),
  coverMime: 'image/jpeg',
  chapterCount: 0,
  chapterSpineMap: [],
  chapterNames: [],
};

const mockResize = jest.fn(async (_buf: Buffer, _width: number) =>
  Buffer.from('resized')
);

let db: InstanceType<typeof Database>;
let booksDir: string;
let bookStore: BookStore;

beforeEach(() => {
  booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-queue-test-'));
  db = new Database(':memory:');
  bookStore = new BookStore(booksDir, db);
  mockResize.mockClear();
});

afterEach(() => {
  db.close();
  fs.rmSync(booksDir, { recursive: true });
});

describe('enqueue + drainForTest', () => {
  it('generates thumbnails for each configured width', async () => {
    bookStore.addBook('bk1', 'a.epub', '/a.epub', 100, new Date(), FAKE_META);
    const queue = new ThumbnailQueue(bookStore, [60, 170], mockResize);
    queue.enqueue('bk1');
    await queue.drainForTest();

    expect(mockResize).toHaveBeenCalledTimes(2);
    expect(mockResize).toHaveBeenCalledWith(expect.any(Buffer), 60);
    expect(mockResize).toHaveBeenCalledWith(expect.any(Buffer), 170);
    expect(bookStore.getThumbnail('bk1', 60)!.data.toString()).toBe('resized');
    expect(bookStore.getThumbnail('bk1', 170)!.data.toString()).toBe('resized');
  });

  it('skips books with no cover', async () => {
    bookStore.addBook('bk2', 'b.epub', '/b.epub', 100, new Date(), {
      ...FAKE_META,
      coverData: null,
      coverMime: null,
    });
    const queue = new ThumbnailQueue(bookStore, [60], mockResize);
    queue.enqueue('bk2');
    await queue.drainForTest();

    expect(mockResize).not.toHaveBeenCalled();
  });

  it('logs and continues when resize throws', async () => {
    mockResize.mockRejectedValueOnce(new Error('sharp failed'));
    bookStore.addBook('bk3', 'c.epub', '/c.epub', 100, new Date(), FAKE_META);
    const queue = new ThumbnailQueue(bookStore, [60, 170], mockResize);
    queue.enqueue('bk3');
    await expect(queue.drainForTest()).resolves.not.toThrow();
    // Only the second width should succeed
    expect(bookStore.getThumbnail('bk3', 60)).toBeNull();
    expect(bookStore.getThumbnail('bk3', 170)!.data.toString()).toBe('resized');
  });
});

describe('reconcile', () => {
  it('queues missing (bookId, width) pairs', async () => {
    bookStore.addBook('bk4', 'd.epub', '/d.epub', 100, new Date(), FAKE_META);
    bookStore.addBook('bk5', 'e.epub', '/e.epub', 100, new Date(), FAKE_META);
    bookStore.saveThumbnail('bk4', 60, Buffer.from('x'), 'image/jpeg'); // already exists

    const queue = new ThumbnailQueue(bookStore, [60, 170], mockResize);
    queue.reconcile();
    await queue.drainForTest();

    // bk4 needs 170, bk5 needs both
    expect(bookStore.getThumbnail('bk4', 170)).not.toBeNull();
    expect(bookStore.getThumbnail('bk5', 60)).not.toBeNull();
    expect(bookStore.getThumbnail('bk5', 170)).not.toBeNull();
    // bk4/60 should be untouched (was pre-existing)
    expect(mockResize).toHaveBeenCalledTimes(3);
  });
});

describe('start (prune + reconcile)', () => {
  it('prunes widths not in config before reconciling', async () => {
    bookStore.addBook('bk6', 'f.epub', '/f.epub', 100, new Date(), FAKE_META);
    bookStore.saveThumbnail('bk6', 300, Buffer.from('old'), 'image/jpeg'); // obsolete width

    const queue = new ThumbnailQueue(bookStore, [60], mockResize);
    queue.start();
    queue.stop();
    await queue.drainForTest();

    expect(bookStore.getThumbnail('bk6', 300)).toBeNull(); // pruned
    expect(bookStore.getThumbnail('bk6', 60)).not.toBeNull(); // generated
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
npx jest app/services/thumbnail-queue.test.ts --no-coverage
```

Expected: `Cannot find module './thumbnail-queue'`.

- [ ] **Step 3: Create `app/services/thumbnail-queue.ts`**

```typescript
import sharp from 'sharp';
import { BookStore } from './book-store';
import { logger } from '../logger';

const log = logger('ThumbnailQueue');
const INTER_JOB_DELAY_MS = 200;

type ResizeFn = (buffer: Buffer, width: number) => Promise<Buffer>;

const defaultResize: ResizeFn = (buffer, width) =>
  sharp(buffer)
    .resize({ width, withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest app/services/thumbnail-queue.test.ts --no-coverage
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/services/thumbnail-queue.ts app/services/thumbnail-queue.test.ts
git commit -m "feat: add ThumbnailQueue service"
```

---

### Task 5: Wire `ThumbnailQueue` into app and update route signatures

**Files:**
- Modify: `app/app.ts`
- Modify: `app/index.ts`
- Modify: `app/routes/ui.ts` (signature only)
- Modify: `app/routes/opds.ts` (signature only)
- Modify: `app/routes/ui.test.ts` (fix call sites)
- Modify: `app/routes/opds.test.ts` (fix call sites)

- [ ] **Step 1: Update `createUiRouter` to accept `thumbnailQueue`**

In `app/routes/ui.ts`, update the import at the top and the function signature:

Add import after existing imports:
```typescript
import { ThumbnailQueue } from '../services/thumbnail-queue';
```

Change the function signature from:
```typescript
export function createUiRouter(
  bookStore: BookStore,
  userStore: UserStore,
  config: AppConfig
): Router {
```
to:
```typescript
export function createUiRouter(
  bookStore: BookStore,
  userStore: UserStore,
  config: AppConfig,
  thumbnailQueue: ThumbnailQueue
): Router {
```

- [ ] **Step 2: Update `createOpdsRouter` to accept `thumbnailWidths`**

In `app/routes/opds.ts`, change the function signature from:
```typescript
export function createOpdsRouter(bookStore: BookStore, userStore: UserStore): Router {
```
to:
```typescript
export function createOpdsRouter(
  bookStore: BookStore,
  userStore: UserStore,
  thumbnailWidths: number[]
): Router {
```

- [ ] **Step 3: Update `app/app.ts`**

Replace the full file:

```typescript
import express from 'express';
import session from 'express-session';
import { AppConfig } from './types';
import { BookStore } from './services/book-store';
import { UserStore } from './services/user-store';
import { ThumbnailQueue } from './services/thumbnail-queue';
import { createOpdsRouter } from './routes/opds';
import { createKosyncRouter } from './routes/kosync';
import { createUsersRouter } from './routes/users';
import { createUiRouter } from './routes/ui';

export function createApp(
  config: AppConfig,
  userStore: UserStore,
  bookStore: BookStore,
  thumbnailQueue: ThumbnailQueue
): express.Express {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(
    session({
      secret: config.password,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true },
    })
  );

  app.use('/opds', createOpdsRouter(bookStore, userStore, config.thumbnailWidths));
  app.use('/kosync', createKosyncRouter(userStore));
  app.use('/api/users', createUsersRouter(userStore, config.username));
  app.use('/', createUiRouter(bookStore, userStore, config, thumbnailQueue));

  return app;
}
```

- [ ] **Step 4: Update `app/index.ts`**

Replace the full file:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { loadConfig } from './config';
import { UserStore } from './services/user-store';
import { BookStore } from './services/book-store';
import { ThumbnailQueue } from './services/thumbnail-queue';
import { createApp } from './app';
import { logger } from './logger';
import packageJson from '../package.json';

const version: string = packageJson.version;

const log = logger('Server');
const config = loadConfig();

fs.mkdirSync(config.booksDir, { recursive: true });
fs.mkdirSync(config.dataDir, { recursive: true });

const db = new Database(path.join(config.dataDir, 'db.sqlite'));
const userStore = new UserStore(db);
const bookStore = new BookStore(config.booksDir, db);
const thumbnailQueue = new ThumbnailQueue(bookStore, config.thumbnailWidths);

const app = createApp(config, userStore, bookStore, thumbnailQueue);

// Startup scan: import untracked EPUBs, clean up stale DB entries
try {
  const scanResult = bookStore.scan();
  log.info(
    `Startup scan: ${scanResult.imported.length} imported, ${scanResult.removed.length} removed`
  );
} catch (err: unknown) {
  log.error(`Startup scan failed: ${err instanceof Error ? err.message : String(err)}`);
}

thumbnailQueue.start();

const shutdown = (): void => {
  log.info('Server shutting down');
  thumbnailQueue.stop();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

app.listen(config.port, () => {
  log.info(
    `HASS-ODPS v${version} starting — port: ${config.port}, booksDir: ${config.booksDir}, dataDir: ${config.dataDir}`
  );
  log.info(`Web UI:  http://localhost:${config.port}/`);
  log.info(`OPDS:    http://localhost:${config.port}/opds/`);
  log.info(`KOSync:  http://localhost:${config.port}/kosync/`);
});
```

- [ ] **Step 5: Fix `ui.test.ts` call sites**

In `app/routes/ui.test.ts`, add after the `jest.mock('../logger')` line:

```typescript
import { ThumbnailQueue } from '../services/thumbnail-queue';
```

Add this mock object after the `config` constant (around line 43):

```typescript
const mockThumbnailQueue = {
  enqueue: jest.fn(),
  reconcile: jest.fn(),
} as unknown as ThumbnailQueue;
```

In the `beforeEach` block, find:
```typescript
app.use('/', createUiRouter(bookStore, userStore, { ...config, booksDir }));
```
Replace with:
```typescript
app.use('/', createUiRouter(bookStore, userStore, { ...config, booksDir }, mockThumbnailQueue));
```

Also add to the `beforeEach`:
```typescript
(mockThumbnailQueue.enqueue as jest.Mock).mockClear();
(mockThumbnailQueue.reconcile as jest.Mock).mockClear();
```

- [ ] **Step 6: Fix `opds.test.ts` call sites**

In `app/routes/opds.test.ts`, find in `beforeEach`:
```typescript
app.use('/opds', createOpdsRouter(bookStore, userStore));
```
Replace with:
```typescript
app.use('/opds', createOpdsRouter(bookStore, userStore, [60, 170]));
```

- [ ] **Step 7: Verify all existing tests still pass**

```bash
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add app/app.ts app/index.ts app/routes/ui.ts app/routes/opds.ts app/routes/ui.test.ts app/routes/opds.test.ts
git commit -m "feat: wire ThumbnailQueue into app and update route signatures"
```

---

### Task 6: Cover endpoint `?width=` logic, enqueue hooks, and OPDS thumbnail link

**Files:**
- Modify: `app/routes/ui.ts`
- Modify: `app/routes/ui.test.ts`
- Modify: `app/routes/opds.ts`
- Modify: `app/routes/opds.test.ts`

- [ ] **Step 1: Write failing tests for `?width=` cover endpoint in `ui.test.ts`**

Append inside `describe('GET /api/books/:id/cover', () => { ... })`, after the existing three tests:

```typescript
it('returns thumbnail when ?width= matches a stored thumbnail', async () => {
  const coverBuf = Buffer.from('original-cover');
  const thumbBuf = Buffer.from('thumbnail-data');
  bookStore.addBook('thumbBook', 'tb.epub', path.join(booksDir, 'tb.epub'), 100, new Date(), {
    ...FAKE_META,
    coverData: coverBuf,
    coverMime: 'image/jpeg',
  });
  bookStore.saveThumbnail('thumbBook', 150, thumbBuf, 'image/jpeg');

  const agent = await adminAgent();
  const res = await agent.get('/api/books/thumbBook/cover?width=150');
  expect(res.status).toBe(200);
  expect(Buffer.from(res.body).toString()).toBe('thumbnail-data');
});

it('falls back to full-size when ?width= has no matching thumbnail', async () => {
  const coverBuf = Buffer.from('full-size-cover');
  bookStore.addBook('fbBook', 'fb.epub', path.join(booksDir, 'fb.epub'), 100, new Date(), {
    ...FAKE_META,
    coverData: coverBuf,
    coverMime: 'image/jpeg',
  });

  const agent = await adminAgent();
  const res = await agent.get('/api/books/fbBook/cover?width=150');
  expect(res.status).toBe(200);
  expect(Buffer.from(res.body).toString()).toBe('full-size-cover');
});
```

Also append a test for the enqueue-on-upload behaviour inside `describe('POST /api/books/upload', () => { ... })`:

```typescript
it('enqueues thumbnails after a successful upload', async () => {
  const epubBuf = makeEpub({ title: 'Queued Book' });
  const agent = await adminAgent();
  await agent.post('/api/books/upload').attach('files', epubBuf, 'queued.epub');
  expect(mockThumbnailQueue.enqueue).toHaveBeenCalledTimes(1);
});
```

And a test for `POST /api/books/scan` reconciliation (append inside `describe('POST /api/books/scan', () => { ... })`):

```typescript
it('calls thumbnailQueue.reconcile after scan', async () => {
  const agent = await adminAgent();
  await agent.post('/api/books/scan');
  expect(mockThumbnailQueue.reconcile).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run failing tests**

```bash
npx jest app/routes/ui.test.ts --no-coverage
```

Expected: the three new tests fail.

- [ ] **Step 3: Update cover endpoint in `ui.ts`**

Replace the existing cover endpoint handler (around lines 242–250):

```typescript
router.get('/api/books/:id/cover', sessionAuth, (req: Request, res: Response) => {
  const { width } = req.query;
  const parsedWidth = typeof width === 'string' ? parseInt(width, 10) : NaN;

  if (!isNaN(parsedWidth)) {
    const thumbnail = bookStore.getThumbnail(req.params.id, parsedWidth);
    if (thumbnail) {
      res.set('Content-Type', thumbnail.mime);
      res.send(thumbnail.data);
      return;
    }
    log.warn(`Cover thumbnail width=${parsedWidth} not found for book ${req.params.id}, serving full-size`);
  }

  const cover = bookStore.getCover(req.params.id);
  if (!cover) {
    res.status(404).send('Not found');
    return;
  }
  res.set('Content-Type', cover.mime);
  res.send(cover.data);
});
```

- [ ] **Step 4: Add enqueue call after upload**

In the upload handler, find the line:
```typescript
bookStore.addBook(id, file.originalname, savedPath, file.size, new Date(), meta);
uploaded.push(file.originalname);
```
Change to:
```typescript
bookStore.addBook(id, file.originalname, savedPath, file.size, new Date(), meta);
thumbnailQueue.enqueue(id);
uploaded.push(file.originalname);
```

- [ ] **Step 5: Add enqueue call after metadata reimport**

In the metadata PATCH handler, find:
```typescript
const updated = bookStore.reimportBook(req.params.id);
if (!updated) {
  res.status(500).json({ error: 'Failed to re-import book after update' });
  return;
}
```
Add after `reimportBook`:
```typescript
const updated = bookStore.reimportBook(req.params.id);
if (!updated) {
  res.status(500).json({ error: 'Failed to re-import book after update' });
  return;
}
thumbnailQueue.enqueue(updated.id);
```

- [ ] **Step 6: Add reconcile call after manual scan**

Replace the scan handler:
```typescript
router.post('/api/books/scan', sessionAuth, adminAuth, (_req: Request, res: Response) => {
  const result = bookStore.scan();
  thumbnailQueue.reconcile();
  log.info(`Scan: ${result.imported.length} imported, ${result.removed.length} removed`);
  res.json(result);
});
```

- [ ] **Step 7: Run `ui.test.ts` to verify new tests pass**

```bash
npx jest app/routes/ui.test.ts --no-coverage
```

Expected: all tests pass.

- [ ] **Step 8: Write failing tests for OPDS cover + thumbnail link in `opds.test.ts`**

Append to `app/routes/opds.test.ts`:

```typescript
describe('GET /opds/books/:id/cover', () => {
  it('returns full cover when book has one', async () => {
    const coverBuf = Buffer.from('opds-cover-data');
    bookStore.addBook('opds1', 'opds.epub', path.join(booksDir, 'opds.epub'), 100, new Date(), {
      ...FAKE_META,
      coverData: coverBuf,
      coverMime: 'image/jpeg',
    });
    const res = await request(app)
      .get('/opds/books/opds1/cover')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).toString()).toBe('opds-cover-data');
  });

  it('returns thumbnail when ?width= matches', async () => {
    const thumbBuf = Buffer.from('opds-thumb');
    bookStore.addBook('opds2', 'opds2.epub', path.join(booksDir, 'opds2.epub'), 100, new Date(), {
      ...FAKE_META,
      coverData: Buffer.from('orig'),
      coverMime: 'image/jpeg',
    });
    bookStore.saveThumbnail('opds2', 60, thumbBuf, 'image/jpeg');
    const res = await request(app)
      .get('/opds/books/opds2/cover?width=60')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).toString()).toBe('opds-thumb');
  });

  it('falls back to full-size when thumbnail missing', async () => {
    const coverBuf = Buffer.from('fallback-cover');
    bookStore.addBook('opds3', 'opds3.epub', path.join(booksDir, 'opds3.epub'), 100, new Date(), {
      ...FAKE_META,
      coverData: coverBuf,
      coverMime: 'image/jpeg',
    });
    const res = await request(app)
      .get('/opds/books/opds3/cover?width=60')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).toString()).toBe('fallback-cover');
  });
});

describe('OPDS feed thumbnail link', () => {
  it('includes opds thumbnail link for books with covers', async () => {
    bookStore.addBook('opds4', 'opds4.epub', path.join(booksDir, 'opds4.epub'), 100, new Date(), {
      ...FAKE_META,
      coverData: Buffer.from('cover'),
      coverMime: 'image/jpeg',
    });
    const res = await request(app)
      .get('/opds/books')
      .set(basicAuth('alice', 'secret'));
    expect(res.text).toContain('opds-spec.org/image/thumbnail');
    expect(res.text).toContain('?width=60');
  });

  it('does not include thumbnail link for books without covers', async () => {
    bookStore.addBook('opds5', 'opds5.epub', path.join(booksDir, 'opds5.epub'), 100, new Date(), FAKE_META);
    const res = await request(app)
      .get('/opds/books')
      .set(basicAuth('alice', 'secret'));
    expect(res.text).not.toContain('opds-spec.org/image/thumbnail');
  });
});
```

- [ ] **Step 9: Run to verify they fail**

```bash
npx jest app/routes/opds.test.ts --no-coverage
```

Expected: the five new tests fail.

- [ ] **Step 10: Update OPDS cover endpoint and feed in `opds.ts`**

Update `booksFeed` function signature and body. Replace from `function booksFeed(books: Book[], baseUrl: string): string {` through the end of the function:

```typescript
function booksFeed(books: Book[], baseUrl: string, thumbnailWidths: number[]): string {
  const now = new Date().toISOString();
  const smallestWidth = thumbnailWidths.length > 0 ? Math.min(...thumbnailWidths) : null;
  const entries = books
    .map((b) => {
      const coverLink = b.hasCover
        ? `    <link rel="http://opds-spec.org/image"\n          href="${baseUrl}/opds/books/${b.id}/cover"\n          type="image/jpeg"/>`
        : '';
      const thumbnailLink =
        b.hasCover && smallestWidth !== null
          ? `    <link rel="http://opds-spec.org/image/thumbnail"\n          href="${baseUrl}/opds/books/${b.id}/cover?width=${smallestWidth}"\n          type="image/jpeg"/>`
          : '';
      return `  <entry>
    <title>${escapeXml(b.title)}</title>
    <id>urn:hass-odps:book:${b.id}</id>
    <updated>${b.mtime.toISOString()}</updated>
    <author><name>${escapeXml(b.author)}</name></author>
    <summary>${escapeXml(b.description)}</summary>
    <link rel="http://opds-spec.org/acquisition"
          href="${baseUrl}/opds/books/${b.id}/download"
          type="application/epub+zip"
          title="${escapeXml(b.filename)}"/>
${coverLink}
${thumbnailLink}
  </entry>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>urn:hass-odps:books</id>
  <title>All Books</title>
  <updated>${now}</updated>
  <link rel="self" href="${baseUrl}/opds/books" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  <link rel="start" href="${baseUrl}/opds/" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
${entries}
</feed>`;
}
```

Update `createOpdsRouter` to use `thumbnailWidths` in the route handlers.

Replace inside `createOpdsRouter`:

The `/books` route — update the `booksFeed` call:
```typescript
router.get('/books', auth, (req: Request, res: Response) => {
  const books = bookStore.listBooks();
  log.debug(`Books feed served (${books.length} books)`);
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.set('Content-Type', 'application/atom+xml;charset=utf-8');
  res.send(booksFeed(books, baseUrl, thumbnailWidths));
});
```

Replace the cover route:
```typescript
router.get('/books/:id/cover', auth, (req: Request, res: Response) => {
  const { width } = req.query;
  const parsedWidth = typeof width === 'string' ? parseInt(width, 10) : NaN;

  if (!isNaN(parsedWidth)) {
    const thumbnail = bookStore.getThumbnail(req.params.id, parsedWidth);
    if (thumbnail) {
      res.set('Content-Type', thumbnail.mime);
      res.send(thumbnail.data);
      return;
    }
    log.warn(`Cover thumbnail width=${parsedWidth} not found for book ${req.params.id}, serving full-size`);
  }

  const cover = bookStore.getCover(req.params.id);
  if (!cover) {
    res.status(404).send('Not found');
    return;
  }
  res.set('Content-Type', cover.mime);
  res.send(cover.data);
});
```

- [ ] **Step 11: Run all tests**

```bash
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 12: Commit**

```bash
git add app/routes/ui.ts app/routes/ui.test.ts app/routes/opds.ts app/routes/opds.test.ts
git commit -m "feat: serve thumbnails via ?width= on cover endpoints and add OPDS thumbnail link"
```

---

### Task 7: Update frontend components to request thumbnails

**Files:**
- Modify: `client/src/component/cover/index.tsx`
- Modify: `client/src/component/cover-stack/index.tsx`
- Modify: `client/src/component/book-row/index.tsx`
- Modify: `client/src/page/book/index.tsx`

- [ ] **Step 1: Update `Cover` component to accept `thumbnailWidth` prop**

Replace `client/src/component/cover/index.tsx`:

```typescript
import { useStyle } from './style';

interface CoverProps {
  bookId: string | null;
  title?: string;
  sequence: 1 | 2 | 3;
  width: number;
  height: number;
  thumbnailWidth?: number;
}

export function Cover({ bookId, title, sequence, width, height, thumbnailWidth }: CoverProps) {
  const style = useStyle({ sequence, height, width, isGhost: !bookId });
  const src = thumbnailWidth
    ? `/api/books/${encodeURIComponent(bookId!)}/cover?width=${thumbnailWidth}`
    : `/api/books/${encodeURIComponent(bookId!)}/cover`;
  return bookId ? (
    <img
      src={src}
      alt={title ?? ''}
      className={`${style.layer} ${style.coverImg}`}
    />
  ) : (
    <div className={`${style.layer} ${style.ghost}`} />
  );
}
```

- [ ] **Step 2: Update `CoverStack` to pass `thumbnailWidth={170}`**

In `client/src/component/cover-stack/index.tsx`, find the `<Cover` element and add the `thumbnailWidth` prop:

```typescript
<Cover
  key={book ? book.id : `ghost-${seq}`}
  bookId={book?.hasCover ? book.id : null}
  title={book?.title}
  sequence={seq}
  width={layerWidth}
  height={layerHeight}
  thumbnailWidth={170}
/>
```

- [ ] **Step 3: Update `BookRow` to request the 60px thumbnail**

In `client/src/component/book-row/index.tsx`, find the cover img element and update its `src`:

```typescript
<img
  src={`/api/books/${encodeURIComponent(book.id)}/cover?width=60`}
  alt={book.title}
  className={styles.coverImg}
/>
```

- [ ] **Step 4: Update `BookPage` to request the 170px thumbnail**

In `client/src/page/book/index.tsx`, find the cover img element (around line 119) and update its `src`:

```typescript
<img
  className={styles.coverImg}
  src={`/api/books/${encodeURIComponent(book.id)}/cover?width=170`}
  alt={book.title}
  width={80}
  height={114}
/>
```

- [ ] **Step 5: Run client type check**

```bash
npm run --prefix client build 2>&1 | head -30
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 6: Run full test suite and lint**

```bash
npm test && npm run lint
```

Expected: all tests pass, no lint errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/component/cover/index.tsx client/src/component/cover-stack/index.tsx client/src/component/book-row/index.tsx client/src/page/book/index.tsx
git commit -m "feat: request cover thumbnails from frontend components"
```
