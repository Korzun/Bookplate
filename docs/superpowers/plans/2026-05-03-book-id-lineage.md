# Book ID Lineage — Progress Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a book's metadata is edited its EPUB file changes, producing a new ID; this plan ensures that a KoReader device syncing progress under an old ID has that progress correctly attributed to the current book.

**Architecture:** A new `book_id_history` table (added in migration v4) maps every historical book ID to the current ID of the book it once belonged to. `BookStore.reimportBook()` writes and flattens entries on each ID change; `BookStore.resolveBookId()` resolves any old ID to the current one in O(1). The KOSync PUT and GET endpoints call `resolveBookId()` before touching progress, requiring `BookStore` to be passed into `createKosyncRouter`.

**Tech Stack:** TypeScript, better-sqlite3, Express, Jest/supertest.

---

## File Map

| File | Change |
|---|---|
| `app/services/book-store.ts` | Migration v4 (new table), `reimportBook` (record + flatten), `deleteBook` (cleanup), new `resolveBookId` method |
| `app/services/book-store.test.ts` | New `describe('resolveBookId')` block; extended `deleteBook` test |
| `app/routes/kosync.ts` | Accept `bookStore: BookStore` param; resolve IDs in PUT + GET |
| `app/routes/kosync.test.ts` | New tests for lineage resolution on PUT + GET |
| `app/app.ts` | Pass `bookStore` to `createKosyncRouter` |

---

## Task 1: Migration v4 — create `book_id_history` table

**Files:**
- Modify: `app/services/book-store.ts`
- Test: `app/services/book-store.test.ts`

- [ ] **Step 1: Write the failing test**

  Add a new `describe` block at the bottom of `app/services/book-store.test.ts`:

  ```ts
  describe('book_id_history migration', () => {
    it('creates the book_id_history table on construction', () => {
      const cols = db
        .prepare("SELECT name FROM pragma_table_info('book_id_history')")
        .all() as Array<{ name: string }>;
      const names = cols.map((c) => c.name);
      expect(names).toContain('old_id');
      expect(names).toContain('current_id');
    });
  });
  ```

- [ ] **Step 2: Run test to confirm it fails**

  ```bash
  npm test -- --testPathPattern=book-store
  ```

  Expected: FAIL — `book_id_history table not found`.

- [ ] **Step 3: Add migration v4 to `BookStore.migrate()`**

  In `app/services/book-store.ts`, the `migrate()` method currently ends at `user_version < 3`. Add the v4 block immediately after it (before the closing `}` of `migrate`):

  ```ts
  if (user_version < 4) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS book_id_history (
        old_id     TEXT PRIMARY KEY,
        current_id TEXT NOT NULL
      )
    `);
    this.db.exec('PRAGMA user_version = 4');
  }
  ```

- [ ] **Step 4: Run test to confirm it passes**

  ```bash
  npm test -- --testPathPattern=book-store
  ```

  Expected: all tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add app/services/book-store.ts app/services/book-store.test.ts
  git commit -m "feat: add book_id_history table (migration v4)"
  ```

---

## Task 2: `BookStore.resolveBookId()`

**Files:**
- Modify: `app/services/book-store.ts`
- Test: `app/services/book-store.test.ts`

- [ ] **Step 1: Write the failing tests**

  Add inside the `describe('book_id_history migration')` block from Task 1:

  ```ts
  it('resolveBookId returns the input unchanged when no history exists', () => {
    expect(bookStore.resolveBookId('unknown-id')).toBe('unknown-id');
  });

  it('resolveBookId returns current_id when a mapping exists', () => {
    db.prepare(
      'INSERT INTO book_id_history (old_id, current_id) VALUES (?, ?)'
    ).run('old-id', 'new-id');
    expect(bookStore.resolveBookId('old-id')).toBe('new-id');
  });
  ```

- [ ] **Step 2: Run tests to confirm they fail**

  ```bash
  npm test -- --testPathPattern=book-store
  ```

  Expected: FAIL — `bookStore.resolveBookId is not a function`.

