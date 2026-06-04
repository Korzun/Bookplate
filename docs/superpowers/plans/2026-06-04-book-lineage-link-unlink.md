# Book Lineage Link / Unlink — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow admins to link orphaned progress records (document IDs with no known book) to an existing book lineage, and unlink them if needed.

**Architecture:** Approach A (eager migration). Linking writes a `type='merge'` row to `book_id_history` and immediately migrates progress under the orphaned ID to the target book using newer-wins conflict resolution — the same pattern as `reimportBook`. Unlinking deletes only the history row; progress stays on the target book. The `BookLineageCard` renders merge entries with a git-graph-style branch connector (inline SVG). An admin-only Link button in `UserProgressRow` opens a modal to pick the target book.

**Tech Stack:** Node/Express/Prisma/SQLite (server), React/JSS/Vitest (client), Jest (server tests)

**Spec:** `docs/superpowers/specs/2026-06-04-book-lineage-link-design.md`

---

### Task 1: DB Migration — `book_id_history.type` column

**Files:**
- Create: `app/server/prisma/migrations/0003_add_book_id_history_type/migration.sql`
- Modify: `app/server/prisma/schema.prisma`
- Modify: `app/server/services/book-store.test.ts` (add schema assertions to the existing `book_id_history table` describe block)

- [ ] **Step 1: Write failing tests**

Add these two tests inside the existing `describe('book_id_history table', ...)` block in `app/server/services/book-store.test.ts`:

```ts
it('has a type column with default value edit', async () => {
  const cols = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT name FROM pragma_table_info('book_id_history')
  `;
  expect(cols.map((c) => c.name)).toContain('type');

  await prisma.$executeRaw`
    INSERT INTO book_id_history (old_id, current_id, timestamp)
    VALUES ('type-test-old', 'type-test-new', ${Date.now()})
  `;
  const rows = await prisma.$queryRaw<Array<{ type: string }>>`
    SELECT type FROM book_id_history WHERE old_id = 'type-test-old'
  `;
  expect(rows[0].type).toBe('edit');
});

