# Thumbnail Sizes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-size server thumbnail generation to 86px and 160px (2× retina of the 43px and 80px CSS display sizes), add generation success logging, and detect thumbnail width changes on startup with a clear regen log.

**Architecture:** Three independent changes — server default config widths, server thumbnail-queue logging behaviour, client hardcoded `?width=` request values. The server changes land first so the test suite stays green throughout; the client changes are pure constant swaps with no new tests needed beyond existing coverage.

**Tech Stack:** Node.js/TypeScript (server), React/TypeScript (client), Jest (server tests), Vitest (client tests), Sharp (image resize).

## Global Constraints

- All implementation work must be on the current feature branch — never commit directly to main.
- React component files use kebab-case naming (e.g. `cover.tsx`).
- Run `npm run lint` after `npm test` in every task.
- Keep `react-hooks` ESLint rules at error; never use `eslint-disable`.
- Use `git push -u GitHub <branch>` (remote is named `GitHub`, not `origin`).

---

### Task 1: Update server default thumbnail widths

**Files:**
- Modify: `app/server/config.ts:23`
- Modify: `app/server/routes/ui.test.ts:59`

**Interfaces:**
- Consumes: nothing from prior tasks
- Produces: `AppConfig.thumbnailWidths` defaults to `[86, 160]`; `ui.test.ts` fixture reflects the new defaults

- [ ] **Step 1: Update config default**

In `app/server/config.ts`, change line 23:
```typescript
// before
thumbnail_widths: [60, 170],

// after
thumbnail_widths: [86, 160],
```

- [ ] **Step 2: Update ui.test.ts fixture**

In `app/server/routes/ui.test.ts`, change line 59:
```typescript
// before
thumbnailWidths: [60, 170],

// after
thumbnailWidths: [86, 160],
```

- [ ] **Step 3: Run server tests**

```bash
cd app/server && npx jest
```

