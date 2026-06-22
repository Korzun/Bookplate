# Timeout Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the chance a slow HASS-ODPS request silently hits Cloudflare's 524 timeout by adding a request timeout, removing the progress N+1 query with transparent pagination, and making library scans a background job the client polls.

**Architecture:** Three independent groups. (A) A request-timeout Express middleware returns 503 before Cloudflare's ~100s proxy timeout. (B) Both progress endpoints (`/api/my/progress` and admin `/api/users/:username/progress`) move to keyset cursor pagination via a shared `UserStore.getUserProgressPage`; `/api/my/progress` batches its one remaining book lookup into a single `findMany`. (C) `POST /api/books/scan` returns `202` immediately and runs the scan in the background, tracked by an in-memory `ScanJobStore`; a new `GET /api/books/scan/status` lets the client poll.

**Tech Stack:** TypeScript, Express 4, Prisma (SQLite), React, Jest (server, `app/server`), Vitest + React Testing Library (client, `app/client`), supertest.

## Global Constraints

- Work on a feature branch — never commit to `main`. (Current branch `cloudflare-timeout-error` is fine.)
- Run lint from the repo root: `cd /Users/korzun/Code/HASS-ODPS && npm run lint`. It lints both workspaces; running from one workspace silently skips the other.
- Run server tests from `app/server`: `cd /Users/korzun/Code/HASS-ODPS/app/server && npm test`.
- Run client tests from `app/client`: `cd /Users/korzun/Code/HASS-ODPS/app/client && npm test`.
- React component/hook files are kebab-case. Never add `eslint-disable`; restructure instead.
- The git remote is named `GitHub`, not `origin`.
- Note: paths in this plan use the working directory `/Users/korzun/.supacode/repos/HASS-ODPS/cloudflare-timeout-error`. The test/lint commands above reference the canonical checkout `/Users/korzun/Code/HASS-ODPS`; both are the same repo — use whichever resolves in your environment.

---

## Group A — Request Timeout Middleware

### Task A1: `requestTimeout` middleware

**Files:**
- Create: `app/server/middleware/timeout.ts`
- Create: `app/server/middleware/timeout.test.ts`
- Modify: `app/server/server.ts`

**Interfaces:**
- Produces: `requestTimeout(ms: number): (req, res, next) => void` — Express middleware that sends `503 { error: 'Request timed out' }` if the response has not been sent within `ms`, and clears its timer on `finish`/`close`.

- [ ] **Step 1: Write the failing test**

Create `app/server/middleware/timeout.test.ts`:

```ts
import express, { Request, Response } from 'express';
import request from 'supertest';
import { requestTimeout } from './timeout';

jest.mock('../logger');

function makeApp(ms: number, handler: (req: Request, res: Response) => void): express.Express {
  const app = express();
  app.use(requestTimeout(ms));
  app.get('/slow', handler);
  return app;
}

describe('requestTimeout', () => {
  it('responds 503 when the handler exceeds the limit', async () => {
    const app = makeApp(30, (_req, res) => {
      setTimeout(() => res.json({ ok: true }), 300);
    });
    const res = await request(app).get('/slow');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Request timed out' });
  });

  it('passes a fast response through unchanged', async () => {
    const app = makeApp(200, (_req, res) => res.json({ ok: true }));
    const res = await request(app).get('/slow');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('does not throw when the timer fires after the response was already sent', async () => {
    const app = makeApp(20, (_req, res) => res.json({ ok: true }));
    const res = await request(app).get('/slow');
    expect(res.status).toBe(200);
    // Give the (already-cleared) timer time to have fired; must not error.
    await new Promise((r) => setTimeout(r, 50));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/server && npx jest middleware/timeout.test.ts`
Expected: FAIL — `Cannot find module './timeout'`.

- [ ] **Step 3: Write the middleware**

Create `app/server/middleware/timeout.ts`:

```ts
import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger';

const log = logger('Timeout');

/**
 * Sends 503 if a response has not been sent within `ms`. Guards against
 * Cloudflare's ~100s proxy timeout (error 524): we respond first with a clean
 * error the client can handle. The timer is cleared once the response finishes
 * or the connection closes, and the 503 is suppressed if headers were already
 * sent (the handler won the race).
 */
export function requestTimeout(ms: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const timer = setTimeout(() => {
      if (res.headersSent) return;
      log.warn(`Request exceeded ${ms}ms — responding 503: ${req.method} ${req.path}`);
      res.status(503).json({ error: 'Request timed out' });
    }, ms);
    const clear = (): void => clearTimeout(timer);
    res.on('finish', clear);
    res.on('close', clear);
    next();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app/server && npx jest middleware/timeout.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into `server.ts`**

In `app/server/server.ts`, add the import near the other middleware imports:

```ts
import { requestTimeout } from './middleware/timeout';
```

Then register it right after `cookieParser()` and before the route `server.use(...)` calls:

```ts
  server.use(cookieParser());

  // Respond with a clean 503 before Cloudflare's ~100s proxy timeout (524).
  server.use(requestTimeout(90_000));
```

- [ ] **Step 6: Run the full server suite + lint**

Run: `cd app/server && npm test`
Expected: PASS.
Run: `cd /Users/korzun/Code/HASS-ODPS && npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add app/server/middleware/timeout.ts app/server/middleware/timeout.test.ts app/server/server.ts
git commit -m "feat(server): add 90s request timeout middleware"
```

---

## Group B — Progress Pagination + N+1 Removal

### Task B1: pagination primitives — cursor type, decode/take helpers, `getUserProgressPage`

**Files:**
- Modify: `app/server/types.ts`
- Create: `app/server/utils/progress-pagination.ts`
- Create: `app/server/utils/progress-pagination.test.ts`
- Modify: `app/server/services/user-store.ts`
- Modify: `app/server/services/user-store.test.ts`

**Interfaces:**
- Produces: `ProgressPageCursor = { timestamp: number; document: string }` (in `types.ts`).
- Produces: `decodeProgressCursor(raw: unknown): ProgressPageCursor | null` and `parseProgressTake(raw: unknown): number` (in `utils/progress-pagination.ts`).
- Produces: `UserStore.getUserProgressPage(userId: string, cursor: ProgressPageCursor | null, take: number): Promise<{ items: Progress[]; nextCursor: string | null }>`. `nextCursor` is a base64-encoded JSON `{ timestamp, document }`, or `null` when no further pages.
- Consumes: existing `Progress` type from `types.ts` (`{ document, progress, percentage, device, device_id, timestamp }`).

- [ ] **Step 1: Add the cursor type**

In `app/server/types.ts`, after the `PageCursor` type (around line 107), add:

```ts
/** Keyset cursor for progress pagination: last (timestamp, document) on a page. */
export type ProgressPageCursor = {
  timestamp: number;
  document: string;
};
```

- [ ] **Step 2: Write the failing helper test**

Create `app/server/utils/progress-pagination.test.ts`:

```ts
import { decodeProgressCursor, parseProgressTake } from './progress-pagination';

describe('decodeProgressCursor', () => {
  it('round-trips a base64 JSON cursor', () => {
    const raw = Buffer.from(JSON.stringify({ timestamp: 10, document: 'd1' })).toString('base64');
    expect(decodeProgressCursor(raw)).toEqual({ timestamp: 10, document: 'd1' });
  });

  it('returns null for non-string input', () => {
    expect(decodeProgressCursor(undefined)).toBeNull();
    expect(decodeProgressCursor(123)).toBeNull();
  });

  it('returns null for malformed base64/JSON', () => {
    expect(decodeProgressCursor('!!!not-base64-json')).toBeNull();
  });

  it('returns null when fields are the wrong shape', () => {
    const raw = Buffer.from(JSON.stringify({ timestamp: 'x', document: 1 })).toString('base64');
    expect(decodeProgressCursor(raw)).toBeNull();
  });
});