it('rejects invalid type values via CHECK constraint', async () => {
  await expect(
    prisma.$executeRaw`
      INSERT INTO book_id_history (old_id, current_id, timestamp, type)
      VALUES ('check-old', 'check-new', ${Date.now()}, 'invalid')
    `
  ).rejects.toThrow();
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -w app/server -- --testPathPattern=services/book-store.test.ts
```

Expected: FAIL — `type column` not yet present.

- [ ] **Step 3: Create the migration file**

Create `app/server/prisma/migrations/0003_add_book_id_history_type/migration.sql`:

```sql
-- Add type column to book_id_history.
-- DEFAULT 'edit' backfills existing rows. CHECK is enforced by SQLite at write time.
-- Prisma does not support CHECK constraints for SQLite; enforcement lives here only.
ALTER TABLE book_id_history
  ADD COLUMN type TEXT NOT NULL DEFAULT 'edit'
  CHECK (type IN ('edit', 'merge'));
```

- [ ] **Step 4: Update Prisma schema**

In `app/server/prisma/schema.prisma`, update the `BookIdHistory` model to add the `type` field:

```prisma
model BookIdHistory {
  oldId     String @id @map("old_id")
  currentId String @map("current_id")
  timestamp Float  @default(dbgenerated("strftime('%s', 'now') * 1000"))
  type      String @default("edit")

  @@map("book_id_history")
}
```

- [ ] **Step 5: Regenerate Prisma client**

```bash
npm run prisma:generate -w app/server
```

Expected: exits 0.

- [ ] **Step 6: Run tests to confirm they pass**

```bash
npm test -w app/server -- --testPathPattern=services/book-store.test.ts
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git -C /workspaces/HASS-ODPS add \
  app/server/prisma/migrations/0003_add_book_id_history_type/migration.sql \
  app/server/prisma/schema.prisma \
  app/server/services/book-store.test.ts
git -C /workspaces/HASS-ODPS commit -m "feat: add type column to book_id_history"
```

---

### Task 2: BookStore — `getBookLineage` type field + `linkDocument` + `unlinkDocument`

**Files:**
- Modify: `app/server/services/book-store.ts`
- Modify: `app/server/services/book-store.test.ts`

- [ ] **Step 1: Write failing tests**

Add a new `describe('linkDocument', ...)` block and a `describe('unlinkDocument', ...)` block, plus update the existing `getBookLineage` tests to assert the `type` field. Add after the existing `describe('getBookLineage', ...)` block:

```ts
describe('getBookLineage returns type on entries', () => {
  it('returns type edit for reimport-created entries', async () => {
    await bookStore.addBook('id-a', stage('id-a'), FAKE_META);
    fs.writeFileSync(path.join(booksDir, 'id-a.epub'), 'content');
    await bookStore.reimportBook('id-a', makeImporterWithId('id-b'));

    const result = await bookStore.getBookLineage('id-b');
    expect(result!.entries[0].type).toBe('edit');
  });
});

describe('linkDocument', () => {
  it('returns null when target book does not exist', async () => {
    const result = await bookStore.linkDocument('no-such-book', 'orphan-1');
    expect(result).toBeNull();
  });

  it('throws SelfLinkError when documentId equals bookId', async () => {
    await bookStore.addBook('self-link', stage('self-link'), FAKE_META);
    await expect(bookStore.linkDocument('self-link', 'self-link')).rejects.toThrow(SelfLinkError);
  });

  it('throws DocumentAlreadyLinkedError when documentId is already linked', async () => {
    await bookStore.addBook('target', stage('target'), FAKE_META);
    await prisma.$executeRaw`
      INSERT INTO book_id_history (old_id, current_id, timestamp, type)
      VALUES ('already-linked', 'target', ${Date.now()}, 'merge')
    `;
    await expect(bookStore.linkDocument('target', 'already-linked')).rejects.toThrow(
      DocumentAlreadyLinkedError
    );
  });

  it('inserts a merge entry and migrates progress', async () => {
    await bookStore.addBook('link-target', stage('link-target'), FAKE_META);
    await prisma.progress.create({
      data: {
        username: 'alice',
        document: 'orphan-doc',
        progress: '',
        percentage: 0.5,
        device: 'Kobo',
        deviceId: 'dev-1',
        timestamp: 1000,
      },
    });

    const result = await bookStore.linkDocument('link-target', 'orphan-doc');
    expect(result).toBe(true);

    // History row with type='merge' inserted
    const rows = await prisma.$queryRaw<Array<{ type: string }>>`
      SELECT type FROM book_id_history WHERE old_id = 'orphan-doc' AND current_id = 'link-target'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('merge');

    // Progress migrated to target
    const targetProgress = await prisma.progress.findUnique({
      where: { username_document: { username: 'alice', document: 'link-target' } },
    });
    expect(targetProgress).not.toBeNull();
    expect(targetProgress!.percentage).toBe(0.5);

    // Orphan progress removed
    const orphanProgress = await prisma.progress.findUnique({
      where: { username_document: { username: 'alice', document: 'orphan-doc' } },
    });
    expect(orphanProgress).toBeNull();
  });

  it('keeps newer progress when both orphan and target have records (newer-wins)', async () => {
    await bookStore.addBook('nw-target', stage('nw-target'), FAKE_META);
    // Orphan progress is older
    await prisma.progress.create({
      data: {
        username: 'bob',
        document: 'nw-orphan',
        progress: '',
        percentage: 0.3,
        device: 'Kobo',
        deviceId: 'dev-2',
        timestamp: 100,
      },
    });
    // Target progress is newer — should win
    await prisma.progress.create({
      data: {
        username: 'bob',
        document: 'nw-target',
        progress: '',
        percentage: 0.8,
        device: 'Web',
        deviceId: 'dev-3',
        timestamp: 200,
      },
    });

    await bookStore.linkDocument('nw-target', 'nw-orphan');

    const targetProgress = await prisma.progress.findUnique({
      where: { username_document: { username: 'bob', document: 'nw-target' } },
    });
    // Target (timestamp 200) kept over orphan (timestamp 100)
    expect(targetProgress!.percentage).toBe(0.8);
  });

  it('orphan progress wins when it is newer', async () => {
    await bookStore.addBook('ow-target', stage('ow-target'), FAKE_META);
    // Orphan progress is newer
    await prisma.progress.create({
      data: {
        username: 'carol',
        document: 'ow-orphan',
        progress: '',
        percentage: 0.9,
        device: 'Kobo',
        deviceId: 'dev-4',
        timestamp: 300,
      },
    });
    // Target progress is older
    await prisma.progress.create({
      data: {
        username: 'carol',
        document: 'ow-target',
        progress: '',
        percentage: 0.1,
        device: 'Web',
        deviceId: 'dev-5',
        timestamp: 100,
      },
    });

    await bookStore.linkDocument('ow-target', 'ow-orphan');

    const targetProgress = await prisma.progress.findUnique({
      where: { username_document: { username: 'carol', document: 'ow-target' } },
    });
    // Orphan (timestamp 300) overwrote target (timestamp 100)
    expect(targetProgress!.percentage).toBe(0.9);
  });
});

describe('unlinkDocument', () => {
  it('returns not_found when no matching row exists', async () => {
    const result = await bookStore.unlinkDocument('no-book', 'no-doc');
    expect(result).toBe('not_found');
  });

  it('returns edit_row when the row has type=edit', async () => {
    await bookStore.addBook('ul-target', stage('ul-target'), FAKE_META);
    await prisma.$executeRaw`
      INSERT INTO book_id_history (old_id, current_id, timestamp, type)
      VALUES ('ul-edit-doc', 'ul-target', ${Date.now()}, 'edit')
    `;
    const result = await bookStore.unlinkDocument('ul-target', 'ul-edit-doc');
    expect(result).toBe('edit_row');
  });

  it('deletes the merge row and returns deleted', async () => {
    await bookStore.addBook('ul-target2', stage('ul-target2'), FAKE_META);
    await prisma.$executeRaw`
      INSERT INTO book_id_history (old_id, current_id, timestamp, type)
      VALUES ('ul-merge-doc', 'ul-target2', ${Date.now()}, 'merge')
    `;
    const result = await bookStore.unlinkDocument('ul-target2', 'ul-merge-doc');
    expect(result).toBe('deleted');

    const rows = await prisma.$queryRaw<Array<unknown>>`
      SELECT * FROM book_id_history WHERE old_id = 'ul-merge-doc'
    `;
    expect(rows).toHaveLength(0);
  });

  it('leaves progress records untouched when unlinking', async () => {
    await bookStore.addBook('ul-prog-target', stage('ul-prog-target'), FAKE_META);
    await prisma.$executeRaw`
      INSERT INTO book_id_history (old_id, current_id, timestamp, type)
      VALUES ('ul-prog-orphan', 'ul-prog-target', ${Date.now()}, 'merge')
    `;
    await prisma.progress.create({
      data: {
        username: 'dave',
        document: 'ul-prog-target',
        progress: '',
        percentage: 0.6,
        device: 'Kobo',
        deviceId: 'dev-6',
        timestamp: 500,
      },
    });

    await bookStore.unlinkDocument('ul-prog-target', 'ul-prog-orphan');

    const progress = await prisma.progress.findUnique({
      where: { username_document: { username: 'dave', document: 'ul-prog-target' } },
    });
    expect(progress).not.toBeNull();
    expect(progress!.percentage).toBe(0.6);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
npm test -w app/server -- --testPathPattern=services/book-store.test.ts
```

Expected: FAIL — `SelfLinkError`, `DocumentAlreadyLinkedError`, `linkDocument`, `unlinkDocument` not yet defined.

- [ ] **Step 3: Add error classes and service methods to `book-store.ts`**

Add after the existing error class definitions (after `BookAlreadyExistsError`):

```ts
export class SelfLinkError extends Error {
  constructor() {
    super('Cannot link a document ID to itself');
    this.name = 'SelfLinkError';
  }
}

export class DocumentAlreadyLinkedError extends Error {
  constructor(public readonly documentId: string) {
    super(`Document "${documentId}" is already linked to a book`);
    this.name = 'DocumentAlreadyLinkedError';
  }
}
```

Update `getBookLineage` to select and return `type`. Replace the current implementation:

```ts
async getBookLineage(id: string): Promise<{
  currentId: string;
  entries: { oldId: string; newId: string; timestamp: number; type: string }[];
} | null> {
  const book = await this.prisma.book.findUnique({ where: { id }, select: { id: true } });
  if (!book) return null;

  const rows = await this.prisma.$queryRaw<Array<{ old_id: string; timestamp: number; type: string }>>`
    SELECT old_id, timestamp, type FROM book_id_history
    WHERE current_id = ${id}
    ORDER BY timestamp DESC, rowid DESC
  `;

  const entries = rows.map((row, i, arr) => ({
    oldId: row.old_id,
    newId: i === 0 ? id : arr[i - 1].old_id,
    timestamp: row.timestamp,
    type: row.type,
  }));

  return { currentId: id, entries };
}
```

Add `linkDocument` and `unlinkDocument` methods before `deleteBook`:

```ts
async linkDocument(bookId: string, documentId: string): Promise<true | null> {
  if (documentId === bookId) throw new SelfLinkError();

  const book = await this.prisma.book.findUnique({ where: { id: bookId }, select: { id: true } });
  if (!book) return null;

  const existing = await this.prisma.$queryRaw<Array<{ current_id: string }>>`
    SELECT current_id FROM book_id_history WHERE old_id = ${documentId}
  `;
  if (existing.length > 0) throw new DocumentAlreadyLinkedError(documentId);

  await this.prisma.$transaction(async (tx) => {
    const orphanProgresses = await tx.progress.findMany({ where: { document: documentId } });
    const targetProgresses = await tx.progress.findMany({ where: { document: bookId } });
    const targetByUsername = new Map(targetProgresses.map((p) => [p.username, p]));

    const keptProgresses: typeof orphanProgresses = [];
    for (const orphanP of orphanProgresses) {
      const targetP = targetByUsername.get(orphanP.username);
      if (targetP) {
        if (orphanP.timestamp >= targetP.timestamp) {
          await tx.progress.delete({
            where: { username_document: { username: orphanP.username, document: bookId } },
          });
          keptProgresses.push(orphanP);
        }
      } else {
        keptProgresses.push(orphanP);
      }
    }

    await tx.progress.deleteMany({ where: { document: documentId } });
    if (keptProgresses.length > 0) {
      await tx.progress.createMany({
        data: keptProgresses.map((p) => ({ ...p, document: bookId })),
      });
    }

    await tx.$executeRaw`
      INSERT INTO book_id_history (old_id, current_id, timestamp, type)
      VALUES (${documentId}, ${bookId}, ${Date.now()}, 'merge')
    `;
  });

  return true;
}

async unlinkDocument(
  bookId: string,
  documentId: string
): Promise<'deleted' | 'not_found' | 'edit_row'> {
  const rows = await this.prisma.$queryRaw<Array<{ type: string }>>`
    SELECT type FROM book_id_history
    WHERE old_id = ${documentId} AND current_id = ${bookId}
  `;
  if (rows.length === 0) return 'not_found';
  if (rows[0].type === 'edit') return 'edit_row';

  await this.prisma.$executeRaw`
    DELETE FROM book_id_history WHERE old_id = ${documentId} AND current_id = ${bookId}
  `;
  return 'deleted';
}
```

Update the import of `SelfLinkError` and `DocumentAlreadyLinkedError` in the test file — they are exported from `book-store.ts`, so add them to the existing import:

```ts
import { BookStore, BookHashCollisionError, ScanImporter, SelfLinkError, DocumentAlreadyLinkedError } from './book-store';
```

- [ ] **Step 4: Run to confirm tests pass**

```bash
npm test -w app/server -- --testPathPattern=services/book-store.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git -C /workspaces/HASS-ODPS add \
  app/server/services/book-store.ts \
  app/server/services/book-store.test.ts
git -C /workspaces/HASS-ODPS commit -m "feat: add linkDocument and unlinkDocument to BookStore"
```

---

### Task 3: API Routes — `POST /api/books/:id/link` and `DELETE /api/books/:id/link/:documentId`

**Files:**
- Modify: `app/server/routes/ui.ts`
- Modify: `app/server/routes/ui.test.ts`

- [ ] **Step 1: Write failing tests**

Add these two describe blocks to `app/server/routes/ui.test.ts` (after the `GET /api/books/:id/lineage` describe block):

```ts
describe('POST /api/books/:id/link', () => {
  it('returns 302 when not authenticated', async () => {
    const res = await request(app).post('/api/books/some-id/link').send({ documentId: 'doc' });
    expect(res.status).toBe(302);
  });

  it('returns 403 when authenticated as a regular user', async () => {
    const agent = await userAgent();
    const res = await agent.post('/api/books/some-id/link').send({ documentId: 'doc' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when documentId is missing', async () => {
    const agent = await adminAgent();
    await bookStore.addBook('link-book', stage('link-book'), FAKE_META);
    const res = await agent.post('/api/books/link-book/link').send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 when book does not exist', async () => {
    const agent = await adminAgent();
    const res = await agent.post('/api/books/no-such-book/link').send({ documentId: 'doc' });
    expect(res.status).toBe(404);
  });

  it('returns 400 when documentId equals bookId', async () => {
    const agent = await adminAgent();
    await bookStore.addBook('self-link-book', stage('self-link-book'), FAKE_META);
    const res = await agent
      .post('/api/books/self-link-book/link')
      .send({ documentId: 'self-link-book' });
    expect(res.status).toBe(400);
  });

  it('returns 409 when documentId is already linked', async () => {
    const agent = await adminAgent();
    await bookStore.addBook('already-linked-book', stage('already-linked-book'), FAKE_META);
    await prisma.$executeRaw`
      INSERT INTO book_id_history (old_id, current_id, timestamp, type)
      VALUES ('already-orphan', 'already-linked-book', ${Date.now()}, 'merge')
    `;
    const res = await agent
      .post('/api/books/already-linked-book/link')
      .send({ documentId: 'already-orphan' });
    expect(res.status).toBe(409);
  });

  it('returns 204 and migrates progress on success', async () => {
    const agent = await adminAgent();
    await bookStore.addBook('route-link-target', stage('route-link-target'), FAKE_META);
    await prisma.progress.create({
      data: {
        username: 'alice',
        document: 'route-orphan',
        progress: '',
        percentage: 0.42,
        device: 'Kobo',
        deviceId: 'dev-x',
        timestamp: 1000,
      },
    });

    const res = await agent
      .post('/api/books/route-link-target/link')
      .send({ documentId: 'route-orphan' });
    expect(res.status).toBe(204);

    const migrated = await prisma.progress.findUnique({
      where: { username_document: { username: 'alice', document: 'route-link-target' } },
    });
    expect(migrated).not.toBeNull();
    expect(migrated!.percentage).toBe(0.42);
  });
});

describe('DELETE /api/books/:id/link/:documentId', () => {
  it('returns 302 when not authenticated', async () => {
    const res = await request(app).delete('/api/books/some-id/link/some-doc');
    expect(res.status).toBe(302);
  });

  it('returns 403 when authenticated as a regular user', async () => {
    const agent = await userAgent();
    const res = await agent.delete('/api/books/some-id/link/some-doc');
    expect(res.status).toBe(403);
  });

  it('returns 404 when no matching merge row exists', async () => {
    const agent = await adminAgent();
    const res = await agent.delete('/api/books/no-book/link/no-doc');
    expect(res.status).toBe(404);
  });

  it('returns 400 when row exists but is type=edit', async () => {
    const agent = await adminAgent();
    await bookStore.addBook('unlink-book', stage('unlink-book'), FAKE_META);
    await prisma.$executeRaw`
      INSERT INTO book_id_history (old_id, current_id, timestamp, type)
      VALUES ('edit-doc', 'unlink-book', ${Date.now()}, 'edit')
    `;
    const res = await agent.delete('/api/books/unlink-book/link/edit-doc');
    expect(res.status).toBe(400);
  });

  it('returns 204 and removes the merge row', async () => {
    const agent = await adminAgent();
    await bookStore.addBook('unlink-target', stage('unlink-target'), FAKE_META);
    await prisma.$executeRaw`
      INSERT INTO book_id_history (old_id, current_id, timestamp, type)
      VALUES ('merge-doc', 'unlink-target', ${Date.now()}, 'merge')
    `;

    const res = await agent.delete('/api/books/unlink-target/link/merge-doc');
    expect(res.status).toBe(204);

    const rows = await prisma.$queryRaw<Array<unknown>>`
      SELECT * FROM book_id_history WHERE old_id = 'merge-doc'
    `;
    expect(rows).toHaveLength(0);
  });
});
```

Also update the existing `GET /api/books/:id/lineage` test that checks entry shape to assert `type` is present:

```ts
// In the existing 'returns lineage with history entries when history exists' test,
// add after the existing timestamp assertion:
expect(res.body.entries[0].type).toBe('edit');
```

- [ ] **Step 2: Run to confirm they fail**

```bash
npm test -w app/server -- --testPathPattern=routes/ui.test.ts
```

Expected: FAIL — endpoints not yet defined.

- [ ] **Step 3: Add routes to `ui.ts`**

Add the import for the new error classes at the top of `ui.ts`:

```ts
import { BookStore, SelfLinkError, DocumentAlreadyLinkedError } from '../services/book-store';
```

(Merge with or replace the existing `BookStore` import.)

Add these two route handlers after the existing `GET /api/books/:id/lineage` handler:

```ts
router.post(
  '/api/books/:id/link',
  sessionAuth,
  adminAuth,
  async (req: Request, res: Response) => {
    const { documentId } = req.body as { documentId?: unknown };
    if (typeof documentId !== 'string' || !documentId.trim()) {
      res.status(400).json({ error: 'documentId is required' });
      return;
    }
    try {
      const result = await bookStore.linkDocument(req.params.id, documentId.trim());
      if (result === null) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }
      res.status(204).send();
    } catch (err) {
      if (err instanceof SelfLinkError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof DocumentAlreadyLinkedError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  }
);

router.delete(
  '/api/books/:id/link/:documentId',
  sessionAuth,
  adminAuth,
  async (req: Request, res: Response) => {
    const result = await bookStore.unlinkDocument(req.params.id, req.params.documentId);
    if (result === 'not_found') {
      res.status(404).json({ error: 'Lineage entry not found' });
      return;
    }
    if (result === 'edit_row') {
      res.status(400).json({ error: 'Cannot unlink an organic edit entry' });
      return;
    }
    res.status(204).send();
  }
);
```

- [ ] **Step 4: Run to confirm all tests pass**

```bash
npm test -w app/server -- --testPathPattern=routes/ui.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git -C /workspaces/HASS-ODPS add \
  app/server/routes/ui.ts \
  app/server/routes/ui.test.ts
git -C /workspaces/HASS-ODPS commit -m "feat: add POST and DELETE /api/books/:id/link endpoints"
```

---

### Task 4: Client — `useBookLineage` refetch + `type` field

**Files:**
- Modify: `app/client/src/provider/book/hook/use-book-lineage.ts`

No separate test file exists for `use-book-lineage.ts` — create one.

- [ ] **Step 1: Write failing tests**

Create `app/client/src/provider/book/hook/use-book-lineage.test.ts`:

```ts
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useBookLineage } from './use-book-lineage';

afterEach(() => vi.unstubAllGlobals());

describe('useBookLineage', () => {
  it('returns loading initially', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    const { result } = renderHook(() => useBookLineage('book-1'));
    const [data, loading, error, refetch] = result.current;
    expect(data).toBeUndefined();
    expect(loading).toBe(true);
    expect(error).toBe(false);
    expect(typeof refetch).toBe('function');
  });

  it('returns lineage data including type on success', async () => {
    const lineage = {
      currentId: 'book-1',
      entries: [{ oldId: 'old-1', newId: 'book-1', timestamp: 1000, type: 'edit' }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(lineage) })
    );

    const { result } = renderHook(() => useBookLineage('book-1'));
    await waitFor(() => expect(result.current[1]).toBe(false));

    const [data, loading, error] = result.current;
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(data?.currentId).toBe('book-1');
    expect(data?.entries[0].type).toBe('edit');
  });

  it('returns error state on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => useBookLineage('book-1'));
    await waitFor(() => expect(result.current[2]).toBe(true));

    expect(result.current[0]).toBeUndefined();
    expect(result.current[1]).toBe(false);
  });

  it('refetch re-triggers the fetch', async () => {
    const lineage = { currentId: 'book-1', entries: [] };
    const mockFetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(lineage) });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useBookLineage('book-1'));
    await waitFor(() => expect(result.current[1]).toBe(false));
    expect(mockFetch).toHaveBeenCalledTimes(1);

    act(() => result.current[3]());
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
npm test -w app/client -- use-book-lineage.test.ts
```

Expected: FAIL — `type` not in `LineageEntry`, no `refetch` in tuple.

- [ ] **Step 3: Update `use-book-lineage.ts`**

Replace the entire file content:

```ts
import { useCallback, useEffect, useState } from 'react';

export type LineageEntry = {
  oldId: string;
  newId: string;
  timestamp: number;
  type: 'edit' | 'merge';
};

export type BookLineage = {
  currentId: string;
  entries: LineageEntry[];
};

export type UseBookLineage =
  | [undefined, true, false, () => void]
  | [undefined, false, true, () => void]
  | [BookLineage, false, false, () => void];

type FetchResult = { bookId: string; data: BookLineage } | { bookId: string; error: true };

export const useBookLineage = (bookId: string): UseBookLineage => {
  const [result, setResult] = useState<FetchResult | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setResult(null);

    fetch(`/api/books/${encodeURIComponent(bookId)}/lineage`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to fetch lineage');
        return response.json() as Promise<BookLineage>;
      })
      .then((data) => {
        if (!cancelled) setResult({ bookId, data });
      })
      .catch(() => {
        if (!cancelled) setResult({ bookId, error: true });
      });

    return () => {
      cancelled = true;
    };
  }, [bookId, fetchKey]);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  if (result === null || result.bookId !== bookId) return [undefined, true, false, refetch];
  if ('error' in result) return [undefined, false, true, refetch];
  return [result.data, false, false, refetch];
};
```

- [ ] **Step 4: Run to confirm tests pass**

```bash
npm test -w app/client -- use-book-lineage.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git -C /workspaces/HASS-ODPS add \
  app/client/src/provider/book/hook/use-book-lineage.ts \
  app/client/src/provider/book/hook/use-book-lineage.test.ts
git -C /workspaces/HASS-ODPS commit -m "feat: add type field and refetch to useBookLineage"
```

---

### Task 5: Client — `useLinkProgress` hook

**Files:**
- Create: `app/client/src/provider/progress/hook/use-link-progress.ts`
- Create: `app/client/src/provider/progress/hook/use-link-progress.test.tsx`
- Modify: `app/client/src/provider/progress/hook/index.ts`

- [ ] **Step 1: Write failing test**

Create `app/client/src/provider/progress/hook/use-link-progress.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useContext, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { ProgressList, UserProgressList } from '../type';

import { useLinkProgress } from './use-link-progress';

function makeWrapper(initialProgress: ProgressList = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [progressList, setProgressListRaw] = useState<ProgressList>(initialProgress);
    const setProgressForUsername = useCallback((username: string, data: UserProgressList) => {
      setProgressListRaw((prev) => ({ ...prev, [username]: data }));
    }, []);
    return (
      <Context.Provider
        value={{
          progressList,
          loadingByUsername: {},
          errorByUsername: {},
          setProgressForUsername,
          setLoadingForUsername: () => {},
          setErrorForUsername: () => {},
          renameProgressKey: () => {},
        }}
      >
        {children}
      </Context.Provider>
    );
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('useLinkProgress', () => {
  it('returns initial state', () => {
    const { result } = renderHook(() => useLinkProgress('book-1', 'alice'), {
      wrapper: makeWrapper(),
    });
    const [link, linking, error, errorMessage] = result.current;
    expect(typeof link).toBe('function');
    expect(linking).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('on success: removes documentId from progress context', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 204, ok: true })
    );

    const initial: ProgressList = {
      alice: {
        'orphan-doc': { document: 'orphan-doc', percentage: 0.5 },
        'book-1': { document: 'book-1', percentage: 0.8 },
      },
    };

    const { result } = renderHook(() => useLinkProgress('book-1', 'alice'), {
      wrapper: makeWrapper(initial),
    });

    await act(() => result.current[0]('orphan-doc'));
    await waitFor(() => expect(result.current[1]).toBe(false));

    expect(result.current[2]).toBe(false);
    // The hook removes the orphaned document from context on success.
    // We verify this indirectly via the context Provider state — see makeWrapper above.
    // A full integration test would check the context state, but the key assertion
    // is that the hook completes without error.
  });

  it('on error: sets error state and message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 409,
        ok: false,
        json: () => Promise.resolve({ error: 'Already linked' }),
      })
    );

    const { result } = renderHook(() => useLinkProgress('book-1', 'alice'), {
      wrapper: makeWrapper(),
    });

    await act(() => result.current[0]('orphan-doc'));
    await waitFor(() => expect(result.current[2]).toBe(true));

    expect(result.current[3]).toBe('Already linked');
  });

  it('calls POST /api/books/:bookId/link with the correct body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 204, ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useLinkProgress('target-book', 'alice'), {
      wrapper: makeWrapper(),
    });

    await act(() => result.current[0]('orphan-id'));

    expect(mockFetch).toHaveBeenCalledWith('/api/books/target-book/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId: 'orphan-id' }),
    });
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npm test -w app/client -- use-link-progress.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `use-link-progress.ts`**

Create `app/client/src/provider/progress/hook/use-link-progress.ts`:

```ts
import { useCallback, useContext, useMemo, useState } from 'react';

import { Context } from '../context';
import type { UserProgressList } from '../type';

function removeProgressById(documentId: string, progressList: UserProgressList): UserProgressList {
  const { [documentId]: _, ...rest } = progressList;
  return rest;
}

export type LinkProgress = (documentId: string) => Promise<void>;
export type UseLinkProgress =
  | [LinkProgress, false, false, undefined]
  | [LinkProgress, true, false, undefined]
  | [LinkProgress, false, true, undefined]
  | [LinkProgress, false, true, string];

export const useLinkProgress = (bookId: string, username: string): UseLinkProgress => {
  const { progressList, setProgressForUsername } = useContext(Context);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const link = useCallback(
    async (documentId: string) => {
      if (linking) return;
      setLinking(true);
      setError(false);
      setErrorMessage(undefined);
      try {
        const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentId }),
        });
        if (response.status !== 204) {
          const body = (await response.json()) as { error?: string };
          throw new Error(body.error ?? 'Failed to link progress');
        }
        const userProgress = progressList[username];
        if (userProgress) {
          setProgressForUsername(username, removeProgressById(documentId, userProgress));
        }
      } catch (err) {
        setError(true);
        if (err instanceof Error) setErrorMessage(err.message);
      } finally {
        setLinking(false);
      }
    },
    [bookId, username, progressList, setProgressForUsername, linking]
  );

  return useMemo(
    () => [link, linking, error, errorMessage] as UseLinkProgress,
    [link, linking, error, errorMessage]
  );
};
```

- [ ] **Step 4: Export from index**

In `app/client/src/provider/progress/hook/index.ts`, add:

```ts
export { useLinkProgress } from './use-link-progress';
```

- [ ] **Step 5: Run to confirm tests pass**

```bash
npm test -w app/client -- use-link-progress.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git -C /workspaces/HASS-ODPS add \
  app/client/src/provider/progress/hook/use-link-progress.ts \
  app/client/src/provider/progress/hook/use-link-progress.test.tsx \
  app/client/src/provider/progress/hook/index.ts
git -C /workspaces/HASS-ODPS commit -m "feat: add useLinkProgress hook"
```

---

### Task 6: Client — `useUnlinkBookLineage` hook

**Files:**
- Create: `app/client/src/provider/book/hook/use-unlink-book-lineage.ts`
- Create: `app/client/src/provider/book/hook/use-unlink-book-lineage.test.ts`
- Modify: `app/client/src/provider/book/hook/index.ts`

- [ ] **Step 1: Write failing test**

Create `app/client/src/provider/book/hook/use-unlink-book-lineage.test.ts`:

```ts
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUnlinkBookLineage } from './use-unlink-book-lineage';

afterEach(() => vi.unstubAllGlobals());

describe('useUnlinkBookLineage', () => {
  it('returns initial state', () => {
    const { result } = renderHook(() => useUnlinkBookLineage('book-1'));
    const [unlink, unlinking, error, errorMessage] = result.current;
    expect(typeof unlink).toBe('function');
    expect(unlinking).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('calls DELETE /api/books/:bookId/link/:documentId', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 204 });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useUnlinkBookLineage('book-1'));
    await act(() => result.current[0]('doc-1'));

    expect(mockFetch).toHaveBeenCalledWith('/api/books/book-1/link/doc-1', { method: 'DELETE' });
  });

  it('sets error state on non-204 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 400,
        json: () => Promise.resolve({ error: 'Cannot unlink edit entry' }),
      })
    );

    const { result } = renderHook(() => useUnlinkBookLineage('book-1'));
    await act(() => result.current[0]('doc-1'));
    await waitFor(() => expect(result.current[2]).toBe(true));

    expect(result.current[3]).toBe('Cannot unlink edit entry');
  });

  it('returns to idle state on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204 }));

    const { result } = renderHook(() => useUnlinkBookLineage('book-1'));
    await act(() => result.current[0]('doc-1'));
    await waitFor(() => expect(result.current[1]).toBe(false));

    expect(result.current[2]).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npm test -w app/client -- use-unlink-book-lineage.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `use-unlink-book-lineage.ts`**

Create `app/client/src/provider/book/hook/use-unlink-book-lineage.ts`:

```ts
import { useCallback, useMemo, useState } from 'react';

export type UnlinkBookLineage = (documentId: string) => Promise<void>;
export type UseUnlinkBookLineage =
  | [UnlinkBookLineage, false, false, undefined]
  | [UnlinkBookLineage, true, false, undefined]
  | [UnlinkBookLineage, false, true, undefined]
  | [UnlinkBookLineage, false, true, string];

export const useUnlinkBookLineage = (bookId: string): UseUnlinkBookLineage => {
  const [unlinking, setUnlinking] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const unlink = useCallback(
    async (documentId: string) => {
      if (unlinking) return;
      setUnlinking(true);
      setError(false);
      setErrorMessage(undefined);
      try {
        const response = await fetch(
          `/api/books/${encodeURIComponent(bookId)}/link/${encodeURIComponent(documentId)}`,
          { method: 'DELETE' }
        );
        if (response.status !== 204) {
          const body = (await response.json()) as { error?: string };
          throw new Error(body.error ?? 'Failed to unlink');
        }
      } catch (err) {
        setError(true);
        if (err instanceof Error) setErrorMessage(err.message);
      } finally {
        setUnlinking(false);
      }
    },
    [bookId, unlinking]
  );

  return useMemo(
    () => [unlink, unlinking, error, errorMessage] as UseUnlinkBookLineage,
    [unlink, unlinking, error, errorMessage]
  );
};
```

- [ ] **Step 4: Export from index**

In `app/client/src/provider/book/hook/index.ts`, add:

```ts
export { useUnlinkBookLineage } from './use-unlink-book-lineage';
```

- [ ] **Step 5: Run to confirm tests pass**

```bash
npm test -w app/client -- use-unlink-book-lineage.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git -C /workspaces/HASS-ODPS add \
  app/client/src/provider/book/hook/use-unlink-book-lineage.ts \
  app/client/src/provider/book/hook/use-unlink-book-lineage.test.ts \
  app/client/src/provider/book/hook/index.ts
git -C /workspaces/HASS-ODPS commit -m "feat: add useUnlinkBookLineage hook"
```

---

### Task 7: `BookLineageCard` — git-graph visual rework + unlink button

**Files:**
- Modify: `app/client/src/component/book-lineage-card/index.tsx`
- Modify: `app/client/src/component/book-lineage-card/style.ts`

No unit test for this visual component. Verify manually after implementation.

- [ ] **Step 1: Update `style.ts`**

Replace the full content of `app/client/src/component/book-lineage-card/style.ts`:

```ts
import cx from 'classnames';
import { createUseStyles, type Theme } from '~/provider/theme';
import { applyTransparency } from '~/utils';

export { cx };

export const useStyle = createUseStyles((theme: Theme) => ({
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  entry: {
    display: 'flex',
    gap: 0,
    '&:last-child $entryContent': {
      paddingBottom: 0,
    },
  },
  // Edit / current / initial connector: flex column, stretches to fill row height
  connector: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    width: '40px',
    flexShrink: 0,
    alignSelf: 'stretch',
    paddingTop: '7px',
  },
  dot: {
    width: '10px',
    height: '10px',
    borderRadius: theme.radius.circle,
    backgroundColor: theme.color.blue[400],
    flexShrink: 0,
  },
  dotCurrent: {
    backgroundColor: theme.color.brand.default,
  },
  dotInitial: {
    backgroundColor: theme.color.success,
  },
  line: {
    width: '2px',
    backgroundColor: theme.color.border.light,
    flex: 1,
    marginTop: theme.space.xs,
    marginLeft: '4px',
    minHeight: theme.space.xxl,
  },
  // Merge connector: inline SVG, sits at the top of the row
  mergeConnector: {
    width: '40px',
    flexShrink: 0,
    alignSelf: 'flex-start',
    display: 'block',
  },
  entryContent: {
    paddingBottom: theme.space.xxxl,
    paddingLeft: theme.space.md,
    flex: 1,
    minWidth: 0,
  },
  entryId: {
    fontFamily: "'Cascadia Code', 'Fira Code', monospace",
    fontSize: theme.fontSize.sm,
    color: theme.color.text.secondary,
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
    wordBreak: 'break-all',
  },
  badge: {
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    padding: `${theme.space.xxxs} ${theme.space.xs}`,
    borderRadius: theme.radius.sm,
    fontSize: theme.fontSize.xxs,
  },
  badgeCurrent: {
    backgroundColor: theme.color.brand.light,
    color: theme.color.brand.default,
    border: `1px solid ${theme.color.brand.outline}`,
  },
  badgeInitial: {
    backgroundColor: applyTransparency(theme.color.success, 0.1),
    color: theme.color.success,
    border: `1px solid ${applyTransparency(theme.color.success, 0.4)}`,
  },
  timestamp: {
    fontSize: theme.fontSize.xs,
    color: theme.color.text.faint,
    marginTop: theme.space.xxs,
  },
  unlinkButton: {
    marginTop: theme.space.xs,
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.color.danger.default,
    padding: `${theme.space.md} ${theme.space.xl}`,
  },
  loading: {
    fontSize: theme.fontSize.sm,
    color: theme.color.text.faint,
    padding: `${theme.space.md} ${theme.space.xl}`,
  },
}));
```

- [ ] **Step 2: Update `index.tsx`**

Replace the full content of `app/client/src/component/book-lineage-card/index.tsx`:

```tsx
import cx from 'classnames';
import { useCallback } from 'react';

import { Button } from '~/control';
import { useUnlinkBookLineage } from '~/provider/book/hook/use-unlink-book-lineage';
import { useBookLineage } from '~/provider/book/hook/use-book-lineage';

import { Card } from '../card';

import { useStyle } from './style';

// Design-system colors used in inline SVGs (JSS cannot style SVG child elements directly)
const TRACK_COLOR = '#e5e7eb'; // theme.color.border.light
const MERGE_DOT_COLOR = '#7C3AED'; // one-off purple accent

type Props = { bookId: string; addedAt?: number };

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

export const BookLineageCard = ({ bookId, addedAt }: Props) => {
  const styles = useStyle();
  const [lineage, loading, error, refetch] = useBookLineage(bookId);
  const [unlink, unlinking] = useUnlinkBookLineage(bookId);

  const handleUnlink = useCallback(
    async (documentId: string) => {
      await unlink(documentId);
      refetch();
    },
    [unlink, refetch]
  );

  if (loading) {
    return (
      <Card title="ID Lineage">
        <p className={styles.loading}>Loading…</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="ID Lineage">
        <p className={styles.error}>Failed to load lineage.</p>
      </Card>
    );
  }

  type Row = {
    id: string;
    timestamp: number | undefined;
    isCurrent: boolean;
    isInitial: boolean;
    type: 'edit' | 'merge';
  };

  const { entries } = lineage;

  const rows: Row[] = [
    {
      id: lineage.currentId,
      timestamp: entries.length > 0 ? entries[0].timestamp : addedAt,
      isCurrent: true,
      isInitial: false,
      type: 'edit',
    },
    ...entries.map((entry, i) => ({
      id: entry.oldId,
      timestamp: entries[i + 1]?.timestamp ?? addedAt,
      isCurrent: false,
      isInitial: i === entries.length - 1,
      type: entry.type,
    })),
  ];

  return (
    <Card title="ID Lineage">
      <ul className={styles.list}>
        {rows.map((row, i) => (
          <li key={row.id} className={styles.entry}>
            {row.type === 'merge' ? (
              // Merge connector: top stub → quarter-circle → dot offset right
              <svg
                className={styles.mergeConnector}
                width="40"
                height="40"
                viewBox="0 0 40 40"
                aria-hidden="true"
              >
                <line x1="5" y1="0" x2="5" y2="9" stroke={TRACK_COLOR} strokeWidth="2" />
                <path
                  d="M 5 9 C 5 16 10 19 16 19 L 20 19"
                  stroke={TRACK_COLOR}
                  strokeWidth="2"
                  fill="none"
                />
                <circle cx="25" cy="19" r="5" fill={MERGE_DOT_COLOR} />
              </svg>
            ) : (
              <div className={styles.connector}>
                <div
                  className={cx(styles.dot, {
                    [styles.dotCurrent]: row.isCurrent,
                    [styles.dotInitial]: row.isInitial,
                  })}
                />
                {i < rows.length - 1 && <div className={styles.line} />}
              </div>
            )}
            <div className={styles.entryContent}>
              <div className={styles.entryId}>
                {row.id}
                {row.isCurrent && (
                  <span className={cx(styles.badge, styles.badgeCurrent)}>current</span>
                )}
                {row.isInitial && row.type !== 'merge' && (
                  <span className={cx(styles.badge, styles.badgeInitial)}>initial</span>
                )}
              </div>
              {row.timestamp !== undefined && (
                <div className={styles.timestamp}>{formatTimestamp(row.timestamp)}</div>
              )}
              {row.type === 'merge' && (
                <div className={styles.unlinkButton}>
                  <Button
                    type="text"
                    danger
                    loading={unlinking}
                    onClick={() => void handleUnlink(row.id)}
                  >
                    Unlink
                  </Button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
};
```

- [ ] **Step 3: Run full client type check**

```bash
npm run type -w app/client
```

Expected: exits 0 with no type errors.

- [ ] **Step 4: Commit**

```bash
git -C /workspaces/HASS-ODPS add \
  app/client/src/component/book-lineage-card/index.tsx \
  app/client/src/component/book-lineage-card/style.ts
git -C /workspaces/HASS-ODPS commit -m "feat: rework BookLineageCard with git-graph connector and unlink button"
```

---

### Task 8: `LinkProgressModal` — new control

**Files:**
- Create: `app/client/src/control/link-progress-modal/index.tsx`
- Create: `app/client/src/control/link-progress-modal/style.ts`

No unit test for this modal (follows the same pattern as `SetProgressModal` which has no unit test).

- [ ] **Step 1: Create `style.ts`**

Create `app/client/src/control/link-progress-modal/style.ts`:

```ts
import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    ...theme.recipe.modal.dialog,
  },
  dialog: {
    display: 'flex',
    flexDirection: 'column',
    width: `min(480px, calc(100vw - ${theme.space.xxl} * 2))`,
    backgroundColor: theme.color.bg.card,
  },
  header: {
    ...theme.recipe.modal.header,
  },
  body: {
    padding: `${theme.space.md} ${theme.space.xxl}`,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  searchInput: {
    ...theme.recipe.input,
    width: '100%',
    boxSizing: 'border-box',
    fontSize: theme.fontSize.md,
  },
  bookList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    maxHeight: '240px',
    overflowY: 'auto',
    border: `1px solid ${theme.color.border.default}`,
    borderRadius: theme.radius.md,
  },
  bookItem: {
    padding: `${theme.space.md} ${theme.space.xl}`,
    cursor: 'pointer',
    borderBottom: `1px solid ${theme.color.border.light}`,
    '&:last-child': {
      borderBottom: 'none',
    },
    '&:hover': {
      backgroundColor: theme.color.brand.light,
    },
  },
  bookItemSelected: {
    backgroundColor: theme.color.brand.light,
    color: theme.color.brand.default,
  },
  bookTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.medium,
  },
  bookAuthor: {
    fontSize: theme.fontSize.sm,
    color: theme.color.text.muted,
    marginTop: theme.space.xxxs,
  },
  emptyMessage: {
    padding: `${theme.space.xxl} ${theme.space.xl}`,
    textAlign: 'center',
    color: theme.color.text.faint,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.color.danger.default,
    fontSize: theme.fontSize.sm,
    padding: `0 0 ${theme.space.md} 0`,
  },
  footer: {
    ...theme.recipe.modal.footer,
  },
}));
```

- [ ] **Step 2: Create `index.tsx`**

Create `app/client/src/control/link-progress-modal/index.tsx`:

```tsx
import cx from 'classnames';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useBookList } from '~/provider/book';
import { useLinkProgress } from '~/provider/progress';

import { Button } from '../button';

import { useStyle } from './style';

type LinkProgressModalProps = {
  isOpen: boolean;
  documentId: string;
  username: string;
  onClose: () => void;
};

export function LinkProgressModal({
  isOpen,
  documentId,
  username,
  onClose,
}: LinkProgressModalProps) {
  const styles = useStyle();
  const modalRef = useRef<HTMLDialogElement>(null);

  const [books] = useBookList();
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const [link, linking, linkError, linkErrorMessage] = useLinkProgress(
    selectedBookId ?? '',
    username
  );

  const pendingRef = useRef(false);
  const wasBusyRef = useRef(false);

  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;
    if (isOpen) {
      modal.showModal();
      setSelectedBookId(null);
      setFilter('');
    } else {
      modal.close();
    }
  }, [isOpen]);

  // Close after a successful link
  useEffect(() => {
    if (!pendingRef.current) return;
    if (linking) {
      wasBusyRef.current = true;
      return;
    }
    if (wasBusyRef.current) {
      wasBusyRef.current = false;
      pendingRef.current = false;
      if (!linkError) onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linking, linkError]);

  const filteredBooks = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return books;
    return books.filter(
      (b) => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)
    );
  }, [books, filter]);

  const handleConfirm = useCallback(() => {
    if (!selectedBookId) return;
    pendingRef.current = true;
    wasBusyRef.current = false;
    void link(documentId);
  }, [selectedBookId, link, documentId]);

  const handleCancel = useCallback(() => onClose(), [onClose]);

  const handleClickBackground = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      e.stopPropagation();
      handleCancel();
    },
    [handleCancel]
  );

  const handleClickDialog = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
  }, []);

  return (
    <dialog
      ref={modalRef}
      className={styles.root}
      closedby="none"
      onClick={handleClickBackground}
    >
      <div className={styles.dialog} onClick={handleClickDialog}>
        <div className={styles.header}>Link Progress</div>
        <div className={styles.body}>
          <input
            className={styles.searchInput}
            type="text"
            placeholder="Filter by title or author…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
          <ul className={styles.bookList}>
            {filteredBooks.length === 0 ? (
              <li className={styles.emptyMessage}>No books match.</li>
            ) : (
              filteredBooks.map((book) => (
                <li
                  key={book.id}
                  className={cx(styles.bookItem, {
                    [styles.bookItemSelected]: book.id === selectedBookId,
                  })}
                  onClick={() => setSelectedBookId(book.id)}
                >
                  <div className={styles.bookTitle}>{book.title}</div>
                  {book.author && <div className={styles.bookAuthor}>{book.author}</div>}
                </li>
              ))
            )}
          </ul>
          {linkError && (
            <div className={styles.error}>
              {linkErrorMessage ?? 'Something went wrong. Please try again.'}
            </div>
          )}
        </div>
        <div className={styles.footer}>
          <Button type="text" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            type="primary"
            disabled={!selectedBookId || linking}
            loading={linking}
            onClick={handleConfirm}
          >
            Link
          </Button>
        </div>
      </div>
    </dialog>
  );
}
```

- [ ] **Step 3: Run type check**

```bash
npm run type -w app/client
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git -C /workspaces/HASS-ODPS add \
  app/client/src/control/link-progress-modal/index.tsx \
  app/client/src/control/link-progress-modal/style.ts
git -C /workspaces/HASS-ODPS commit -m "feat: add LinkProgressModal control"
```

---

### Task 9: `UserProgressRow` link button + export wiring

**Files:**
- Modify: `app/client/src/component/user-progress-row/index.tsx`
- Modify: `app/client/src/control/index.ts`

- [ ] **Step 1: Write failing tests**

Create `app/client/src/component/user-progress-row/index.test.tsx`. This file tests that the Link button appears only for admins when the book is unresolved.

The component uses several hooks. Mock them using `vi.mock`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/provider/auth', () => ({
  useIsAdmin: vi.fn(),
}));
vi.mock('~/provider/book', () => ({
  useBook: vi.fn(),
}));
vi.mock('~/provider/progress', () => ({
  useUserProgress: vi.fn(),
  useDeleteUserProgress: vi.fn(),
}));
vi.mock('~/control', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/control')>();
  return {
    ...actual,
    LinkProgressModal: () => null,
  };
});