Expected: all tests pass (the fixture change is cosmetic — the mock thumbnail queue doesn't use the widths array).

- [ ] **Step 4: Run lint**

```bash
npm run lint -w app/server
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/server/config.ts app/server/routes/ui.test.ts
git commit -m "feat: update default thumbnail widths to 86px and 160px (2x retina)"
```

---

### Task 2: Thumbnail queue logging

**Files:**
- Modify: `app/server/services/thumbnail-queue.ts`
- Modify: `app/server/services/thumbnail-queue.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks
- Produces:
  - `ThumbnailQueue.reconcile(): Promise<{ bookCount: number }>` — returns unique book count with missing thumbnails (previously `Promise<void>`)
  - `ThumbnailQueue.start()` — logs `Thumbnail widths changed — regenerating covers for N book(s) (pruned P stale thumbnail(s))` when `pruneThumbnails` returns > 0
  - `ThumbnailQueue.processJob()` (private) — logs `Generated Wpx thumbnail for book <id>` on success

- [ ] **Step 1: Write failing test for reconcile() return value**

Add a new test inside the `describe('reconcile', ...)` block in `app/server/services/thumbnail-queue.test.ts`:

```typescript
it('returns the number of unique books with missing thumbnails', async () => {
  await bookStore.addBook(OWNER, 'bk_rc1', stage('bk_rc1'), FAKE_META);
  await bookStore.addBook(OWNER, 'bk_rc2', stage('bk_rc2'), FAKE_META);
  // bk_rc1 already has an 86px thumbnail
  await bookStore.saveThumbnail(OWNER.userId, 'bk_rc1', 86, Buffer.from('x'), 'image/jpeg');

  const queue = new ThumbnailQueue(bookStore, [86, 160], mockResize);
  const { bookCount } = await queue.reconcile();

  // bk_rc1 needs only 160px, bk_rc2 needs both — 2 unique books
  expect(bookCount).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app/server && npx jest thumbnail-queue
```

Expected: FAIL — `reconcile()` currently returns `void`, so `{ bookCount }` destructures to `undefined`.

- [ ] **Step 3: Implement logging changes in thumbnail-queue.ts**

Replace the `reconcile()` method (currently lines 49–57):
```typescript
async reconcile(): Promise<{ bookCount: number }> {
  const missing = await this.bookStore.getMissingThumbnailPairs(this.widths);
  for (const pair of missing) {
    this.queue.push(pair);
  }
  return { bookCount: new Set(missing.map((p) => p.bookId)).size };
}
```

Replace the `start()` method (currently lines 31–37):
```typescript
async start(): Promise<void> {
  if (this.running) return;
  const pruned = await this.bookStore.pruneThumbnails(this.widths);
  const { bookCount } = await this.reconcile();
  if (pruned > 0) {
    log.info(
      `Thumbnail widths changed — regenerating covers for ${bookCount} book(s) (pruned ${pruned} stale thumbnail(s))`
    );
  }
  this.running = true;
  void this.processLoop();
}
```

In `processJob()`, add a success log immediately after `saveThumbnail` (currently line 98):
```typescript
try {
  const resized = await this.resize(cover.data, job.width);
  await this.bookStore.saveThumbnail(job.userId, job.bookId, job.width, resized, 'image/jpeg');
  log.info(`Generated ${job.width}px thumbnail for book ${job.bookId}`);
} catch (err: unknown) {
  log.warn(
    `Failed to generate ${job.width}px thumbnail for book ${job.bookId}: ${
      err instanceof Error ? err.message : String(err)
    }`
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd app/server && npx jest thumbnail-queue
```

Expected: all tests pass, including the new `returns the number of unique books` test.

- [ ] **Step 5: Run full server test suite + lint**

```bash
cd app/server && npx jest && npm run lint
```

Expected: no failures, no lint errors.

- [ ] **Step 6: Commit**

```bash
git add app/server/services/thumbnail-queue.ts app/server/services/thumbnail-queue.test.ts
git commit -m "feat: add thumbnail generation logging and width-change detection"
```

---

### Task 3: Update client thumbnail request widths

**Files:**
- Modify: `app/client/src/component/book-row/index.tsx:38`
- Modify: `app/client/src/component/cover-stack/index.tsx:34`
- Modify: `app/client/src/page/book/index.tsx:101`

**Interfaces:**
- Consumes: server now generates 86px and 160px thumbnails (Tasks 1 & 2)
- Produces: client requests `?width=86` for book rows and `?width=160` for cover stacks and book detail page

- [ ] **Step 1: Update book-row cover request**

In `app/client/src/component/book-row/index.tsx`, change line 38:
```typescript
// before
? withTargetUser(`/api/books/${encodeURIComponent(book.id)}/cover?width=60`)

// after
? withTargetUser(`/api/books/${encodeURIComponent(book.id)}/cover?width=86`)
```

- [ ] **Step 2: Update cover-stack thumbnail width**

In `app/client/src/component/cover-stack/index.tsx`, change line 34:
```typescript
// before
thumbnailWidth={170}

// after
thumbnailWidth={160}
```

- [ ] **Step 3: Update book page cover request**

In `app/client/src/page/book/index.tsx`, change line 101:
```typescript
// before
? withTargetUser(`/api/books/${encodeURIComponent(book.id)}/cover?width=170`)

// after
? withTargetUser(`/api/books/${encodeURIComponent(book.id)}/cover?width=160`)
```

- [ ] **Step 4: Run client tests + lint**

```bash
npm test -w app/client && npm run lint -w app/client
```

Expected: all tests pass. The `cover/index.test.tsx` test that checks `?width=170` uses a hardcoded prop value — it is testing the Cover component's URL-building behaviour (not production width values) so no update is needed.

- [ ] **Step 5: Commit**

```bash
git add app/client/src/component/book-row/index.tsx \
        app/client/src/component/cover-stack/index.tsx \
        app/client/src/page/book/index.tsx
git commit -m "feat: update client cover requests to 86px and 160px thumbnails"
```