describe('parseProgressTake', () => {
  it('defaults to 50 when absent', () => {
    expect(parseProgressTake(undefined)).toBe(50);
  });

  it('clamps to [1, 100]', () => {
    expect(parseProgressTake('0')).toBe(1);
    expect(parseProgressTake('500')).toBe(100);
    expect(parseProgressTake('25')).toBe(25);
  });

  it('falls back to 50 for non-numeric strings', () => {
    expect(parseProgressTake('abc')).toBe(50);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app/server && npx jest utils/progress-pagination.test.ts`
Expected: FAIL — `Cannot find module './progress-pagination'`.

- [ ] **Step 4: Write the helpers**

Create `app/server/utils/progress-pagination.ts`:

```ts
import { ProgressPageCursor } from '../types';

/** Decodes the opaque base64 JSON cursor, or null if missing/malformed. */
export function decodeProgressCursor(raw: unknown): ProgressPageCursor | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8')) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as ProgressPageCursor).timestamp === 'number' &&
      typeof (parsed as ProgressPageCursor).document === 'string'
    ) {
      return parsed as ProgressPageCursor;
    }
    return null;
  } catch {
    return null;
  }
}

/** Parses the `take` query param, clamped to [1, 100], default 50. */
export function parseProgressTake(raw: unknown): number {
  return typeof raw === 'string' ? Math.min(Math.max(parseInt(raw, 10) || 50, 1), 100) : 50;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app/server && npx jest utils/progress-pagination.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing `getUserProgressPage` test**

In `app/server/services/user-store.test.ts`, add a new describe block at the end of the file (before the final newline). The suite's setup uses `store` for the `UserStore` instance and `prisma` for the client (confirmed), with `jest.mock('../logger')` already in place. `createUser` returns a boolean, so the user id is fetched separately via `getUserIdByUsername`:

```ts
describe('UserStore.getUserProgressPage', () => {
  async function seed(userId: string, document: string, timestamp: number): Promise<void> {
    await prisma.progress.create({
      data: {
        userId,
        document,
        progress: `/p/${document}`,
        percentage: 0.5,
        device: 'Kobo',
        deviceId: 'd1',
        timestamp,
      },
    });
  }

  it('returns an empty page with null cursor when there is no progress', async () => {
    await store.createUser('alice', 'pass');
    const id = (await store.getUserIdByUsername('alice'))!;
    const page = await store.getUserProgressPage(id, null, 50);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('orders by timestamp desc, document asc and maps fields', async () => {
    await store.createUser('alice', 'pass');
    const id = (await store.getUserIdByUsername('alice'))!;
    await seed(id, 'a', 100);
    await seed(id, 'b', 200);
    const page = await store.getUserProgressPage(id, null, 50);
    expect(page.items.map((i) => i.document)).toEqual(['b', 'a']);
    expect(page.items[0]).toMatchObject({
      document: 'b',
      progress: '/p/b',
      device: 'Kobo',
      device_id: 'd1',
      timestamp: 200,
    });
    expect(page.nextCursor).toBeNull();
  });

  it('returns a nextCursor when more rows exist and advances past them', async () => {
    await store.createUser('alice', 'pass');
    const id = (await store.getUserIdByUsername('alice'))!;
    await seed(id, 'a', 100);
    await seed(id, 'b', 200);
    await seed(id, 'c', 300);
    const page1 = await store.getUserProgressPage(id, null, 2);
    expect(page1.items.map((i) => i.document)).toEqual(['c', 'b']);
    expect(page1.nextCursor).not.toBeNull();

    const cursor = JSON.parse(
      Buffer.from(page1.nextCursor as string, 'base64').toString('utf-8')
    ) as { timestamp: number; document: string };
    const page2 = await store.getUserProgressPage(id, cursor, 2);
    expect(page2.items.map((i) => i.document)).toEqual(['a']);
    expect(page2.nextCursor).toBeNull();
  });

  it('breaks timestamp ties by document ascending', async () => {
    await store.createUser('alice', 'pass');
    const id = (await store.getUserIdByUsername('alice'))!;
    await seed(id, 'y', 100);
    await seed(id, 'x', 100);
    const page1 = await store.getUserProgressPage(id, null, 1);
    expect(page1.items.map((i) => i.document)).toEqual(['x']); // same ts, 'x' < 'y'
    const cursor = JSON.parse(
      Buffer.from(page1.nextCursor as string, 'base64').toString('utf-8')
    ) as { timestamp: number; document: string };
    const page2 = await store.getUserProgressPage(id, cursor, 1);
    expect(page2.items.map((i) => i.document)).toEqual(['y']);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd app/server && npx jest services/user-store.test.ts -t getUserProgressPage`
Expected: FAIL — `getUserProgressPage is not a function`.

- [ ] **Step 8: Implement `getUserProgressPage`**

In `app/server/services/user-store.ts`, add the `ProgressPageCursor` import to the existing `from '../types'` import:

```ts
import { Owner, Progress, ProgressPageCursor } from '../types';
```

Add the method immediately after the existing `getUserProgress` method (around line 290):

```ts
  /**
   * Keyset-paginated progress for a user, ordered by timestamp desc then
   * document asc. Fetches take+1 rows to detect a further page; `nextCursor`
   * is a base64-encoded { timestamp, document } of the last row, or null.
   */
  async getUserProgressPage(
    userId: string,
    cursor: ProgressPageCursor | null,
    take: number
  ): Promise<{ items: Progress[]; nextCursor: string | null }> {
    const rows = await this.prisma.progress.findMany({
      where: {
        userId,
        ...(cursor
          ? {
              OR: [
                { timestamp: { lt: cursor.timestamp } },
                { timestamp: cursor.timestamp, document: { gt: cursor.document } },
              ],
            }
          : {}),
      },
      orderBy: [{ timestamp: 'desc' }, { document: 'asc' }],
      take: take + 1,
    });
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const items: Progress[] = page.map((row) => ({
      document: row.document,
      progress: row.progress,
      percentage: row.percentage,
      device: row.device,
      device_id: row.deviceId,
      timestamp: row.timestamp,
    }));
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? Buffer.from(
            JSON.stringify({ timestamp: last.timestamp, document: last.document })
          ).toString('base64')
        : null;
    return { items, nextCursor };
  }
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd app/server && npx jest services/user-store.test.ts utils/progress-pagination.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add app/server/types.ts app/server/utils/progress-pagination.ts app/server/utils/progress-pagination.test.ts app/server/services/user-store.ts app/server/services/user-store.test.ts
git commit -m "feat(server): add progress keyset pagination primitives"
```

---

### Task B2: `/api/my/progress` — paginate, batch the book lookup, drop `currentChapterName`

**Files:**
- Modify: `app/server/services/book-store.ts`
- Modify: `app/server/services/book-store.test.ts`
- Modify: `app/server/routes/ui.ts:253-282`
- Modify: `app/server/routes/ui.test.ts` (the `GET /api/my/progress` describe block, ~lines 1187-1417)

**Interfaces:**
- Produces: `BookStore.getChapterSpineMaps(owner: Owner, ids: string[]): Promise<Map<string, number[]>>` — one `findMany` selecting `{ id, chapterSpineMap }`, parsing the stored JSON string to `number[]`. Missing books are simply absent from the map.
- Consumes: `UserStore.getUserProgressPage` (B1), `decodeProgressCursor`/`parseProgressTake` (B1), existing `parseCfiSpineIndex`/`spineIndexToChapter` from `../utils/cfi`.
- Produces (HTTP): `GET /api/my/progress` now returns `{ items: ProgressItem[]; nextCursor: string | null }` where each item is the progress record plus an optional `currentChapter`. `currentChapterName` is removed. Admin sessions get `{ items: [], nextCursor: null }`.

- [ ] **Step 1: Write the failing `getChapterSpineMaps` test**

In `app/server/services/book-store.test.ts`, add the following describe block. This file's setup uses `bookStore` (the `BookStore` instance), `OWNER` (an `Owner` constant), and the `stage(id)` / `FAKE_META` helpers (confirmed):

```ts
describe('BookStore.getChapterSpineMaps', () => {
  it('returns parsed spine maps keyed by id and omits missing books', async () => {
    await bookStore.addBook(OWNER, 'has-map', stage('has-map'), {
      ...FAKE_META,
      chapterCount: 3,
      chapterSpineMap: [1, 2, 3],
    });
    const map = await bookStore.getChapterSpineMaps(OWNER, ['has-map', 'missing']);
    expect(map.get('has-map')).toEqual([1, 2, 3]);
    expect(map.has('missing')).toBe(false);
  });

  it('returns an empty map for an empty id list (no query)', async () => {
    const map = await bookStore.getChapterSpineMaps(OWNER, []);
    expect(map.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/server && npx jest services/book-store.test.ts -t getChapterSpineMaps`
Expected: FAIL — `getChapterSpineMaps is not a function`.

- [ ] **Step 3: Implement `getChapterSpineMaps`**

In `app/server/services/book-store.ts`, add the method right after `getBookById` (around line 373):

```ts
  /**
   * Batched chapter-spine-map lookup for the given book ids in one query.
   * Returns a map of id → parsed spine indices; ids without a matching book
   * (e.g. progress whose book was deleted) are absent from the map.
   */
  async getChapterSpineMaps(owner: Owner, ids: string[]): Promise<Map<string, number[]>> {
    const map = new Map<string, number[]>();
    if (ids.length === 0) return map;
    const rows = await this.prisma.book.findMany({
      where: { userId: owner.userId, id: { in: ids } },
      select: { id: true, chapterSpineMap: true },
    });
    for (const row of rows) {
      let parsed: number[];
      try {
        const json: unknown = JSON.parse(row.chapterSpineMap);
        parsed = Array.isArray(json) ? (json as number[]) : [];
      } catch {
        parsed = [];
      }
      map.set(row.id, parsed);
    }
    return map;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app/server && npx jest services/book-store.test.ts -t getChapterSpineMaps`
Expected: PASS.

- [ ] **Step 5: Rewrite the `/api/my/progress` route**

In `app/server/routes/ui.ts`, add the import (near the `parseCfiSpineIndex` import, ~line 29):

```ts
import { decodeProgressCursor, parseProgressTake } from '../utils/progress-pagination';
```

Replace the entire `router.get('/api/my/progress', ...)` handler (lines 253-282) with:

```ts
  router.get('/api/my/progress', requireAuth, async (req: Request, res: Response) => {
    if (req.user!.isAdmin) {
      res.json({ items: [], nextCursor: null });
      return;
    }
    const userId = requireUserId(req, res);
    if (!userId) return;
    const owner: Owner = { userId, username: req.user!.username };
    const cursor = decodeProgressCursor(req.query.cursor);
    const take = parseProgressTake(req.query.take);
    const page = await userStore.getUserProgressPage(userId, cursor, take);
    const spineMaps = await bookStore.getChapterSpineMaps(
      owner,
      page.items.map((p) => p.document)
    );
    const items = page.items.map((p) => {
      const spineMap = spineMaps.get(p.document);
      const spineIndex = parseCfiSpineIndex(p.progress);
      const currentChapter =
        spineIndex !== null && spineMap && spineMap.length > 0
          ? (spineIndexToChapter(spineIndex, spineMap) ?? undefined)
          : undefined;
      return {
        ...p,
        ...(currentChapter !== undefined ? { currentChapter } : {}),
      };
    });
    res.json({ items, nextCursor: page.nextCursor });
  });
```

Note: `spineIndexToChapter` is still imported in `ui.ts` (used elsewhere). The `parseCfiSpineIndex` import already exists. Leave both. After this change, `chapterNames` is no longer read by this route — that's expected.

- [ ] **Step 6: Migrate the `GET /api/my/progress` route tests**

In `app/server/routes/ui.test.ts`, replace the whole `describe('GET /api/my/progress', ...)` block (lines ~1187-1417) with the version below. Changes: array assertions become `res.body.items`; the admin case returns the paged shape; the two `currentChapterName` tests are removed and replaced by one asserting the field never appears; two new tests cover the paged shape and multi-page assembly.

```ts
describe('GET /api/my/progress', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/my/progress');
    expect(res.status).toBe(401);
  });

  it('returns an empty page for admin', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .get('/api/my/progress')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], nextCursor: null });
  });

  it('returns 401 when the token has no userId (non-admin)', async () => {
    const token = signAccessToken(jwtSecret, {
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });
    const res = await request(app)
      .get('/api/my/progress')
      .set(...bearer(token));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Session expired. Please log in again.' });
  });

  it('returns own progress records for regular user', async () => {
    await userStore.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.72,
      device: 'Kobo',
      device_id: 'd1',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/my/progress')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].document).toBe('doc1');
    expect(res.body.items[0].percentage).toBeCloseTo(0.72);
    expect(res.body.nextCursor).toBeNull();
  });

  it('exposes device, device_id, timestamp, and progress CFI', async () => {
    await userStore.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/my/progress')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].device).toBe('Kobo');
    expect(res.body.items[0].device_id).toBe('d1');
    expect(typeof res.body.items[0].timestamp).toBe('number');
    expect(res.body.items[0].progress).toBe('/p[1]');
  });

  it("does not return another user's progress", async () => {
    await userStore.createUser('bob', await UserStore.hashLoginPassword('bobpass'));
    const bobId = (await userStore.getUserIdByUsername('bob'))!;
    await userStore.saveProgress(bobId, {
      document: 'doc2',
      progress: '/p[1]',
      percentage: 0.9,
      device: 'Kobo',
      device_id: 'd2',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/my/progress')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it('includes currentChapter when a matching book has chapter data and CFI is valid', async () => {
    await bookStore.addBook(aliceOwner, 'doc-with-chapters', stage('doc-with-chapters'), {
      ...FAKE_META,
      chapterCount: 3,
      chapterSpineMap: [1, 2, 3],
    });
    await userStore.saveProgress(aliceId, {
      document: 'doc-with-chapters',
      progress: 'EPUB_CFI(/6/6[ch2]!/4/1:0)',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/my/progress')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.items[0].currentChapter).toBe(2);
  });

  it('never includes currentChapterName (field removed)', async () => {
    await bookStore.addBook(aliceOwner, 'doc-with-names', stage('doc-with-names'), {
      ...FAKE_META,
      chapterCount: 3,
      chapterSpineMap: [1, 2, 3],
      chapterNames: ['Chapter 1', 'Chapter 2', 'Chapter 3'],
    });
    await userStore.saveProgress(aliceId, {
      document: 'doc-with-names',
      progress: 'EPUB_CFI(/6/6[ch2]!/4/1:0)',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/my/progress')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.items[0].currentChapter).toBe(2);
    expect(res.body.items[0]).not.toHaveProperty('currentChapterName');
  });

  it('omits currentChapter when the book is not in the DB', async () => {
    await userStore.saveProgress(aliceId, {
      document: 'unknown-book-id',
      progress: 'EPUB_CFI(/6/4!/4/1:0)',
      percentage: 0.3,
      device: 'Kobo',
      device_id: 'd1',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/my/progress')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.items[0].currentChapter).toBeUndefined();
  });

  it('omits currentChapter when the CFI is not in KoReader EPUB_CFI format', async () => {
    await bookStore.addBook(aliceOwner, 'doc-bad-cfi', stage('doc-bad-cfi'), {
      ...FAKE_META,
      chapterCount: 3,
      chapterSpineMap: [1, 2, 3],
    });
    await userStore.saveProgress(aliceId, {
      document: 'doc-bad-cfi',
      progress: '/p[1]',
      percentage: 0.1,
      device: 'Kobo',
      device_id: 'd1',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/my/progress')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.items[0].currentChapter).toBeUndefined();
  });

  it('does not expose chapterSpineMap on progress records', async () => {
    await bookStore.addBook(aliceOwner, 'doc-no-expose', stage('doc-no-expose'), {
      ...FAKE_META,
      chapterCount: 3,
      chapterSpineMap: [1, 2, 3],
    });
    await userStore.saveProgress(aliceId, {
      document: 'doc-no-expose',
      progress: 'EPUB_CFI(/6/4!/4/1:0)',
      percentage: 0.3,
      device: 'Kobo',
      device_id: 'd1',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/my/progress')
      .set(...bearer(token));
    expect(res.body.items[0].chapterSpineMap).toBeUndefined();
  });

  it('returns only the current-id entry after a reimport changes the book id', async () => {
    await bookStore.addBook(aliceOwner, 'lin-old', stage('lin-old'), FAKE_META);
    await userStore.saveProgress(aliceId, {
      document: 'lin-old',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    await bookStore.reimportBook(aliceOwner, 'lin-old', {
      parseEpub: () => FAKE_META,
      partialMD5: () => 'lin-new',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/my/progress')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].document).toBe('lin-new');
  });

  it('paginates with take and advances via nextCursor', async () => {
    for (const [doc, ts] of [['a', 100], ['b', 200], ['c', 300]] as const) {
      await userStore.saveProgress(aliceId, {
        document: doc,
        progress: '/p[1]',
        percentage: 0.5,
        device: 'Kobo',
        device_id: 'd1',
      });
      await prisma.progress.update({
        where: { userId_document: { userId: aliceId, document: doc } },
        data: { timestamp: ts },
      });
    }
    const token = await loginAlice();
    const page1 = await request(app)
      .get('/api/my/progress?take=2')
      .set(...bearer(token));
    expect(page1.body.items.map((i: { document: string }) => i.document)).toEqual(['c', 'b']);
    expect(page1.body.nextCursor).not.toBeNull();

    const page2 = await request(app)
      .get(`/api/my/progress?take=2&cursor=${encodeURIComponent(page1.body.nextCursor as string)}`)
      .set(...bearer(token));
    expect(page2.body.items.map((i: { document: string }) => i.document)).toEqual(['a']);
    expect(page2.body.nextCursor).toBeNull();
  });
});
```

- [ ] **Step 7: Run the migrated route tests**

Run: `cd app/server && npx jest routes/ui.test.ts -t "GET /api/my/progress"`
Expected: PASS.

- [ ] **Step 8: Run full server suite + lint**

Run: `cd app/server && npm test`
Expected: PASS.
Run: `cd /Users/korzun/Code/HASS-ODPS && npm run lint`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add app/server/services/book-store.ts app/server/services/book-store.test.ts app/server/routes/ui.ts app/server/routes/ui.test.ts
git commit -m "feat(server): paginate /api/my/progress and batch the book lookup"
```

---

### Task B3: admin `/api/users/:username/progress` — paginate

**Files:**
- Modify: `app/server/routes/users.ts:30-41`
- Modify: `app/server/routes/users.test.ts` (the `GET /api/users/:username/progress` describe block, ~lines 121-195)

**Interfaces:**
- Consumes: `UserStore.getUserProgressPage` (B1), `decodeProgressCursor`/`parseProgressTake` (B1).
- Produces (HTTP): `GET /api/users/:username/progress` returns `{ items: Progress[]; nextCursor: string | null }` (was a flat array). `device`/`timestamp` preserved.

- [ ] **Step 1: Update the route**

In `app/server/routes/users.ts`, add the import near the top (with the other imports):

```ts
import { decodeProgressCursor, parseProgressTake } from '../utils/progress-pagination';
```

Replace the `router.get('/:username/progress', ...)` handler body (lines 30-41) with:

```ts
  router.get('/:username/progress', async (req: Request, res: Response) => {
    const { username } = req.params;
    const userId = await userStore.getUserIdByUsername(username);
    if (!userId) {
      log.warn(`Progress fetch for unknown user "${username}"`);
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const cursor = decodeProgressCursor(req.query.cursor);
    const take = parseProgressTake(req.query.take);
    const page = await userStore.getUserProgressPage(userId, cursor, take);
    log.debug(`Progress fetched for "${username}" (${page.items.length} records)`);
    res.json({ items: page.items, nextCursor: page.nextCursor });
  });
```

- [ ] **Step 2: Migrate the admin route tests**

In `app/server/routes/users.test.ts`, within `describe('GET /api/users/:username/progress', ...)`, update the three body-shape assertions and add a pagination test. Apply these exact edits:

Replace (empty-progress case):
```ts
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
```
with:
```ts
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], nextCursor: null });
```

Replace (records case):
```ts
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].document).toBe('dune.epub');
    expect(res.body[0].percentage).toBeCloseTo(0.42);