- [ ] **Step 3: Add `resolveBookId` to `BookStore`**

  Add this method to the `BookStore` class in `app/services/book-store.ts` (place it after `getBookById`):

  ```ts
  resolveBookId(id: string): string {
    const row = this.db
      .prepare('SELECT current_id FROM book_id_history WHERE old_id = ?')
      .get(id) as { current_id: string } | undefined;
    return row ? row.current_id : id;
  }
  ```

- [ ] **Step 4: Run tests to confirm they pass**

  ```bash
  npm test -- --testPathPattern=book-store
  ```

  Expected: all tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add app/services/book-store.ts app/services/book-store.test.ts
  git commit -m "feat: add BookStore.resolveBookId()"
  ```

---

## Task 3: Record and flatten lineage in `reimportBook()`

**Files:**
- Modify: `app/services/book-store.ts`
- Test: `app/services/book-store.test.ts`

- [ ] **Step 1: Write the failing tests**

  Add a new `describe` block in `app/services/book-store.test.ts`. The existing `reimportBook` tests use real EPUB files on disk — this describe uses the mock importer pattern already established in the file:

  ```ts
  describe('resolveBookId — lineage via reimportBook', () => {
    function makeImporterWithId(id: string): ScanImporter {
      return {
        parseEpub: (_p: string): EpubMeta => ({
          title: 'Book', author: '', description: '', publisher: '',
          series: '', seriesIndex: 0, fileAs: '',
          identifiers: [], subjects: [], coverData: null, coverMime: null,
        }),
        partialMD5: (_p: string): string => id,
      };
    }

    beforeEach(() => {
      // Seed the DB with a book at 'id-a' whose file lives in booksDir
      const filePath = path.join(booksDir, 'lineage.epub');
      fs.writeFileSync(filePath, 'epub-content');
      bookStore.addBook('id-a', 'lineage.epub', filePath, 100, new Date(), {
        title: 'Book', author: '', description: '', publisher: '',
        series: '', seriesIndex: 0, fileAs: '',
        identifiers: [], subjects: [], coverData: null, coverMime: null,
      });
    });

    it('single hop: resolveBookId(old) returns new after reimport', () => {
      bookStore.reimportBook('id-a', makeImporterWithId('id-b'));
      expect(bookStore.resolveBookId('id-a')).toBe('id-b');
    });

    it('multi-hop: resolveBookId(original) returns latest after two reimports', () => {
      bookStore.reimportBook('id-a', makeImporterWithId('id-b'));
      bookStore.reimportBook('id-b', makeImporterWithId('id-c'));
      expect(bookStore.resolveBookId('id-a')).toBe('id-c');
      expect(bookStore.resolveBookId('id-b')).toBe('id-c');
    });

    it('no history entry when ID does not change on reimport', () => {
      bookStore.reimportBook('id-a', makeImporterWithId('id-a'));
      expect(bookStore.resolveBookId('id-a')).toBe('id-a'); // pass-through
      const rows = db
        .prepare('SELECT * FROM book_id_history WHERE old_id = ?')
        .all('id-a');
      expect(rows).toHaveLength(0);
    });
  });
  ```

- [ ] **Step 2: Run tests to confirm they fail**

  ```bash
  npm test -- --testPathPattern=book-store
  ```

  Expected: `single hop` and `multi-hop` tests FAIL (no history entries written yet).

- [ ] **Step 3: Update `reimportBook()` to write and flatten lineage**

  In `app/services/book-store.ts`, inside the `this.db.transaction(() => { ... })()` block of `reimportBook`, after the existing `UPDATE progress SET document=? WHERE document=?` line (line 267), add:

  ```ts
  // Record the new mapping and flatten any prior chain entries.
  this.db
    .prepare('INSERT OR REPLACE INTO book_id_history (old_id, current_id) VALUES (?, ?)')
    .run(id, newId);
  this.db
    .prepare('UPDATE book_id_history SET current_id = ? WHERE current_id = ?')
    .run(newId, id);
  ```

  The full `if (newId !== id)` block should now look like:

  ```ts
  if (newId !== id) {
    this.db
      .prepare(
        `UPDATE books SET id=?, title=?, file_as=?, author=?, description=?, publisher=?,
         series=?, series_index=?, identifiers=?, subjects=?, cover_data=?, cover_mime=?,
         size=?, mtime=? WHERE id=?`
      )
      .run(
        newId,
        meta.title.trim() || path.basename(row.filename, path.extname(row.filename)),
        (meta.fileAs || '').trim(),
        meta.author,
        meta.description,
        meta.publisher,
        meta.series,
        meta.seriesIndex,
        JSON.stringify(meta.identifiers),
        JSON.stringify(meta.subjects),
        meta.coverData,
        meta.coverMime,
        stat.size,
        stat.mtime.getTime(),
        id
      );
    if (progressExists) {
      this.db.prepare('UPDATE progress SET document=? WHERE document=?').run(newId, id);
    }
    this.db
      .prepare('INSERT OR REPLACE INTO book_id_history (old_id, current_id) VALUES (?, ?)')
      .run(id, newId);
    this.db
      .prepare('UPDATE book_id_history SET current_id = ? WHERE current_id = ?')
      .run(newId, id);
  }
  ```

- [ ] **Step 4: Run tests to confirm they pass**

  ```bash
  npm test -- --testPathPattern=book-store
  ```

  Expected: all tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add app/services/book-store.ts app/services/book-store.test.ts
  git commit -m "feat: record and flatten lineage in reimportBook"
  ```