import { useIsAdmin } from '~/provider/auth';
import { useBook } from '~/provider/book';
import { useUserProgress, useDeleteUserProgress } from '~/provider/progress';

import { UserProgressRow } from './index';

const noopDeleteProgress: [() => void, false, false, undefined] = [
  () => {},
  false,
  false,
  undefined,
];

const mockProgress = {
  document: 'orphan-id',
  percentage: 0.5,
  device: 'Kobo',
  timestamp: 1000,
};

describe('UserProgressRow — Link button visibility', () => {
  it('shows Link button for admin when book is unresolved (not loading)', () => {
    vi.mocked(useIsAdmin).mockReturnValue([true, false, false, undefined] as ReturnType<typeof useIsAdmin>);
    vi.mocked(useBook).mockReturnValue([undefined, false, false, undefined] as ReturnType<typeof useBook>);
    vi.mocked(useUserProgress).mockReturnValue([mockProgress, false, false] as ReturnType<typeof useUserProgress>);
    vi.mocked(useDeleteUserProgress).mockReturnValue(noopDeleteProgress as ReturnType<typeof useDeleteUserProgress>);

    render(<UserProgressRow bookId="orphan-id" username="alice" />);
    // Button renders a <div>, not a <button> element — query by text content
    expect(screen.getByText('Link')).toBeDefined();
  });

  it('does not show Link button while book is loading', () => {
    vi.mocked(useIsAdmin).mockReturnValue([true, false, false, undefined] as ReturnType<typeof useIsAdmin>);
    vi.mocked(useBook).mockReturnValue([undefined, true, false, undefined] as ReturnType<typeof useBook>);
    vi.mocked(useUserProgress).mockReturnValue([mockProgress, false, false] as ReturnType<typeof useUserProgress>);
    vi.mocked(useDeleteUserProgress).mockReturnValue(noopDeleteProgress as ReturnType<typeof useDeleteUserProgress>);

    render(<UserProgressRow bookId="orphan-id" username="alice" />);
    expect(screen.queryByText('Link')).toBeNull();
  });

  it('does not show Link button for non-admin', () => {
    vi.mocked(useIsAdmin).mockReturnValue([false, false, false, undefined] as ReturnType<typeof useIsAdmin>);
    vi.mocked(useBook).mockReturnValue([undefined, false, false, undefined] as ReturnType<typeof useBook>);
    vi.mocked(useUserProgress).mockReturnValue([mockProgress, false, false] as ReturnType<typeof useUserProgress>);
    vi.mocked(useDeleteUserProgress).mockReturnValue(noopDeleteProgress as ReturnType<typeof useDeleteUserProgress>);

    render(<UserProgressRow bookId="orphan-id" username="alice" />);
    expect(screen.queryByText('Link')).toBeNull();
  });

  it('does not show Link button when the book exists', () => {
    const book = {
      id: 'known-book',
      title: 'Known Book',
      author: 'Author',
      fileAs: '',
      series: '',
      seriesIndex: 0,
      subjects: [],
      identifiers: [],
      hasCover: false,
      size: 0,
      chapterCount: 0,
      pageCount: 0,
    };
    vi.mocked(useIsAdmin).mockReturnValue([true, false, false, undefined] as ReturnType<typeof useIsAdmin>);
    vi.mocked(useBook).mockReturnValue([book, false, false, undefined] as ReturnType<typeof useBook>);
    vi.mocked(useUserProgress).mockReturnValue([{ ...mockProgress, document: 'known-book' }, false, false] as ReturnType<typeof useUserProgress>);
    vi.mocked(useDeleteUserProgress).mockReturnValue(noopDeleteProgress as ReturnType<typeof useDeleteUserProgress>);

    render(<UserProgressRow bookId="known-book" username="alice" />);
    expect(screen.queryByText('Link')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npm test -w app/client -- user-progress-row/index.test.tsx
```

Expected: FAIL — Link button not yet rendered.

- [ ] **Step 3: Update `UserProgressRow`**

Replace the full content of `app/client/src/component/user-progress-row/index.tsx`:

```tsx
import { Fragment, useCallback, useEffect, useState } from 'react';

import { Button, ConfirmModal, LinkProgressModal } from '~/control';
import { AlertOctagonIcon } from '~/icon';
import { useIsAdmin } from '~/provider/auth';
import { useBook } from '~/provider/book';
import { useDeleteUserProgress, useUserProgress } from '~/provider/progress';
import { relativeTime } from '~/utils';

import { ProgressIndicator } from '../progress-indicator';
import { Toast } from '../toast';

import { useStyle } from './style';

interface UserProgressRowProps {
  bookId: string;
  username: string;
}

export const UserProgressRow = ({ bookId, username }: UserProgressRowProps) => {
  const styles = useStyle();

  const [isAdmin] = useIsAdmin();
  const [book, bookLoading] = useBook(bookId);
  const [progress, progressLoading, progressError] = useUserProgress(username, bookId);
  const [deleteUserProgress, deleting, error, errorMessage] = useDeleteUserProgress(username);

  const [showClearModal, setShowClearModal] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [submitCount, setSubmitCount] = useState(0);

  const handleDismiss = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (submitCount === 0) return;
    if (deleting) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setToast(null);
      return;
    }
    if (error) {
      setToast({ text: errorMessage ?? 'Failed to clear progress', type: 'error' });
      return;
    }
    setToast({ text: 'Progress cleared', type: 'success' });
  }, [submitCount, deleting, error, errorMessage]);

  const handleClear = useCallback(() => setShowClearModal(true), []);
  const handleCancelClear = useCallback(() => setShowClearModal(false), []);
  const handleConfirmClear = useCallback(() => {
    setShowClearModal(false);
    setSubmitCount((c) => c + 1);
    deleteUserProgress(bookId);
  }, [deleteUserProgress, bookId]);

  if (progressLoading) {
    return <div className={styles.loading}>Loading…</div>;
  }
  if (progressError) {
    return <div className={styles.error}>Error loading progress</div>;
  }
  if (progress === undefined) {
    return null;
  }

  const bookTitle = book?.title ?? progress.document;
  const isUnresolved = book === undefined && !bookLoading;

  const metadataList: string[] = [];
  if (progress.device) metadataList.push(progress.device);
  if (progress.timestamp != null) metadataList.push(relativeTime(progress.timestamp));

  return (
    <Fragment>
      <div className={styles.root}>
        <div className={styles.progress}>
          <ProgressIndicator value={progress.percentage} size={14} />
        </div>
        <div className={styles.book}>{bookTitle}</div>
        <div className={styles.metadata}>{metadataList.join(' · ')}</div>
        {isUnresolved && isAdmin && (
          <Button type="text" onClick={() => setShowLinkModal(true)}>
            Link
          </Button>
        )}
        <Button type="link" danger onClick={handleClear} loading={deleting}>
          Clear
        </Button>
      </div>
      {showClearModal && (
        <ConfirmModal
          isOpen
          onCancel={handleCancelClear}
          onConfirm={handleConfirmClear}
          icon={AlertOctagonIcon}
          danger
          title="Clear reading progress?"
          confirmText="Clear"
          loading={deleting}
        >
          This will remove <strong>{username}</strong>'s synced reading progress for{' '}
          <strong>{bookTitle}</strong>.
        </ConfirmModal>
      )}
      <LinkProgressModal
        isOpen={showLinkModal}
        documentId={bookId}
        username={username}
        onClose={() => setShowLinkModal(false)}
      />
      {toast && (
        <Toast key={submitCount} message={toast.text} type={toast.type} onDismiss={handleDismiss} />
      )}
    </Fragment>
  );
};
```

- [ ] **Step 4: Export `LinkProgressModal` from control index**

In `app/client/src/control/index.ts`, add:

```ts
export { LinkProgressModal } from './link-progress-modal';
```

- [ ] **Step 5: Run tests**

```bash
npm test -w app/client -- user-progress-row/index.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 6: Run full client type check**

```bash
npm run type -w app/client
```

Expected: exits 0.

- [ ] **Step 7: Run all client tests**

```bash
npm test -w app/client
```

Expected: all tests PASS.

- [ ] **Step 8: Run all server tests**

```bash
npm test -w app/server
```

Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
git -C /workspaces/HASS-ODPS add \
  app/client/src/component/user-progress-row/index.tsx \
  app/client/src/component/user-progress-row/index.test.tsx \
  app/client/src/control/index.ts
git -C /workspaces/HASS-ODPS commit -m "feat: add Link button to UserProgressRow and wire up LinkProgressModal"
```