```
with:
```ts
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].document).toBe('dune.epub');
    expect(res.body.items[0].percentage).toBeCloseTo(0.42);
    expect(res.body.nextCursor).toBeNull();
```

Replace (reimport/lineage case):
```ts
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].document).toBe('lin-new');
```
with:
```ts
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].document).toBe('lin-new');
```

Then add this test at the end of the describe block (before its closing `});`):

```ts
  it('paginates with take and advances via nextCursor', async () => {
    await userStore.createUser('alice', 'pass');
    const aliceId = (await userStore.getUserIdByUsername('alice'))!;
    for (const [doc, ts] of [['a', 100], ['b', 200], ['c', 300]] as const) {
      await userStore.saveProgress(aliceId, {
        document: doc,
        progress: '/p[1]',
        percentage: 0.5,
        device: 'Kobo',
        device_id: 'd1',
      });
      await prisma.progress.update({
        where: { userId_document: { userId: aliceId, document: doc } },
        data: { timestamp: ts },
      });
    }
    const page1 = await request(app)
      .get('/api/users/alice/progress?take=2')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(page1.body.items.map((i: { document: string }) => i.document)).toEqual(['c', 'b']);
    expect(page1.body.nextCursor).not.toBeNull();

    const page2 = await request(app)
      .get(
        `/api/users/alice/progress?take=2&cursor=${encodeURIComponent(page1.body.nextCursor as string)}`
      )
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(page2.body.items.map((i: { document: string }) => i.document)).toEqual(['a']);
    expect(page2.body.nextCursor).toBeNull();
  });