---

## Task 4: Clean up history in `deleteBook()`

**Files:**
- Modify: `app/services/book-store.ts`
- Test: `app/services/book-store.test.ts`

- [ ] **Step 1: Write the failing test**

  Add inside the existing `describe('deleteBook')` block in `app/services/book-store.test.ts`:

  ```ts
  it('removes book_id_history entries for the deleted book', () => {
    bookStore.addBook('del2', 'del2.epub', '/books/del2.epub', 100, new Date(), FAKE_META);
    // Manually seed history entries as if the book had been reimported before
    db.prepare('INSERT INTO book_id_history (old_id, current_id) VALUES (?, ?)').run(
      'old-del2',
      'del2'
    );
    bookStore.deleteBook('del2');
    const rows = db
      .prepare(
        'SELECT * FROM book_id_history WHERE old_id = ? OR current_id = ?'
      )
      .all('old-del2', 'del2');
    expect(rows).toHaveLength(0);
  });
  ```

- [ ] **Step 2: Run test to confirm it fails**

  ```bash
  npm test -- --testPathPattern=book-store
  ```

  Expected: FAIL — history rows still present after delete.

- [ ] **Step 3: Update `deleteBook()`**

  In `app/services/book-store.ts`, the current `deleteBook` method is:

  ```ts
  deleteBook(id: string): Book | null {
    const book = this.getBookById(id);
    if (!book) return null;
    try {
      fs.unlinkSync(book.path);
    } catch {
      /* file already gone */
    }
    this.db.prepare('DELETE FROM books WHERE id = ?').run(id);
    return book;
  }
  ```

  Replace it with:

  ```ts
  deleteBook(id: string): Book | null {
    const book = this.getBookById(id);
    if (!book) return null;
    try {
      fs.unlinkSync(book.path);
    } catch {
      /* file already gone */
    }
    this.db.prepare('DELETE FROM books WHERE id = ?').run(id);
    this.db
      .prepare('DELETE FROM book_id_history WHERE old_id = ? OR current_id = ?')
      .run(id, id);
    return book;
  }
  ```

