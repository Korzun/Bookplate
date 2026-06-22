# Timeout Hardening Design

**Date:** 2026-06-22

## Background

The app is exposed via a Cloudflare Tunnel (`book.korzun.com`). Cloudflare
enforces a hard ~100-second proxy timeout (error 524). Investigation of the
cloudflared logs showed the 524s observed were on Home Assistant Supervisor's
own long-lived `logs/follow` SSE and `/api/websocket` streams — not on
HASS-ODPS endpoints — so there is no confirmed performance bug in this app.

Nonetheless, three changes are worth making defensively. They reduce the
likelihood that a genuinely slow HASS-ODPS request ever silently 524s, and they
remove an existing N+1 query and a synchronous long-running request along the
way.

These are independent improvements. They share this spec because they were
scoped together, but each can be implemented and reviewed on its own.

## Scope

1. **Request timeout middleware** — send a clean 503 before Cloudflare's 100s
   fires.
2. **Progress endpoints** — remove the N+1 query on `/api/my/progress` and add
   transparent cursor pagination to both it and the admin progress route.
3. **Async library scan** — make scanning a background job the client polls,
   so a slow scan can't block a request past the timeout.

Out of scope: persisting scan job state across restarts, visible/on-demand
progress pagination, SSE-based scan progress, any schema migration.

---

## 1. Request timeout middleware

A single middleware in `app/server/server.ts`, added after the body parsers and
before the route handlers.