```

Note: confirm `prisma` is in scope in `users.test.ts` (it is used by the existing suite). If the admin token helper is named differently than `adminToken()`, use the file's actual helper.

- [ ] **Step 3: Run the migrated admin tests**

Run: `cd app/server && npx jest routes/users.test.ts -t "GET /api/users/:username/progress"`
Expected: PASS.

- [ ] **Step 4: Full server suite + lint**

Run: `cd app/server && npm test`
Expected: PASS.
Run: `cd /Users/korzun/Code/HASS-ODPS && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/server/routes/users.ts app/server/routes/users.test.ts
git commit -m "feat(server): paginate admin progress endpoint"
```

---

### Task B4: client — drop `currentChapterName`, page `useFetchMyProgressList`

**Files:**
- Modify: `app/client/src/provider/progress/type.ts`
- Modify: `app/client/src/provider/progress/hook/use-fetch-my-progress-list.ts`
- Modify: `app/client/src/provider/progress/hook/use-fetch-my-progress-list.test.tsx`

**Interfaces:**
- Produces (type): `Progress` loses `currentChapterName`; keeps `currentChapter?: number`.
- Consumes (HTTP): `GET /api/my/progress` → `{ items: Progress[]; nextCursor: string | null }`.

- [ ] **Step 1: Update the `Progress` type**

In `app/client/src/provider/progress/type.ts`, remove the `currentChapterName` line. Result:

```ts
export type Progress = {
  document: string;
  percentage: number;
  device?: string; // present on GET /api/users/:username/progress (admin), absent on GET /api/my/progress
  timestamp?: number; // present on GET /api/users/:username/progress (admin), absent on GET /api/my/progress
  currentChapter?: number;
};
```

- [ ] **Step 2: Update the hook test for the paged shape (write failing first)**

In `app/client/src/provider/progress/hook/use-fetch-my-progress-list.test.tsx`:

In the test `'calls setProgressForUsername with data keyed by document id'`, change the fetch mock body from the array to the paged shape:

```ts
        json: () =>
          Promise.resolve({
            items: [
              { document: 'book-1', percentage: 50 },
              { document: 'book-2', percentage: 75 },
            ],
            nextCursor: null,
          }),