- [ ] **Step 4: Run tests to confirm they pass**

  ```bash
  npm test -- --testPathPattern=book-store
  ```

  Expected: all tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add app/services/book-store.ts app/services/book-store.test.ts
  git commit -m "feat: clean up book_id_history on deleteBook"
  ```

---

## Task 5: Wire `bookStore` into `createKosyncRouter` and resolve IDs

**Files:**
- Modify: `app/routes/kosync.ts`
- Modify: `app/app.ts`
- Test: `app/routes/kosync.test.ts`

- [ ] **Step 1: Write the failing tests**

  In `app/routes/kosync.test.ts`, update the imports and `beforeEach` to pass a `bookStore`, then add a new `describe` block:

  At the top of the file, add the imports:

  ```ts
  import Database from 'better-sqlite3';
  import request from 'supertest';
  import express from 'express';
  import { UserStore } from '../services/user-store';
  import { BookStore } from '../services/book-store';
  import { createKosyncRouter } from './kosync';
  ```

  Update the module-level variables and `beforeEach`:

  ```ts
  let db: InstanceType<typeof Database>;
  let userStore: UserStore;
  let bookStore: BookStore;
  let app: express.Express;

  beforeEach(() => {
    db = new Database(':memory:');
    userStore = new UserStore(db);
    bookStore = new BookStore('/tmp/books', db);
    app = express();
    app.use(express.json());
    app.use('/kosync', createKosyncRouter(userStore, bookStore));
  });
  ```

  Add the new lineage tests at the bottom of the file:

  ```ts
  describe('KOSync lineage resolution', () => {
    beforeEach(async () => {
      await request(app).post('/kosync/users/create').send(registerBody('alice', 'secret'));
      // Seed a history entry: 'old-doc-id' → 'current-doc-id'
      db.prepare(
        'INSERT INTO book_id_history (old_id, current_id) VALUES (?, ?)'
      ).run('old-doc-id', 'current-doc-id');
    });

    it('PUT with old ID stores progress under current ID', async () => {
      await request(app)
        .put('/kosync/syncs/progress')
        .set(authHeaders('alice', 'secret'))
        .send({
          document: 'old-doc-id',
          progress: '/body/DocFragment[3]',
          percentage: 0.3,
          device: 'Kobo',
          device_id: 'dev-1',
        });

      // Fetch with the *current* ID — should find the saved progress
      const res = await request(app)
        .get('/kosync/syncs/progress/current-doc-id')
        .set(authHeaders('alice', 'secret'));
      expect(res.status).toBe(200);
      expect(res.body.percentage).toBeCloseTo(0.3);
    });

    it('PUT with old ID returns original document in response', async () => {
      const res = await request(app)
        .put('/kosync/syncs/progress')
        .set(authHeaders('alice', 'secret'))
        .send({
          document: 'old-doc-id',
          progress: '/body/DocFragment[3]',
          percentage: 0.3,
          device: 'Kobo',
          device_id: 'dev-1',
        });
      expect(res.status).toBe(200);
      expect(res.body.document).toBe('old-doc-id');
    });

    it('GET with old ID returns progress stored under current ID', async () => {
      // Save progress under the current ID directly
      db.prepare(
        `INSERT INTO progress (username, document, progress, percentage, device, device_id, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('alice', 'current-doc-id', '/body/DocFragment[7]', 0.7, 'Kobo', 'dev-1', 1700000000);

      const res = await request(app)
        .get('/kosync/syncs/progress/old-doc-id')
        .set(authHeaders('alice', 'secret'));
      expect(res.status).toBe(200);
      expect(res.body.percentage).toBeCloseTo(0.7);
    });

    it('PUT and GET with current ID are unaffected', async () => {
      await request(app)
        .put('/kosync/syncs/progress')
        .set(authHeaders('alice', 'secret'))
        .send({
          document: 'current-doc-id',
          progress: '/body/DocFragment[5]',
          percentage: 0.5,
          device: 'Kobo',
          device_id: 'dev-1',
        });

      const res = await request(app)
        .get('/kosync/syncs/progress/current-doc-id')
        .set(authHeaders('alice', 'secret'));
      expect(res.status).toBe(200);
      expect(res.body.percentage).toBeCloseTo(0.5);
    });
  });
  ```

- [ ] **Step 2: Run tests to confirm they fail**

  ```bash
  npm test -- --testPathPattern=kosync
  ```

  Expected: compilation error — `createKosyncRouter` does not accept two arguments yet; lineage tests also fail.

- [ ] **Step 3: Update `createKosyncRouter` signature and add resolution**

  Replace `app/routes/kosync.ts` with:

  ```ts
  // app/routes/kosync.ts
  import { Router, Request, Response } from 'express';
  import { UserStore } from '../services/user-store';
  import { BookStore } from '../services/book-store';
  import { kosyncAuth } from '../middleware/auth';
  import { logger } from '../logger';

  const log = logger('KOSync');

  export function createKosyncRouter(userStore: UserStore, bookStore: BookStore): Router {
    const router = Router();

    // Registration: POST /kosync/users/create  body: { username, password }
    router.post('/users/create', (req: Request, res: Response) => {
      const { username, password } = req.body as { username?: string; password?: string };
      if (!username || !password) {
        log.warn('Registration rejected — missing username or password');
        res.status(400).json({ username: null });
        return;
      }
      const created = userStore.createUser(username, password);
      if (created) {
        log.info(`User "${username}" registered`);
        res.status(201).json({ username });
      } else {
        log.warn(`Registration rejected — username "${username}" already exists`);
        res.status(402).json({ username: null });
      }
    });

    // Auth check: GET /kosync/users/auth
    router.get('/users/auth', kosyncAuth(userStore), (_req: Request, res: Response) => {
      res.status(200).json({ authorized: 'OK' });
    });

    // Save progress: PUT /kosync/syncs/progress
    router.put('/syncs/progress', kosyncAuth(userStore), (req: Request, res: Response) => {
      const { document, progress, percentage, device, device_id } = req.body as {
        document?: string;
        progress?: string;
        percentage?: number;
        device?: string;
        device_id?: string;
      };
      if (!document || !progress || percentage === undefined || !device || !device_id) {
        res.status(400).json({ message: 'Missing required fields' });
        return;
      }
      const currentId = bookStore.resolveBookId(document);
      const saved = userStore.saveProgress(req.kosyncUser!, {
        document: currentId,
        progress,
        percentage,
        device,
        device_id,
      });
      log.info(
        `Progress saved for "${req.kosyncUser}" — "${currentId}" at ${(percentage * 100).toFixed(1)}%`
      );
      res.status(200).json({ document, timestamp: saved.timestamp });
    });

    // Get progress: GET /kosync/syncs/progress/:document
    router.get('/syncs/progress/:document', kosyncAuth(userStore), (req: Request, res: Response) => {
      const currentId = bookStore.resolveBookId(req.params.document);
      const p = userStore.getProgress(req.kosyncUser!, currentId);
      if (!p) {
        log.warn(`Progress not found for "${req.kosyncUser}" — "${req.params.document}"`);
        res.status(404).json({ message: 'Not found' });
        return;
      }
      log.debug(`Progress retrieved for "${req.kosyncUser}" — "${req.params.document}"`);
      res.status(200).json(p);
    });

    return router;
  }
  ```

- [ ] **Step 4: Update `app/app.ts` to pass `bookStore`**

  In `app/app.ts`, change line 30 from:

  ```ts
  app.use('/kosync', createKosyncRouter(userStore));
  ```

  to:

  ```ts
  app.use('/kosync', createKosyncRouter(userStore, bookStore));
  ```

- [ ] **Step 5: Run tests to confirm they pass**

  ```bash
  npm test -- --testPathPattern=kosync
  ```

  Expected: all tests pass.

- [ ] **Step 6: Run the full test suite**

  ```bash
  npm test
  ```

  Expected: all tests pass.

- [ ] **Step 7: Commit**

  ```bash
  git add app/routes/kosync.ts app/routes/kosync.test.ts app/app.ts
  git commit -m "feat: resolve book ID lineage in KOSync PUT and GET"
  ```