- On each request, start a `setTimeout` of **90 seconds** (10s buffer under
  Cloudflare's 100s).
- If the timer fires before the response is sent, log a warning and respond
  `503 { error: "Request timed out" }`.
- Clear the timer on `res.finish` (normal response) and `res.close` (client
  disconnected first), and guard the 503 send with `res.headersSent`.

No new file, no new dependency. ~10 lines.

---

## 2. Progress endpoints: N+1 fix + transparent pagination

### Problem

`GET /api/my/progress` currently loads every progress row for the user, then
issues one `getBookById` (a `findUnique`) **per row** to enrich each with
`currentChapter` / `currentChapterName`. That is an N+1 query, and the whole
result set is returned in a single unbounded response.

`GET /api/users/:username/progress` (admin) returns the full unbounded array
too, with no enrichment.

### What the consumers actually use (verified)

- `MyProgressRow` and `UserProgressRow` resolve the book **title themselves**
  via `useBook(bookId)` → `book.title`. They never read `title` off the
  progress object — so the response does **not** need a `title` field.
- `currentChapterName` has **zero** consumers in the client. Drop it.
- `currentChapter` has exactly **one** consumer:
  `page/book/index.tsx` → `initialChapter={progress?.currentChapter ?? 0}`,
  which pre-selects the chapter in the Set Progress modal. It must be kept.

### Decisions (Option A — batch server-side)

- **Keep** `currentChapter` in the `/api/my/progress` response. Replace the N
  per-row `findUnique` calls with **one** `findMany` per page selecting only
  `{ id, chapterSpineMap }` for that page's document ids, then compute
  `currentChapter` exactly as today. This removes the N+1 while preserving
  behaviour and requiring no client logic change beyond the pagination loop.
- **Drop** `currentChapterName` (no consumer).
- Do **not** add a `title` field (no consumer; rows use `useBook`).
- Apply the same transparent cursor pagination to the admin route. It needs no
  book lookup at all — it returns the raw progress rows (which already carry
  `device` / `timestamp`), now in pages.

### Server — `UserStore.getUserProgressPage(userId, cursor, take)`

Shared by both routes.

- Orders by `[timestamp DESC, document ASC]`.
- Fetches `take + 1` rows to detect whether a next page exists.
- Returns `{ items, nextCursor }`. `nextCursor` is a base64-encoded
  `{ timestamp, document }`, the same cursor pattern used by `GET /api/books`.
- Uses the existing `@@id([userId, document])` composite for stable Prisma
  cursor positioning.

### Server — `GET /api/my/progress`

Gains optional query params `?cursor=<base64>&take=<n>` (default `take` = 50).
For each page:

1. Fetch a page of progress rows via `getUserProgressPage`.
2. Collect the page's `document` ids and run one inline
   `prisma.book.findMany({ where: { userId, id: { in: ids } }, select: { id: true, chapterSpineMap: true } })`.
3. Map each row, computing `currentChapter` from its CFI + the book's
   `chapterSpineMap` as today (omitted when the book is gone or has no map).

Response shape changes from `Progress[]` to `{ items, nextCursor: string | null }`.
Per-item fields are unchanged from today **except** `currentChapterName` is
removed. The inline `findMany` is a narrow projection used only here, so no new
`BookStore` method is added.

### Server — `GET /api/users/:username/progress`

Gains the same `?cursor=&take=` params, paginates via `getUserProgressPage`,
and returns `{ items, nextCursor }`. No book lookup; `device` / `timestamp`
are preserved.

### Server — types

Add `ProgressPageCursor` (`{ timestamp: number; document: string }`) to
`app/server/types.ts`.

### Client — `Progress` type

In `app/client/src/provider/progress/type.ts`: remove `currentChapterName`.
`currentChapter` stays. No `title` added.

### Client — `useFetchMyProgressList` and `useFetchUserProgressList`

Both restructure identically:

- Loop: fetch page 1, then follow `nextCursor` until it is `null`, collecting
  items across pages.
- Call `setProgressForUsername` **once** at the end with the fully merged dict
  — no partial-state flicker mid-fetch.
- Loading and error handling are unchanged from the caller's perspective; the
  pagination is invisible above these hooks.

---

## 3. Async library scan

### Problem

`POST /api/books/scan` runs the full scan synchronously before responding. For
every file not already at its canonical `<id>.epub` path it does a
`partialMD5` + `parseEpub` in a loop. On slow storage this can exceed the
proxy timeout, producing a 524 with no clean error to the client.

### Decision

In-memory job state, per user. State is lost on add-on restart — acceptable
because restarts are rare, scans are user-triggered, and re-triggering a scan
is cheap. A second scan while one is running returns `409`; the client treats
that as "attach to the running job".

### Server — `ScanJobStore` (new file)

A class wrapping `Map<userId, ScanJob>`:

```ts
type ScanJob = {
  jobId: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  result?: { imported: string[]; removed: string[] };
  error?: string;
};
```

Methods: `start(userId)`, `complete(userId, result)`, `fail(userId, error)`,
`get(userId)`, `isRunning(userId)`. Instantiated once in `index.ts` and
threaded into `createServer` → `createUiRouter` alongside the existing stores.

### Server — route changes

- `POST /api/books/scan` — if `isRunning(owner.userId)`, respond `409` with the
  current job object. Otherwise `start` a job, fire the scan as a detached
  async IIFE (no `await`) that calls `complete` / `fail` on settle, and respond
  `202` with the new job object immediately.
- `GET /api/books/scan/status` — new endpoint. Returns the current job for the
  owner, or `{ status: 'idle' }` if none exists.
- Both endpoints resolve the owner via `resolveOwner`, so admin-targeting-user
  works exactly as today.

### Client — `useScanLibrary` (restructured)

- On mount, call `GET /api/books/scan/status`. If `running`, set
  `loading: true` and enter the polling loop — this restores loading state for
  an already-running scan and is the anti-hammer path.
- `scanLibrary()` posts to start a scan. On both `202` and `409` it enters the
  polling loop (409 = attach to the in-flight job).
- Polling loop: `GET /api/books/scan/status` every 2 seconds via a
  `useEffect`-managed `setTimeout` chain (not `setInterval`, to avoid stacking
  calls when a poll is slow). Clears on `completed`, `failed`, or unmount.
- On `completed`, call `clearCompleteBookIds()` and `fetchBookList()` as today.
- The `ScanResult` type (`{ imported: string[]; removed: string[] }`) is
  unchanged — it now arrives via polling rather than the POST response.

---

## Testing

- **Timeout middleware:** unit-test that a handler exceeding the limit yields
  503 and that a fast handler clears the timer (no late 503, no double-send).
- **Progress pagination:** `UserStore.getUserProgressPage` — first page,
  middle page via cursor, last page (`nextCursor: null`), empty set. Route
  tests: `/api/my/progress` computes `currentChapter` and no longer emits
  `currentChapterName`; one book `findMany` per page (not per row); multi-page
  assembly. Admin route paginates and preserves `device` / `timestamp`.
- **Async scan:** `ScanJobStore` lifecycle (start → running, complete, fail,
  isRunning). Route tests: `202` on fresh start, `409` while running,
  status endpoint for idle/running/completed/failed.
- Client hooks: existing test patterns for `useFetchMyProgressList` and
  `useScanLibrary` extended for the loop / polling behaviour.

## Files touched

- `app/server/server.ts` — timeout middleware; wire `ScanJobStore`
- `app/server/index.ts` — instantiate `ScanJobStore`
- `app/server/types.ts` — `ProgressPageCursor`
- `app/server/services/user-store.ts` — `getUserProgressPage`
- `app/server/services/scan-job-store.ts` — **new**
- `app/server/routes/ui.ts` — `/api/my/progress` pagination + batched lookup, scan routes
- `app/server/routes/users.ts` — admin progress route pagination
- `app/client/src/provider/progress/type.ts` — drop `currentChapterName`
- `app/client/src/provider/progress/hook/use-fetch-my-progress-list.ts` — paging loop
- `app/client/src/provider/progress/hook/use-fetch-user-progress-list.ts` — paging loop
- `app/client/src/provider/book/hook/use-scan-library.ts` — polling