```

In the two tests that resolve `Promise.resolve([])` (`'fetches /api/my/progress'` and `'calls setLoadingForUsername true then false around the fetch'`), change each `json: () => Promise.resolve([])` to:

```ts
        json: () => Promise.resolve({ items: [], nextCursor: null }),
```

Then add a new multi-page test at the end of the describe block:

```ts
  it('follows nextCursor across pages and merges into one dict', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: [{ document: 'a', percentage: 10 }], nextCursor: 'c1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: [{ document: 'b', percentage: 20 }], nextCursor: null }),
      });
    vi.stubGlobal('fetch', mockFetch);
    const setProgressForUsername = vi.fn();
    const { result } = renderHook(() => useFetchMyProgressList(), {
      wrapper: makeWrapper({ auth: { username: 'alice' }, setProgressForUsername }),
    });
    await result.current();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toBe('/api/my/progress?cursor=c1');
    expect(setProgressForUsername).toHaveBeenCalledTimes(1);
    expect(setProgressForUsername).toHaveBeenCalledWith('alice', {
      a: { document: 'a', percentage: 10 },
      b: { document: 'b', percentage: 20 },
    });
  });
```

- [ ] **Step 3: Run test to verify the new/changed tests fail**

Run: `cd app/client && npx vitest run src/provider/progress/hook/use-fetch-my-progress-list.test.tsx`
Expected: FAIL (hook still expects an array / single page).

- [ ] **Step 4: Rewrite the hook to loop pages**

Replace the body of the `useCallback` in `app/client/src/provider/progress/hook/use-fetch-my-progress-list.ts` so it follows `nextCursor`:

```ts
  return useCallback(async () => {
    if (isAdmin === true || username === undefined) return;
    if (loadingByUsername[username]) return;

    setLoadingForUsername(username, true);
    setErrorForUsername(username, undefined);
    try {
      const merged: UserProgressList = {};
      let cursor: string | null = null;
      do {
        const url: string = cursor
          ? `/api/my/progress?cursor=${encodeURIComponent(cursor)}`
          : '/api/my/progress';
        const response = await apiFetch(url);
        if (!response.ok) throw new Error('Failed to fetch progress');
        const data = (await response.json()) as { items: Progress[]; nextCursor: string | null };
        for (const p of data.items) merged[p.document] = p;
        cursor = data.nextCursor;
      } while (cursor !== null);
      setProgressForUsername(username, merged);
    } catch (err) {
      setErrorForUsername(username, err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoadingForUsername(username, false);
    }
  }, [
    isAdmin,
    username,
    loadingByUsername,
    setLoadingForUsername,
    setErrorForUsername,
    setProgressForUsername,
  ]);
```

Ensure `Progress` is imported in the file's type import (it currently imports `Progress, UserProgressList` — keep both).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app/client && npx vitest run src/provider/progress/hook/use-fetch-my-progress-list.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/provider/progress/type.ts app/client/src/provider/progress/hook/use-fetch-my-progress-list.ts app/client/src/provider/progress/hook/use-fetch-my-progress-list.test.tsx
git commit -m "feat(client): page my-progress fetch and drop currentChapterName"
```

---

### Task B5: client — page `useFetchUserProgressList`

**Files:**
- Modify: `app/client/src/provider/progress/hook/use-fetch-user-progress-list.ts`
- Modify: `app/client/src/provider/progress/hook/use-fetch-user-progress-list.test.tsx`

**Interfaces:**
- Consumes (HTTP): `GET /api/users/:username/progress` → `{ items: Progress[]; nextCursor: string | null }`.

- [ ] **Step 1: Update the tests for the paged shape (write failing first)**

In `app/client/src/provider/progress/hook/use-fetch-user-progress-list.test.tsx`:

In `'calls setProgressForUsername with data keyed by document id'`, change the mock body to:

```ts
        json: () =>
          Promise.resolve({
            items: [
              { document: 'book-1', percentage: 30, device: 'kindle', timestamp: 1000 },
              { document: 'book-2', percentage: 90 },
            ],
            nextCursor: null,
          }),
```

In the three tests that resolve `Promise.resolve([])` (`'fetches /api/users/:username/progress'`, `'URL-encodes the username in the endpoint'`, `'calls setLoadingForUsername true then false around the fetch'`), change each `json: () => Promise.resolve([])` to:

```ts
        json: () => Promise.resolve({ items: [], nextCursor: null }),
```

Add a multi-page test at the end of the describe block:

```ts
  it('follows nextCursor across pages and merges into one dict', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: [{ document: 'a', percentage: 10 }], nextCursor: 'c1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: [{ document: 'b', percentage: 20 }], nextCursor: null }),
      });
    vi.stubGlobal('fetch', mockFetch);
    const setProgressForUsername = vi.fn();
    const { result } = renderHook(() => useFetchUserProgressList(), {
      wrapper: makeWrapper({ isAdmin: true, setProgressForUsername }),
    });
    await result.current('bob');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toBe('/api/users/bob/progress?cursor=c1');
    expect(setProgressForUsername).toHaveBeenCalledTimes(1);
    expect(setProgressForUsername).toHaveBeenCalledWith('bob', {
      a: { document: 'a', percentage: 10 },
      b: { document: 'b', percentage: 20 },
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/client && npx vitest run src/provider/progress/hook/use-fetch-user-progress-list.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Rewrite the hook to loop pages**

Replace the `useCallback` body in `app/client/src/provider/progress/hook/use-fetch-user-progress-list.ts`:

```ts
  return useCallback(
    async (username: string) => {
      if (isAdmin !== true || loadingByUsername[username]) return;

      setLoadingForUsername(username, true);
      setErrorForUsername(username, undefined);
      try {
        const merged: UserProgressList = {};
        let cursor: string | null = null;
        do {
          const base = `/api/users/${encodeURIComponent(username)}/progress`;
          const url: string = cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : base;
          const response = await apiFetch(url);
          if (!response.ok) throw new Error('Failed to fetch progress');
          const data = (await response.json()) as { items: Progress[]; nextCursor: string | null };
          for (const p of data.items) merged[p.document] = p;
          cursor = data.nextCursor;
        } while (cursor !== null);
        setProgressForUsername(username, merged);
      } catch (err) {
        setErrorForUsername(username, err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoadingForUsername(username, false);
      }
    },
    [loadingByUsername, setLoadingForUsername, setErrorForUsername, setProgressForUsername, isAdmin]
  );
```

Update the file's type import to include `Progress` (it currently imports `Progress, UserProgressList` — keep both).

Note: the existing `'URL-encodes the username in the endpoint'` test expects `'/api/users/alice%20smith/progress'` (no query string) on the first page — the code above produces exactly that when `cursor` is null. Good.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app/client && npx vitest run src/provider/progress/hook/use-fetch-user-progress-list.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full client suite + lint**

Run: `cd app/client && npm test`
Expected: PASS.
Run: `cd /Users/korzun/Code/HASS-ODPS && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/provider/progress/hook/use-fetch-user-progress-list.ts app/client/src/provider/progress/hook/use-fetch-user-progress-list.test.tsx
git commit -m "feat(client): page admin user-progress fetch"
```

---

## Group C — Async Library Scan

### Task C1: `ScanJobStore`

**Files:**
- Create: `app/server/services/scan-job-store.ts`
- Create: `app/server/services/scan-job-store.test.ts`

**Interfaces:**
- Produces:
  - `type ScanResult = { imported: string[]; removed: string[] }`
  - `type ScanJob = { jobId: string; status: 'running' | 'completed' | 'failed'; startedAt: number; result?: ScanResult; error?: string }`
  - `class ScanJobStore` with `start(userId): ScanJob`, `complete(userId, result): void`, `fail(userId, error): void`, `get(userId): ScanJob | undefined`, `isRunning(userId): boolean`.

- [ ] **Step 1: Write the failing test**

Create `app/server/services/scan-job-store.test.ts`:

```ts
import { ScanJobStore } from './scan-job-store';

describe('ScanJobStore', () => {
  it('start() records a running job and returns it', () => {
    const store = new ScanJobStore();
    const job = store.start('u1');
    expect(job.status).toBe('running');
    expect(typeof job.jobId).toBe('string');
    expect(job.jobId).not.toHaveLength(0);
    expect(typeof job.startedAt).toBe('number');
    expect(store.isRunning('u1')).toBe(true);
    expect(store.get('u1')).toBe(job);
  });

  it('complete() marks the job completed with a result', () => {
    const store = new ScanJobStore();
    store.start('u1');
    store.complete('u1', { imported: ['a'], removed: [] });
    const job = store.get('u1');
    expect(job?.status).toBe('completed');
    expect(job?.result).toEqual({ imported: ['a'], removed: [] });
    expect(store.isRunning('u1')).toBe(false);
  });

  it('fail() marks the job failed with an error', () => {
    const store = new ScanJobStore();
    store.start('u1');
    store.fail('u1', 'boom');
    const job = store.get('u1');
    expect(job?.status).toBe('failed');
    expect(job?.error).toBe('boom');
    expect(store.isRunning('u1')).toBe(false);
  });

  it('isolates jobs per user', () => {
    const store = new ScanJobStore();
    store.start('u1');
    expect(store.isRunning('u2')).toBe(false);
    expect(store.get('u2')).toBeUndefined();
  });

  it('start() replaces a previous terminal job for the same user', () => {
    const store = new ScanJobStore();
    const first = store.start('u1');
    store.complete('u1', { imported: [], removed: [] });
    const second = store.start('u1');
    expect(second.jobId).not.toBe(first.jobId);
    expect(store.isRunning('u1')).toBe(true);
  });

  it('complete()/fail() are no-ops when no job exists', () => {
    const store = new ScanJobStore();
    expect(() => store.complete('nobody', { imported: [], removed: [] })).not.toThrow();
    expect(() => store.fail('nobody', 'x')).not.toThrow();
    expect(store.get('nobody')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/server && npx jest services/scan-job-store.test.ts`
Expected: FAIL — `Cannot find module './scan-job-store'`.

- [ ] **Step 3: Implement the store**

Create `app/server/services/scan-job-store.ts`:

```ts
import { randomUUID } from 'crypto';

export type ScanResult = { imported: string[]; removed: string[] };
export type ScanJobStatus = 'running' | 'completed' | 'failed';

export type ScanJob = {
  jobId: string;
  status: ScanJobStatus;
  startedAt: number;
  result?: ScanResult;
  error?: string;
};

/**
 * In-memory, per-user scan job tracking. State is intentionally not persisted:
 * scans are user-triggered and cheap to re-run, so losing job state on restart
 * is acceptable. One job per user; starting a new one replaces any prior job.
 */
export class ScanJobStore {
  private readonly jobs = new Map<string, ScanJob>();

  start(userId: string): ScanJob {
    const job: ScanJob = { jobId: randomUUID(), status: 'running', startedAt: Date.now() };
    this.jobs.set(userId, job);
    return job;
  }

  complete(userId: string, result: ScanResult): void {
    const job = this.jobs.get(userId);
    if (job) {
      job.status = 'completed';
      job.result = result;
    }
  }

  fail(userId: string, error: string): void {
    const job = this.jobs.get(userId);
    if (job) {
      job.status = 'failed';
      job.error = error;
    }
  }

  get(userId: string): ScanJob | undefined {
    return this.jobs.get(userId);
  }

  isRunning(userId: string): boolean {
    return this.jobs.get(userId)?.status === 'running';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app/server && npx jest services/scan-job-store.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/server/services/scan-job-store.ts app/server/services/scan-job-store.test.ts
git commit -m "feat(server): add in-memory ScanJobStore"
```

---

### Task C2: async scan routes + status endpoint + wiring

**Files:**
- Modify: `app/server/routes/ui.ts` (createUiRouter signature; `POST /api/books/scan`, ~lines 729-736; add `GET /api/books/scan/status`)
- Modify: `app/server/server.ts` (construct `ScanJobStore`, pass to `createUiRouter`)
- Modify: `app/server/routes/ui.test.ts` (harness `createUiRouter` call; the two scan describe blocks)

**Interfaces:**
- Consumes: `ScanJobStore` (C1).
- Produces (signature): `createUiRouter(bookStore, userStore, config, thumbnailQueue, tokenStore, jwtSecret, scanJobStore)` — `scanJobStore: ScanJobStore` added as the final parameter.
- Produces (HTTP): `POST /api/books/scan` → `202` + `ScanJob` (or `409` + current `ScanJob` if one is running). `GET /api/books/scan/status` → current `ScanJob` or `{ status: 'idle' }`.

- [ ] **Step 1: Extend `createUiRouter` and add the routes**

In `app/server/routes/ui.ts`:

Add the import:

```ts
import { ScanJobStore } from '../services/scan-job-store';
```

Add `scanJobStore` as the final parameter of `createUiRouter`:

```ts
export function createUiRouter(
  bookStore: BookStore,
  userStore: UserStore,
  config: AppConfig,
  thumbnailQueue: ThumbnailQueue,
  tokenStore: TokenStore,
  jwtSecret: Buffer,
  scanJobStore: ScanJobStore
): Router {
```

Replace the existing `router.post('/api/books/scan', ...)` handler (lines 729-736) with the async version plus a status route:

```ts
  router.post('/api/books/scan', requireAuth, async (req: Request, res: Response) => {
    const owner = await resolveOwner(req, res);
    if (!owner) return;
    if (scanJobStore.isRunning(owner.userId)) {
      res.status(409).json(scanJobStore.get(owner.userId));
      return;
    }
    const job = scanJobStore.start(owner.userId);
    res.status(202).json(job);
    // Run the scan in the background; the client polls /api/books/scan/status.
    void (async () => {
      try {
        const result = await bookStore.scan(owner);
        await thumbnailQueue.reconcile();
        log.info(`Scan: ${result.imported.length} imported, ${result.removed.length} removed`);
        scanJobStore.complete(owner.userId, result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`Scan failed for "${owner.username}": ${message}`);
        scanJobStore.fail(owner.userId, message);
      }
    })();
  });

  router.get('/api/books/scan/status', requireAuth, async (req: Request, res: Response) => {
    const owner = await resolveOwner(req, res);
    if (!owner) return;
    const job = scanJobStore.get(owner.userId);
    res.json(job ?? { status: 'idle' });
  });
```

- [ ] **Step 2: Wire `ScanJobStore` in `server.ts`**

In `app/server/server.ts`, add the import:

```ts
import { ScanJobStore } from './services/scan-job-store';
```

Inside `createServer`, before the `server.use('/', createUiRouter(...))` call, construct the store, then pass it as the final argument:

```ts
  const scanJobStore = new ScanJobStore();
  server.use(
    '/',
    createUiRouter(bookStore, userStore, config, thumbnailQueue, tokenStore, jwtSecret, scanJobStore)
  );
```

(No change to `index.ts` — the store is process-lifetime per server instance, created here.)

- [ ] **Step 3: Update the test harness to pass a `ScanJobStore` and keep a reference**

In `app/server/routes/ui.test.ts`:

Add the import near the other service imports:

```ts
import { ScanJobStore } from '../services/scan-job-store';
```

Add a module-level variable alongside the others (near `let tokenStore: TokenStore;`):

```ts
let scanJobStore: ScanJobStore;
```

In `beforeEach`, construct it and pass it to `createUiRouter` (update the existing `createUiRouter(...)` call):

```ts
  scanJobStore = new ScanJobStore();
  app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(
    '/',
    createUiRouter(
      bookStore,
      userStore,
      { ...config, booksDir },
      mockThumbnailQueue,
      tokenStore,
      jwtSecret,
      scanJobStore
    )
  );
```

- [ ] **Step 4: Replace the two scan describe blocks with async versions**

In `app/server/routes/ui.test.ts`, add this polling helper just above `describe('POST /api/books/scan', ...)`:

```ts
async function waitForScan(token: string): Promise<{
  status: string;
  result?: { imported: string[]; removed: string[] };
  error?: string;
}> {
  for (let i = 0; i < 100; i++) {
    const res = await request(app)
      .get('/api/books/scan/status')
      .set(...bearer(token));
    if (res.body.status !== 'running') return res.body;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('scan did not finish in time');
}
```

Replace `describe('POST /api/books/scan', ...)` (lines ~1068-1129) with:

```ts
describe('POST /api/books/scan', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/books/scan');
    expect(res.status).toBe(401);
  });

  it('returns 202 with a running job and completes with empty result', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/scan')
      .set(...bearer(token));
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('running');
    const final = await waitForScan(token);
    expect(final.status).toBe('completed');
    expect(final.result).toEqual({ imported: [], removed: [] });
  });

  it('imports an epub file found on disk but not in DB', async () => {
    const epubBuf = makeEpub({ title: 'Found Book', author: 'Found Author' });
    fs.mkdirSync(path.join(booksDir, 'alice'), { recursive: true });
    fs.writeFileSync(path.join(booksDir, 'alice', 'found.epub'), epubBuf);

    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/scan')
      .set(...bearer(token));
    expect(res.status).toBe(202);
    const final = await waitForScan(token);
    expect(final.status).toBe('completed');
    expect(final.result!.imported).toContain('found.epub');
    expect(final.result!.removed).toEqual([]);

    const listRes = await request(app)
      .get('/api/books')
      .set(...bearer(token));
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].title).toBe('Found Book');
  });

  it('reports removed for a DB entry whose file is gone', async () => {
    await bookStore.addBook(aliceOwner, 'stale001', stage('stale001'), {
      ...FAKE_META,
      title: 'Stale Book',
    });
    fs.rmSync(path.join(booksDir, 'alice', 'stale001.epub'));

    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/scan')
      .set(...bearer(token));
    expect(res.status).toBe(202);
    const final = await waitForScan(token);
    expect(final.result!.removed).toContain('stale001.epub');
    expect(final.result!.imported).toEqual([]);
  });

  it('calls thumbnailQueue.reconcile after scan', async () => {
    const token = await loginAlice();
    await request(app)
      .post('/api/books/scan')
      .set(...bearer(token));
    await waitForScan(token);
    expect(mockThumbnailQueue.reconcile).toHaveBeenCalledTimes(1);
  });

  it('returns 409 with the current job when a scan is already running', async () => {
    const token = await loginAlice();
    scanJobStore.start(aliceId); // simulate an in-flight scan
    const res = await request(app)
      .post('/api/books/scan')
      .set(...bearer(token));
    expect(res.status).toBe(409);
    expect(res.body.status).toBe('running');
  });
});

describe('GET /api/books/scan/status', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/books/scan/status');
    expect(res.status).toBe(401);
  });

  it('returns idle when no scan has run for the user', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books/scan/status')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'idle' });
  });

  it('reflects a running job', async () => {
    const token = await loginAlice();
    scanJobStore.start(aliceId);
    const res = await request(app)
      .get('/api/books/scan/status')
      .set(...bearer(token));
    expect(res.body.status).toBe('running');
  });
});
```

Replace `describe('POST /api/books/scan (admin needs ?user=)', ...)` (lines ~1161-1185) with:

```ts
describe('POST /api/books/scan (admin needs ?user=)', () => {
  it('admin can scan a targeted library with ?user=', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/books/scan?user=alice')
      .set(...bearer(token));
    expect(res.status).toBe(202);
  });

  it('admin without ?user= gets 400', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/books/scan')
      .set(...bearer(token));
    expect(res.status).toBe(400);
  });

  it('regular user scans their own library (202)', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/scan')
      .set(...bearer(token));
    expect(res.status).toBe(202);
  });
});
```

- [ ] **Step 5: Run the scan route tests**

Run: `cd app/server && npx jest routes/ui.test.ts -t scan`
Expected: PASS.

- [ ] **Step 6: Full server suite + lint**

Run: `cd app/server && npm test`
Expected: PASS.
Run: `cd /Users/korzun/Code/HASS-ODPS && npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add app/server/routes/ui.ts app/server/server.ts app/server/routes/ui.test.ts
git commit -m "feat(server): make library scan a background job with status polling"
```

---

### Task C3: client — restructure `useScanLibrary` to poll

**Files:**
- Modify: `app/client/src/provider/book/hook/use-scan-library.ts`
- Modify: `app/client/src/provider/book/hook/use-scan-library.test.tsx`

**Interfaces:**
- Consumes (HTTP): `POST /api/books/scan` → `202`/`409`; `GET /api/books/scan/status` → `ScanJob | { status: 'idle' }`.
- Produces: `useScanLibrary()` keeps its return tuple `[scanLibrary, scanResult, loading, error, errorMessage]`. `scanLibrary()` now resolves only once the background scan reaches a terminal state (via polling). On mount, if a scan is already running, the hook enters `loading` and polls.

- [ ] **Step 1: Rewrite the hook**

Replace the entire contents of `app/client/src/provider/book/hook/use-scan-library.ts` with:

```ts
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from '../../../lib/api-fetch';
import { Context } from '../context';

import { useFetchBookList } from './use-fetch-book-list';

export type ScanResult = {
  imported: string[];
  removed: string[];
};

type ScanStatus =
  | { status: 'idle' }
  | {
      jobId: string;
      status: 'running' | 'completed' | 'failed';
      startedAt: number;
      result?: ScanResult;
      error?: string;
    };

const POLL_INTERVAL_MS = 2000;

export type ScanLibrary = () => Promise<ScanResult | null>;
export type UseScanLibrary =
  | [ScanLibrary, undefined, false, false, undefined] // Initial state
  | [ScanLibrary, undefined, true, false, undefined] // Scan is under way
  | [ScanLibrary, ScanResult, false, false, undefined] // Scan completed successfully
  | [ScanLibrary, undefined, false, true, undefined] // There was an unspecified error while scanning
  | [ScanLibrary, undefined, false, true, string]; // There was a specified error while scanning

export const useScanLibrary = (): UseScanLibrary => {
  const { clearCompleteBookIds } = useContext(Context);
  const fetchBookList = useFetchBookList();
  const withTargetUser = useWithTargetUser();
  const [scanResult, setScanResult] = useState<ScanResult | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const cancelledRef = useRef(false);

  const applyCompletion = useCallback(
    (result: ScanResult) => {
      setScanResult(result);
      clearCompleteBookIds();
      fetchBookList();
    },
    [clearCompleteBookIds, fetchBookList]
  );

  // Polls the status endpoint until the job reaches a terminal state.
  // Resolves with the result on completion, or null on failure/cancellation.
  const pollUntilDone = useCallback(async (): Promise<ScanResult | null> => {
    while (!cancelledRef.current) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      if (cancelledRef.current) return null;
      let response: Response;
      try {
        response = await apiFetch(withTargetUser('/api/books/scan/status'));
      } catch {
        if (!cancelledRef.current) setError(true);
        return null;
      }
      if (!response.ok) {
        if (!cancelledRef.current) setError(true);
        return null;
      }
      const job = (await response.json()) as ScanStatus;
      if (job.status === 'completed') {
        const result = job.result ?? { imported: [], removed: [] };
        if (!cancelledRef.current) applyCompletion(result);
        return result;
      }
      if (job.status === 'failed') {
        if (!cancelledRef.current) {
          setError(true);
          setErrorMessage('error' in job ? job.error : undefined);
        }
        return null;
      }
      // 'running' | 'idle' → keep polling
    }
    return null;
  }, [withTargetUser, applyCompletion]);

  const scanLibrary: ScanLibrary = useCallback(async () => {
    if (loading) return null;

    setLoading(true);
    setError(false);
    setErrorMessage(undefined);
    setScanResult(undefined);

    try {
      const response = await apiFetch(withTargetUser('/api/books/scan'), { method: 'POST' });
      // 202 = started, 409 = already running; both mean "attach and poll".
      if (response.status !== 202 && response.status !== 409) {
        setError(true);
        return null;
      }
      return await pollUntilDone();
    } catch (err) {
      setError(true);
      if (err instanceof Error) setErrorMessage(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [withTargetUser, pollUntilDone, loading]);

  // On mount, attach to an already-running scan (e.g. a page reload mid-scan)
  // so the button shows its loading state and we surface the eventual result.
  useEffect(() => {
    cancelledRef.current = false;
    let active = true;
    void (async () => {
      try {
        const response = await apiFetch(withTargetUser('/api/books/scan/status'));
        if (!active || !response.ok) return;
        const job = (await response.json()) as ScanStatus;
        if (active && job.status === 'running') {
          setLoading(true);
          await pollUntilDone();
          if (active) setLoading(false);
        }
      } catch {
        /* ignore status errors on mount */
      }
    })();
    return () => {
      active = false;
      cancelledRef.current = true;
    };
  }, [withTargetUser, pollUntilDone]);

  return useMemo(
    () => [scanLibrary, scanResult, loading, error, errorMessage] as UseScanLibrary,
    [scanLibrary, scanResult, loading, error, errorMessage]
  );
};
```

- [ ] **Step 2: Rewrite the hook test**

Replace the entire contents of `app/client/src/provider/book/hook/use-scan-library.test.tsx` with the version below. It keeps the existing `makeWrapper`, adds fake timers to drive polling, and accounts for the on-mount status check.

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { BookList } from '../type';

function makeWrapper(clearCompleteBookIds: () => void = () => {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [bookList, setBookListRaw] = useState<BookList>({});
    const [bookListLoading, setBookListLoadingState] = useState(false);

    const setBookList = useCallback(
      (updater: (prev: BookList) => BookList) => setBookListRaw(updater),
      []
    );
    const setBookListLoading = useCallback((v: boolean) => setBookListLoadingState(v), []);

    return (
      <Context.Provider
        value={{
          bookList,
          bookListFetched: false,
          bookListLoading,
          bookListError: undefined,
          loadingByBookId: {},
          errorByBookId: {},
          completeBookIds: new Set(),
          setBookList,
          setBookListFetched: () => {},
          setBookListLoading,
          setBookListError: () => {},
          setLoadingForBook: () => {},
          setErrorForBook: () => {},
          setBookComplete: () => {},
          clearCompleteBookIds,
          bookListItems: [],
          nextCursor: null,
          setBookListItems: () => {},
          setNextCursor: () => {},
          bookListFilter: {},
          setBookListFilter: () => {},
        }}
      >
        {children}
      </Context.Provider>
    );
  };
}

import { useScanLibrary } from './use-scan-library';

// Helpers to build fetch responses.
const ok = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });
const accepted = (body: unknown) => ({ ok: true, status: 202, json: () => Promise.resolve(body) });

describe('useScanLibrary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('on mount, checks status and stays idle when no scan is running', async () => {
    const mockFetch = vi.fn().mockResolvedValue(ok({ status: 'idle' }));
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useScanLibrary(), { wrapper: makeWrapper() });
    await vi.advanceTimersByTimeAsync(0);

    expect(mockFetch).toHaveBeenCalledWith('/api/books/scan/status', {});
    expect(result.current[2]).toBe(false); // not loading
  });

  it('starts a scan, polls to completion, and clears complete book ids', async () => {
    const mockClear = vi.fn();
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(ok({ status: 'idle' })) // mount status check
      .mockResolvedValueOnce(accepted({ jobId: 'j1', status: 'running', startedAt: 1 })) // POST
      .mockResolvedValueOnce(
        ok({ jobId: 'j1', status: 'completed', startedAt: 1, result: { imported: ['x'], removed: [] } })
      ); // first poll
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useScanLibrary(), { wrapper: makeWrapper(mockClear) });
    await vi.advanceTimersByTimeAsync(0); // resolve mount status

    let scanPromise!: Promise<unknown>;
    act(() => {
      scanPromise = result.current[0]();
    });
    await vi.advanceTimersByTimeAsync(0); // POST resolves
    await vi.advanceTimersByTimeAsync(2000); // first poll fires
    await act(async () => {
      await scanPromise;
    });

    expect(mockClear).toHaveBeenCalled();
    expect(result.current[1]).toEqual({ imported: ['x'], removed: [] }); // scanResult
    expect(result.current[2]).toBe(false); // loading cleared
  });

  it('sets error when the POST is rejected', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(ok({ status: 'idle' })) // mount
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) }); // POST
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useScanLibrary(), { wrapper: makeWrapper() });
    await vi.advanceTimersByTimeAsync(0);

    let scanPromise!: Promise<unknown>;
    act(() => {
      scanPromise = result.current[0]();
    });
    await act(async () => {
      await scanPromise;
    });

    expect(result.current[3]).toBe(true); // error
  });

  it('does not start a second scan while one is in progress', async () => {
    // mount = idle; POST = 202; status polls never complete (stay running).
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(ok({ status: 'idle' }))
      .mockResolvedValueOnce(accepted({ jobId: 'j1', status: 'running', startedAt: 1 }))
      .mockResolvedValue(ok({ jobId: 'j1', status: 'running', startedAt: 1 }));
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useScanLibrary(), { wrapper: makeWrapper() });
    await vi.advanceTimersByTimeAsync(0); // mount status

    act(() => {
      void result.current[0]();
    });
    await vi.advanceTimersByTimeAsync(0); // POST resolves, loading true
    await waitFor(() => expect(result.current[2]).toBe(true));

    const postCalls = () =>
      mockFetch.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
    expect(postCalls()).toHaveLength(1);

    await act(async () => {
      await result.current[0](); // second call — should be a no-op
    });
    expect(postCalls()).toHaveLength(1);
  });

  it('attaches to an already-running scan on mount and shows loading', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(ok({ jobId: 'j1', status: 'running', startedAt: 1 })) // mount: running
      .mockResolvedValue(ok({ jobId: 'j1', status: 'running', startedAt: 1 })); // polls keep running
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useScanLibrary(), { wrapper: makeWrapper() });
    await vi.advanceTimersByTimeAsync(0); // mount status resolves → running

    await waitFor(() => expect(result.current[2]).toBe(true)); // loading from mount attach
  });
});
```

- [ ] **Step 3: Run the hook test**

Run: `cd app/client && npx vitest run src/provider/book/hook/use-scan-library.test.tsx`
Expected: PASS. If a polling test flakes on timer flushing, add an extra `await vi.advanceTimersByTimeAsync(2000)` before awaiting the scan promise — each poll waits one `POLL_INTERVAL_MS` tick.

- [ ] **Step 4: Full client suite + lint**

Run: `cd app/client && npm test`
Expected: PASS.
Run: `cd /Users/korzun/Code/HASS-ODPS && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/client/src/provider/book/hook/use-scan-library.ts app/client/src/provider/book/hook/use-scan-library.test.tsx
git commit -m "feat(client): poll scan status and attach to in-flight scans"
```

---

## Final Verification

- [ ] **Step 1: Run both full suites**

Run: `cd app/server && npm test`
Expected: PASS.
Run: `cd app/client && npm test`
Expected: PASS.

- [ ] **Step 2: Lint the whole repo**

Run: `cd /Users/korzun/Code/HASS-ODPS && npm run lint`
Expected: clean (both workspaces).

- [ ] **Step 3: Manual smoke (optional but recommended)**

Use the `run` skill (or `verify`) to launch the app, confirm: the library loads, "My Progress" populates, the Set Progress modal still pre-selects the saved chapter on a previously-read book, and a library scan shows a spinner that resolves to a toast.

- [ ] **Step 4: Push and open PR (only when the user asks)**

```bash
git push -u GitHub cloudflare-timeout-error
```
