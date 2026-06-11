# Per-User Libraries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the single global book library into one library per user — per-user folders on disk, `user_id`-scoped book tables, owner-accessible book management, and an admin library switcher.

**Architecture:** Add `user_id` to `Book`, `BookThumbnail`, and `BookIdHistory` with composite primary keys. `BookStore` becomes owner-scoped (every method takes an `Owner = { userId, username }`); files live at `<booksRoot>/<username>/<hash>.epub`. Routes derive the owner from the session, or from `?user=` for admin sessions. A one-time data migration copies the existing library to every user. The client gains a library-target provider that appends `?user=` for admins, and ownership affordances replace admin gating.

**Tech Stack:** Express + Prisma (SQLite, better-sqlite3 adapter), React + Vite, Jest + supertest (server), Vitest + RTL (client).

**Spec:** `docs/superpowers/specs/2026-06-10-per-user-libraries-design.md`

**Important sequencing note:** Tasks 1–3 are independently green. Task 4 is a single atomic "core switch" — the schema, BookStore, and all its callers must change together because the Prisma client is generated from the schema. It has one commit at the end, when everything compiles and passes. Tasks 5–10 are independently green again.

**Conventions (from repo):** React component files are kebab-case. Run `npm test` then `npm run lint` before every commit. Git remote is named `GitHub` (not `origin`).

---

### Task 1: Username validation utilities

**Files:**
- Create: `app/server/utils/username.ts`
- Create: `app/server/utils/username.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// app/server/utils/username.test.ts
import { isValidUsername, sanitizeUsername } from './username';

describe('isValidUsername', () => {
  it.each(['alice', 'Bob42', 'jane.doe', 'a', 'user_name', 'x-1'])('accepts %s', (name) => {
    expect(isValidUsername(name)).toBe(true);
  });

  it.each([
    '', // empty
    '.hidden', // leading dot (hidden folder / .staging collision)
    '-dash', // must start alphanumeric
    '_under', // must start alphanumeric
    'a/b', // path separator
    'a\\b', // path separator
    'a b', // space
    'ünïcode', // non-ASCII
    'semi;colon',
    '..',
  ])('rejects %j', (name) => {
    expect(isValidUsername(name)).toBe(false);
  });
});

describe('sanitizeUsername', () => {
  it('replaces invalid characters with dashes', () => {
    expect(sanitizeUsername('jane doe!')).toBe('jane-doe-');
  });

  it('strips leading non-alphanumerics', () => {
    expect(sanitizeUsername('.hidden')).toBe('hidden');
    expect(sanitizeUsername('--x')).toBe('x');
  });

  it('falls back to "user" when nothing survives', () => {
    expect(sanitizeUsername('!!!')).toBe('user');
    expect(sanitizeUsername('')).toBe('user');
  });

  it('produces valid usernames', () => {
    for (const input of ['.hidden', 'a/b', 'ünïcode', '!!!', 'jane doe']) {
      expect(isValidUsername(sanitizeUsername(input))).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest utils/username.test.ts` (from `app/server`)
Expected: FAIL — `Cannot find module './username'`

- [ ] **Step 3: Write the implementation**

```typescript
// app/server/utils/username.ts

// Usernames double as on-disk folder names under the books root, so they must
// be filesystem-safe: start alphanumeric (no hidden folders, no collision with
// the shared ".staging" folder), then letters/digits/dot/underscore/dash only.
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

/**
 * Maps an arbitrary string to a valid username: invalid characters become
 * dashes, leading non-alphanumerics are stripped, and an empty result falls
 * back to "user". Used by the per-user-libraries migration to rename legacy
 * users whose names are not filesystem-safe.
 */
export function sanitizeUsername(username: string): string {
  const replaced = username.replace(/[^A-Za-z0-9._-]/g, '-');
  const stripped = replaced.replace(/^[^A-Za-z0-9]+/, '');
  return stripped || 'user';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest utils/username.test.ts` (from `app/server`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/server/utils/username.ts app/server/utils/username.test.ts
git commit -m "feat: add filesystem-safe username validation utilities"
```

---

### Task 2: Enforce username validation at user creation

**Files:**
- Modify: `app/server/routes/users.ts:80-106` (POST `/` handler)
- Modify: `app/server/routes/users.test.ts` (add cases)

- [ ] **Step 1: Write the failing tests**

Add to the existing `POST /api/users` describe block in `app/server/routes/users.test.ts`, following the file's existing supertest + session-login pattern:

```typescript
it('rejects usernames with invalid characters', async () => {
  const res = await agent
    .post('/api/users')
    .send({ username: 'bad/name', password: 'secret123' });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/letters, numbers/i);
});

it('rejects usernames starting with a dot', async () => {
  const res = await agent
    .post('/api/users')
    .send({ username: '.staging', password: 'secret123' });
  expect(res.status).toBe(400);
});

it('accepts a valid username with dot and dash', async () => {
  const res = await agent
    .post('/api/users')
    .send({ username: 'jane.doe-2', password: 'secret123' });
  expect(res.status).toBe(201);
});
```

(Adapt `agent` to whatever the file names its admin-authenticated supertest agent.)

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx jest routes/users.test.ts` (from `app/server`)
Expected: FAIL — invalid usernames currently return 201

- [ ] **Step 3: Implement validation**

In `app/server/routes/users.ts`, add the import:

```typescript
import { isValidUsername } from '../utils/username';
```

In the `POST /` handler, after `const trimmedUsername = username.trim();` and before the admin-reserved check, add:

```typescript
if (!isValidUsername(trimmedUsername)) {
  log.warn(`Registration rejected — invalid username "${trimmedUsername}"`);
  res.status(400).json({
    error:
      'Username may only contain letters, numbers, dots, underscores and dashes, and must start with a letter or number',
  });
  return;
}
```

- [ ] **Step 4: Run tests, lint**

Run: `npx jest routes/users.test.ts` then `npm run lint` (from repo root)
Expected: PASS, no lint errors

- [ ] **Step 5: Commit**

```bash
git add app/server/routes/users.ts app/server/routes/users.test.ts
git commit -m "feat: validate usernames are filesystem-safe at creation"
```

---

### Task 3: DDL migration — nullable `user_id` columns

Follows the repo's established pattern (`0004_add_user_id` + `data_v10`): the Prisma SQL migration adds nullable columns; a later app-level data migration rebuilds the tables with composite primary keys (Task 4).

**Files:**
- Create: `app/server/prisma/migrations/0005_add_book_user_id/migration.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Add user_id columns (nullable for now). Backfilled per user and promoted to
-- composite primary keys by the data_v11_per_user_libraries data migration,
-- which also rebuilds these tables with foreign keys to "users".
ALTER TABLE "books" ADD COLUMN "user_id" TEXT;
ALTER TABLE "book_thumbnails" ADD COLUMN "user_id" TEXT;
ALTER TABLE "book_id_history" ADD COLUMN "user_id" TEXT;
```

- [ ] **Step 2: Run the full server suite to confirm the migration applies cleanly**

Run: `npm test -w app/server` (from repo root)
Expected: PASS — existing code ignores the new nullable columns; migration log line `Prisma migration applied: 0005_add_book_user_id` appears.

- [ ] **Step 3: Commit**

```bash
git add app/server/prisma/migrations/0005_add_book_user_id/migration.sql
git commit -m "feat: add nullable user_id columns to book tables"
```

---

### Task 4: Server core switch (atomic)

Everything in this task lands in **one commit**: the Prisma schema, the regenerated client, the owner-scoped `BookStore`, the data migration, all routes, startup, and the server test updates. Between steps the tree will not compile — do not commit until the final step.

**Files:**
- Modify: `app/server/prisma/schema.prisma`
- Modify: `app/server/types.ts` (add `Owner`)
- Modify: `app/server/services/book-store.ts` (rewrite — full file below)
- Modify: `app/server/services/thumbnail-queue.ts`
- Modify: `app/server/db/migrate.ts` (add `data_v11_per_user_libraries`)
- Modify: `app/server/middleware/auth.ts` (opdsAuth attaches owner)
- Modify: `app/server/global.d.ts`
- Modify: `app/server/routes/ui.ts`
- Modify: `app/server/routes/opds.ts`
- Modify: `app/server/routes/kosync.ts`
- Modify: `app/server/routes/users.ts` (folder lifecycle)
- Modify: `app/server/services/user-store.ts` (add `listOwners`)
- Modify: `app/server/server.ts`, `app/server/index.ts`
- Modify: `app/server/services/book-store.test.ts`, `app/server/routes/ui.test.ts`, `app/server/routes/opds.test.ts`, `app/server/routes/kosync.test.ts`, `app/server/routes/users.test.ts`, `app/server/services/thumbnail-queue.test.ts`

- [ ] **Step 1: Update `schema.prisma`**

Replace the `Book`, `BookThumbnail`, `BookIdHistory`, and `User` models with:

```prisma
// mtime and addedAt store milliseconds since epoch; Float avoids Int's 32-bit validation limit
// while still round-tripping correctly through SQLite's INTEGER affinity.
model Book {
  userId          String          @map("user_id")
  id              String
  title           String
  fileAs          String          @default("") @map("file_as")
  author          String          @default("")
  description     String          @default("")
  publisher       String          @default("")
  series          String          @default("")
  seriesIndex     Float           @default(0) @map("series_index")
  identifiers     String          @default("[]")
  subjects        String          @default("[]")
  coverData       Bytes?          @map("cover_data")
  coverMime       String?         @map("cover_mime")
  size            Int
  mtime           Float
  addedAt         Float           @map("added_at")
  chapterCount    Int             @default(0) @map("chapter_count")
  chapterSpineMap String          @default("[]") @map("chapter_spine_map")
  chapterNames    String?         @map("chapter_names")
  pageCount       Int             @default(0) @map("page_count")
  user            User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  thumbnails      BookThumbnail[]

  @@id([userId, id])
  @@map("books")
}

model BookThumbnail {
  userId String @map("user_id")
  bookId String @map("book_id")
  width  Int
  data   Bytes
  mime   String
  book   Book   @relation(fields: [userId, bookId], references: [userId, id], onDelete: Cascade, onUpdate: Cascade)

  @@id([userId, bookId, width])
  @@map("book_thumbnails")
}

model User {
  id                 String     @id
  username           String     @unique
  passwordHash       String?    @map("password_hash")
  syncPassword       String?    @map("sync_password")
  mustChangePassword Boolean    @default(false) @map("must_change_password")
  progresses         Progress[]
  books              Book[]

  @@map("users")
}

model BookIdHistory {
  userId    String @map("user_id")
  oldId     String @map("old_id")
  currentId String @map("current_id")
  timestamp Float  @default(dbgenerated("strftime('%s', 'now') * 1000"))
  type      String @default("edit")

  @@id([userId, oldId])
  @@map("book_id_history")
}
```

(`Progress` stays exactly as it is.)

Then regenerate the client: `npx prisma generate` (from `app/server`).

- [ ] **Step 2: Add `Owner` to `types.ts`**

Append to `app/server/types.ts`:

```typescript
/** Identifies the user whose library an operation targets. */
export interface Owner {
  /** Surrogate user ID — scopes all database queries. */
  userId: string;
  /** Username — names the on-disk folder `<booksRoot>/<username>/`. */
  username: string;
}
```

Also update the `Book.path` doc comment: `Absolute on-disk path: `<booksRoot>/<username>/<id>.epub`.`

- [ ] **Step 3: Rewrite `book-store.ts` as owner-scoped**

Replace `app/server/services/book-store.ts` with the following. The error classes, `BOOK_SELECT`, and `ScanImporter` are unchanged from the current file — the diff is: constructor takes the books *root*; new `getStagingDir`/`getUserDir`/`bookPath` helpers; every public method takes an `Owner` (or `userId` for the DB-only cover/thumbnail methods); every query is `userId`-scoped; lineage SQL carries `user_id`; progress migration inside `linkDocument`/`reimportBook` is scoped to the owner.

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
import { Book, EpubMeta, Owner } from '../types';
import { parseEpub, partialMD5 } from './epub-parser';
import { logger } from '../logger';
import { downloadFilename } from '../utils/download-filename';

const log = logger('BookStore');

// All book columns except coverData (binary blob); coverMime serves as the hasCover proxy.
const BOOK_SELECT = {
  id: true,
  title: true,
  fileAs: true,
  author: true,
  description: true,
  publisher: true,
  series: true,
  seriesIndex: true,
  identifiers: true,
  subjects: true,
  coverMime: true,
  size: true,
  mtime: true,
  addedAt: true,
  chapterCount: true,
  chapterSpineMap: true,
  chapterNames: true,
  pageCount: true,
} as const;

export class BookHashCollisionError extends Error {
  constructor(public readonly collidingId: string) {
    super(`Book hash collision: edited content matches existing book "${collidingId}"`);
    this.name = 'BookHashCollisionError';
  }
}

export class BookAlreadyExistsError extends Error {
  constructor(public readonly existingId: string) {
    super(`Book with id "${existingId}" already exists in the library`);
    this.name = 'BookAlreadyExistsError';
  }
}

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

export class DocumentIsBookError extends Error {
  constructor(public readonly documentId: string) {
    super(`Document "${documentId}" is an existing book — use the book's lineage to link instead`);
    this.name = 'DocumentIsBookError';
  }
}

export interface ScanImporter {
  parseEpub: (filePath: string) => EpubMeta;
  partialMD5: (filePath: string) => string;
}

const defaultImporter: ScanImporter = { parseEpub, partialMD5 };

export class BookStore {
  constructor(
    private readonly booksRoot: string,
    private readonly prisma: PrismaClient
  ) {}

  getBooksRoot(): string {
    return this.booksRoot;
  }

  getStagingDir(): string {
    return path.join(this.booksRoot, '.staging');
  }

  getUserDir(owner: Owner): string {
    return path.join(this.booksRoot, owner.username);
  }

  private bookPath(owner: Owner, id: string): string {
    return path.join(this.getUserDir(owner), id + '.epub');
  }

  async listBooks(owner: Owner): Promise<Book[]> {
    const rows = await this.prisma.book.findMany({
      where: { userId: owner.userId },
      select: BOOK_SELECT,
    });
    // Replicate: ORDER BY CASE WHEN file_as != '' THEN file_as ELSE title END, title, id
    rows.sort((a, b) => {
      const aKey = a.fileAs !== '' ? a.fileAs : a.title;
      const bKey = b.fileAs !== '' ? b.fileAs : b.title;
      if (aKey < bKey) return -1;
      if (aKey > bKey) return 1;
      if (a.title < b.title) return -1;
      if (a.title > b.title) return 1;
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });
    return rows.map((r) => this.prismaBookToBook(owner, r));
  }

  async getBookById(owner: Owner, id: string): Promise<Book | null> {
    const row = await this.prisma.book.findUnique({
      where: { userId_id: { userId: owner.userId, id } },
      select: BOOK_SELECT,
    });
    return row ? this.prismaBookToBook(owner, row) : null;
  }

  async addBook(owner: Owner, id: string, srcPath: string, meta: EpubMeta): Promise<void> {
    const existing = await this.prisma.book.findUnique({
      where: { userId_id: { userId: owner.userId, id } },
      select: { id: true },
    });
    if (existing) {
      throw new BookAlreadyExistsError(id);
    }

    fs.mkdirSync(this.getUserDir(owner), { recursive: true });
    const targetPath = this.bookPath(owner, id);
    if (path.resolve(srcPath) !== path.resolve(targetPath)) {
      fs.renameSync(srcPath, targetPath);
    }

    const stat = fs.statSync(targetPath);
    const title = meta.title.trim();
    const fileAs = (meta.fileAs || '').trim();

    await this.prisma.book.create({
      data: {
        userId: owner.userId,
        id,
        title,
        fileAs,
        author: meta.author,
        description: meta.description,
        publisher: meta.publisher,
        series: meta.series,
        seriesIndex: meta.seriesIndex,
        identifiers: JSON.stringify(meta.identifiers),
        subjects: JSON.stringify(meta.subjects),
        coverData: meta.coverData as unknown as Prisma.Bytes | null,
        coverMime: meta.coverMime,
        size: stat.size,
        mtime: stat.mtimeMs,
        addedAt: Date.now(),
        chapterCount: meta.chapterCount,
        chapterSpineMap: JSON.stringify(meta.chapterSpineMap),
        chapterNames: JSON.stringify(meta.chapterNames),
        pageCount: meta.pageCount,
      },
    });
  }

  async resolveBookId(userId: string, id: string): Promise<string> {
    const rows = await this.prisma.$queryRaw<Array<{ current_id: string }>>`
      SELECT current_id FROM book_id_history WHERE user_id = ${userId} AND old_id = ${id}
    `;
    return rows.length > 0 ? rows[0].current_id : id;
  }

  async getBookLineage(
    owner: Owner,
    id: string
  ): Promise<{
    currentId: string;
    entries: { oldId: string; newId: string; timestamp: number; type: string }[];
  } | null> {
    const book = await this.prisma.book.findUnique({
      where: { userId_id: { userId: owner.userId, id } },
      select: { id: true },
    });
    if (!book) return null;

    const rows = await this.prisma.$queryRaw<
      Array<{ old_id: string; timestamp: number; type: string }>
    >`
      SELECT old_id, timestamp, type FROM book_id_history
      WHERE user_id = ${owner.userId} AND current_id = ${id}
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

  async linkDocument(owner: Owner, bookId: string, documentId: string): Promise<true | null> {
    if (documentId === bookId) throw new SelfLinkError();

    const book = await this.prisma.book.findUnique({
      where: { userId_id: { userId: owner.userId, id: bookId } },
      select: { id: true },
    });
    if (!book) return null;

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.$queryRaw<Array<{ current_id: string }>>`
        SELECT current_id FROM book_id_history
        WHERE user_id = ${owner.userId} AND old_id = ${documentId}
      `;
      if (existing.length > 0) throw new DocumentAlreadyLinkedError(documentId);

      const isBook = await tx.book.findUnique({
        where: { userId_id: { userId: owner.userId, id: documentId } },
        select: { id: true },
      });
      if (isBook) throw new DocumentIsBookError(documentId);

      // Lineage is per-user, so only the owner's progress rows migrate.
      const orphanProgress = await tx.progress.findUnique({
        where: { userId_document: { userId: owner.userId, document: documentId } },
      });
      if (orphanProgress) {
        const targetProgress = await tx.progress.findUnique({
          where: { userId_document: { userId: owner.userId, document: bookId } },
        });
        if (!targetProgress || orphanProgress.timestamp >= targetProgress.timestamp) {
          if (targetProgress) {
            await tx.progress.delete({
              where: { userId_document: { userId: owner.userId, document: bookId } },
            });
          }
          await tx.progress.delete({
            where: { userId_document: { userId: owner.userId, document: documentId } },
          });
          await tx.progress.create({ data: { ...orphanProgress, document: bookId } });
        } else {
          await tx.progress.delete({
            where: { userId_document: { userId: owner.userId, document: documentId } },
          });
        }
      }

      await tx.$executeRaw`
        INSERT INTO book_id_history (user_id, old_id, current_id, timestamp, type)
        VALUES (${owner.userId}, ${documentId}, ${bookId}, ${Date.now()}, 'merge')
      `;
    });

    return true;
  }

  async unlinkDocument(
    owner: Owner,
    bookId: string,
    documentId: string
  ): Promise<'deleted' | 'not_found' | 'edit_row'> {
    return await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ type: string }>>`
        SELECT type FROM book_id_history
        WHERE user_id = ${owner.userId} AND old_id = ${documentId} AND current_id = ${bookId}
      `;
      if (rows.length === 0) return 'not_found';
      if (rows[0].type === 'edit') return 'edit_row';

      // By design, unlinking does not reverse the progress migration.
      // Progress that was migrated from documentId to bookId during linkDocument stays on bookId.
      await tx.$executeRaw`
        DELETE FROM book_id_history
        WHERE user_id = ${owner.userId} AND old_id = ${documentId} AND current_id = ${bookId}
      `;
      return 'deleted';
    });
  }

  async deleteBook(owner: Owner, id: string): Promise<Book | null> {
    const book = await this.getBookById(owner, id);
    if (!book) return null;
    try {
      await this.prisma.$transaction(async (tx) => {
        try {
          await tx.book.delete({ where: { userId_id: { userId: owner.userId, id } } });
        } catch (err) {
          if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025'))
            throw err;
        }
        await tx.$executeRaw`
          DELETE FROM book_id_history
          WHERE user_id = ${owner.userId} AND (old_id = ${id} OR current_id = ${id})
        `;
      });
    } finally {
      try {
        fs.unlinkSync(book.path);
      } catch {
        /* file already gone */
      }
    }
    return book;
  }

  async reimportBook(
    owner: Owner,
    id: string,
    importer: ScanImporter = defaultImporter
  ): Promise<Book | null> {
    const exists = await this.prisma.book.findUnique({
      where: { userId_id: { userId: owner.userId, id } },
      select: { id: true },
    });
    if (!exists) return null;

    const filePath = this.bookPath(owner, id);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return null;
    }
    const meta = importer.parseEpub(filePath);
    const newId = importer.partialMD5(filePath);

    if (newId !== id) {
      const collision = await this.prisma.book.findUnique({
        where: { userId_id: { userId: owner.userId, id: newId } },
        select: { id: true },
      });
      if (collision) {
        throw new BookHashCollisionError(newId);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      if (newId !== id) {
        const oldPath = this.bookPath(owner, id);
        const newPath = this.bookPath(owner, newId);
        if (oldPath !== newPath) {
          fs.renameSync(oldPath, newPath);
        }

        // Update the book row (and cascade-update thumbnails via the FK onUpdate: Cascade).
        await tx.book.update({
          where: { userId_id: { userId: owner.userId, id } },
          data: {
            id: newId,
            title: meta.title.trim(),
            fileAs: (meta.fileAs || '').trim(),
            author: meta.author,
            description: meta.description,
            publisher: meta.publisher,
            series: meta.series,
            seriesIndex: meta.seriesIndex,
            identifiers: JSON.stringify(meta.identifiers),
            subjects: JSON.stringify(meta.subjects),
            coverData: meta.coverData as unknown as Prisma.Bytes | null,
            coverMime: meta.coverMime,
            size: stat.size,
            mtime: stat.mtimeMs,
            chapterCount: meta.chapterCount,
            chapterSpineMap: JSON.stringify(meta.chapterSpineMap),
            chapterNames: JSON.stringify(meta.chapterNames),
            pageCount: meta.pageCount,
          },
        });

        // Progress has no FK to books and lineage is per-user, so migrate only
        // the owner's progress rows.
        const oldProgress = await tx.progress.findUnique({
          where: { userId_document: { userId: owner.userId, document: id } },
        });
        if (oldProgress) {
          const newProgress = await tx.progress.findUnique({
            where: { userId_document: { userId: owner.userId, document: newId } },
          });
          if (!newProgress || oldProgress.timestamp >= newProgress.timestamp) {
            if (newProgress) {
              await tx.progress.delete({
                where: { userId_document: { userId: owner.userId, document: newId } },
              });
            }
            await tx.progress.delete({
              where: { userId_document: { userId: owner.userId, document: id } },
            });
            await tx.progress.create({ data: { ...oldProgress, document: newId } });
          } else {
            await tx.progress.delete({
              where: { userId_document: { userId: owner.userId, document: id } },
            });
          }
        }

        // Record lineage and flatten any prior chains pointing to old id
        await tx.$executeRaw`
          INSERT OR REPLACE INTO book_id_history (user_id, old_id, current_id, timestamp)
          VALUES (${owner.userId}, ${id}, ${newId}, ${Date.now()})
        `;
        await tx.$executeRaw`
          UPDATE book_id_history SET current_id = ${newId}
          WHERE user_id = ${owner.userId} AND current_id = ${id}
        `;
      } else {
        await tx.book.update({
          where: { userId_id: { userId: owner.userId, id } },
          data: {
            title: meta.title.trim(),
            fileAs: (meta.fileAs || '').trim(),
            author: meta.author,
            description: meta.description,
            publisher: meta.publisher,
            series: meta.series,
            seriesIndex: meta.seriesIndex,
            identifiers: JSON.stringify(meta.identifiers),
            subjects: JSON.stringify(meta.subjects),
            coverData: meta.coverData as unknown as Prisma.Bytes | null,
            coverMime: meta.coverMime,
            size: stat.size,
            mtime: stat.mtimeMs,
            chapterCount: meta.chapterCount,
            chapterSpineMap: JSON.stringify(meta.chapterSpineMap),
            chapterNames: JSON.stringify(meta.chapterNames),
            pageCount: meta.pageCount,
          },
        });
      }
    });

    return this.getBookById(owner, newId);
  }

  private async removeStaleBook(userId: string, id: string): Promise<void> {
    try {
      await this.prisma.book.delete({ where: { userId_id: { userId, id } } });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025')) throw err;
    }
  }

  async getCover(userId: string, id: string): Promise<{ data: Buffer; mime: string } | null> {
    const row = await this.prisma.book.findUnique({
      where: { userId_id: { userId, id } },
      select: { coverData: true, coverMime: true },
    });
    if (!row || !row.coverData) return null;
    // Prisma returns BLOB columns as Uint8Array; Buffer.from() ensures Express sends binary
    return { data: Buffer.from(row.coverData), mime: row.coverMime as string };
  }

  async saveThumbnail(
    userId: string,
    bookId: string,
    width: number,
    data: Buffer,
    mime: string
  ): Promise<void> {
    await this.prisma.bookThumbnail.upsert({
      where: { userId_bookId_width: { userId, bookId, width } },
      update: { data: data as unknown as Prisma.Bytes, mime },
      create: { userId, bookId, width, data: data as unknown as Prisma.Bytes, mime },
    });
  }

  async getThumbnail(
    userId: string,
    bookId: string,
    width: number
  ): Promise<{ data: Buffer; mime: string } | null> {
    const row = await this.prisma.bookThumbnail.findUnique({
      where: { userId_bookId_width: { userId, bookId, width } },
    });
    // Prisma returns BLOB columns as Uint8Array; Buffer.from() ensures Express sends binary
    return row ? { data: Buffer.from(row.data), mime: row.mime } : null;
  }

  async pruneThumbnails(configuredWidths: number[]): Promise<number> {
    if (configuredWidths.length === 0) {
      const result = await this.prisma.bookThumbnail.deleteMany({});
      return result.count;
    }
    const result = await this.prisma.bookThumbnail.deleteMany({
      where: { width: { notIn: configuredWidths } },
    });
    return result.count;
  }

  async getMissingThumbnailPairs(
    widths: number[]
  ): Promise<Array<{ userId: string; bookId: string; width: number }>> {
    const result: Array<{ userId: string; bookId: string; width: number }> = [];
    for (const width of widths) {
      const rows = await this.prisma.book.findMany({
        where: {
          coverMime: { not: null },
          thumbnails: { none: { width } },
        },
        select: { userId: true, id: true },
      });
      for (const { userId, id } of rows) {
        result.push({ userId, bookId: id, width });
      }
    }
    return result;
  }

  async scan(
    owner: Owner,
    importer: ScanImporter = defaultImporter
  ): Promise<{ imported: string[]; removed: string[] }> {
    const imported: string[] = [];
    const removed: string[] = [];
    const userDir = this.getUserDir(owner);

    const dbIdRows = await this.prisma.book.findMany({
      where: { userId: owner.userId },
      select: { id: true },
    });
    const dbIds = new Set(dbIdRows.map((r) => r.id));

    const diskFilenames: string[] = fs.existsSync(userDir)
      ? fs.readdirSync(userDir).filter((f) => path.extname(f).toLowerCase() === '.epub')
      : [];

    for (const filename of diskFilenames) {
      const filePath = path.join(userDir, filename);
      const stem = path.basename(filename, '.epub');

      // Fast path: file already at <id>.epub and that id is imported.
      if (/^[0-9a-f]{32}$/.test(stem) && dbIds.has(stem)) {
        continue;
      }

      let id: string;
      let meta: EpubMeta;
      try {
        id = importer.partialMD5(filePath);
        meta = importer.parseEpub(filePath);
      } catch (err: unknown) {
        log.warn(
          `scan: skipping "${filename}" — ${err instanceof Error ? err.message : String(err)}`
        );
        continue;
      }

      const canonicalPath = this.bookPath(owner, id);
      if (filePath !== canonicalPath) {
        if (fs.existsSync(canonicalPath)) {
          log.warn(`scan: skipping "${filename}" — canonical path ${id}.epub already occupied`);
          continue;
        }
        fs.renameSync(filePath, canonicalPath);
      }

      if (dbIds.has(id)) {
        // Rename above was the only thing to do.
        continue;
      }

      try {
        const titleFallback = meta.title.trim() || path.basename(filename, path.extname(filename));
        await this.addBook(owner, id, canonicalPath, { ...meta, title: titleFallback });
        dbIds.add(id);
        imported.push(filename);
      } catch (err: unknown) {
        log.warn(
          `scan: skipping "${filename}" — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Stale rows: in DB but their canonical file is missing.
    const allIdRows = await this.prisma.book.findMany({
      where: { userId: owner.userId },
      select: { id: true },
    });
    for (const { id } of allIdRows) {
      if (!fs.existsSync(this.bookPath(owner, id))) {
        await this.removeStaleBook(owner.userId, id);
        removed.push(id + '.epub');
      }
    }

    return { imported, removed };
  }

  private prismaBookToBook(
    owner: Owner,
    r: Prisma.BookGetPayload<{ select: typeof BOOK_SELECT }>
  ): Book {
    return {
      id: r.id,
      filename: downloadFilename({
        author: r.author,
        series: r.series,
        seriesIndex: r.seriesIndex,
        title: r.title,
      }),
      path: this.bookPath(owner, r.id),
      title: r.title,
      fileAs: r.fileAs,
      author: r.author,
      description: r.description,
      publisher: r.publisher,
      series: r.series,
      seriesIndex: r.seriesIndex,
      identifiers: JSON.parse(r.identifiers) as { scheme: string; value: string }[],
      subjects: JSON.parse(r.subjects) as string[],
      hasCover: r.coverMime !== null,
      size: r.size,
      mtime: new Date(r.mtime),
      addedAt: new Date(r.addedAt),
      chapterCount: r.chapterCount,
      chapterSpineMap: JSON.parse(r.chapterSpineMap) as number[],
      chapterNames: r.chapterNames ? (JSON.parse(r.chapterNames) as string[]) : [],
      pageCount: r.pageCount,
    };
  }
}
```

Note the deliberate simplification in `linkDocument`/`reimportBook`: the old code migrated progress for *all* users because lineage was global; lineage is now per-user, so only the owner's single progress row (unique on `(userId, document)`) is involved. The newest-timestamp-wins rule is preserved.

- [ ] **Step 4: Update `thumbnail-queue.ts` for per-user jobs**

In `app/server/services/thumbnail-queue.ts`:

```typescript
interface Job {
  userId: string;
  bookId: string;
  width: number;
}
```

```typescript
enqueue(userId: string, bookId: string): void {
  for (const width of this.widths) {
    this.queue.push({ userId, bookId, width });
  }
}
```

`reconcile()` is unchanged (`getMissingThumbnailPairs` now returns `userId` in each pair, which matches the new `Job` shape). In `processJob`:

```typescript
private async processJob(job: Job): Promise<void> {
  let cover;
  try {
    cover = await this.bookStore.getCover(job.userId, job.bookId);
  } catch (err: unknown) {
    log.warn(
      `Failed to get cover for book ${job.bookId}: ${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }
  if (!cover) return;
  try {
    const resized = await this.resize(cover.data, job.width);
    await this.bookStore.saveThumbnail(job.userId, job.bookId, job.width, resized, 'image/jpeg');
  } catch (err: unknown) {
    log.warn(
      `Failed to generate ${job.width}px thumbnail for book ${job.bookId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}
```

- [ ] **Step 5: Add the `data_v11_per_user_libraries` data migration**

In `app/server/db/migrate.ts`, add the import:

```typescript
import { isValidUsername, sanitizeUsername } from '../utils/username';
```

Append this block at the end of `runMigrations` (after `data_v9_chapter_data`):

```typescript
// Data migration: per-user libraries. Renames filesystem-unsafe usernames,
// rebuilds the book tables with composite (user_id, ...) primary keys, copies
// every legacy book (rows + epub files) into every user's library, and removes
// the legacy flat files. With zero users the legacy books are deleted outright.
await runDataMigration(prisma, 'data_v11_per_user_libraries', async () => {
  const users = await prisma.$queryRaw<Array<{ id: string; username: string }>>`
    SELECT id, username FROM users ORDER BY username
  `;

  // 1. Rename filesystem-unsafe usernames (folder names derive from usernames).
  const taken = new Set(users.map((u) => u.username));
  for (const u of users) {
    if (isValidUsername(u.username)) continue;
    const base = sanitizeUsername(u.username);
    let candidate = base;
    let suffix = 2;
    while (taken.has(candidate)) candidate = `${base}-${suffix++}`;
    await prisma.$executeRaw`UPDATE users SET username = ${candidate} WHERE id = ${u.id}`;
    log.warn(
      `Per-user libraries: renamed user "${u.username}" to "${candidate}" (filesystem-unsafe username). ` +
        `KOReader sync and OPDS clients must update their username.`
    );
    taken.delete(u.username);
    taken.add(candidate);
    u.username = candidate;
  }

  // 2. Rebuild book tables with composite primary keys. FK enforcement off so
  // dropping the old tables doesn't cascade.
  await prisma.$executeRaw`PRAGMA foreign_keys = OFF`;

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "books_new" (
      "user_id" TEXT NOT NULL,
      "id" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "file_as" TEXT NOT NULL DEFAULT '',
      "author" TEXT NOT NULL DEFAULT '',
      "description" TEXT NOT NULL DEFAULT '',
      "publisher" TEXT NOT NULL DEFAULT '',
      "series" TEXT NOT NULL DEFAULT '',
      "series_index" REAL NOT NULL DEFAULT 0,
      "identifiers" TEXT NOT NULL DEFAULT '[]',
      "subjects" TEXT NOT NULL DEFAULT '[]',
      "cover_data" BLOB,
      "cover_mime" TEXT,
      "size" INTEGER NOT NULL,
      "mtime" REAL NOT NULL,
      "added_at" REAL NOT NULL,
      "chapter_count" INTEGER NOT NULL DEFAULT 0,
      "chapter_spine_map" TEXT NOT NULL DEFAULT '[]',
      "chapter_names" TEXT,
      "page_count" INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY ("user_id", "id"),
      CONSTRAINT "books_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "book_thumbnails_new" (
      "user_id" TEXT NOT NULL,
      "book_id" TEXT NOT NULL,
      "width" INTEGER NOT NULL,
      "data" BLOB NOT NULL,
      "mime" TEXT NOT NULL,
      PRIMARY KEY ("user_id", "book_id", "width"),
      CONSTRAINT "book_thumbnails_user_id_book_id_fkey" FOREIGN KEY ("user_id", "book_id") REFERENCES "books" ("user_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "book_id_history_new" (
      "user_id" TEXT NOT NULL,
      "old_id" TEXT NOT NULL,
      "current_id" TEXT NOT NULL,
      "timestamp" REAL NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      "type" TEXT NOT NULL DEFAULT 'edit',
      PRIMARY KEY ("user_id", "old_id")
    )
  `);

  // 3. Copy every legacy row once per user, and the epub files into per-user folders.
  const legacyBooks = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM books`;
  for (const u of users) {
    fs.mkdirSync(path.join(booksDir, u.username), { recursive: true });
    await prisma.$executeRaw`
      INSERT INTO books_new (user_id, id, title, file_as, author, description, publisher,
        series, series_index, identifiers, subjects, cover_data, cover_mime, size, mtime,
        added_at, chapter_count, chapter_spine_map, chapter_names, page_count)
      SELECT ${u.id}, id, title, file_as, author, description, publisher,
        series, series_index, identifiers, subjects, cover_data, cover_mime, size, mtime,
        added_at, chapter_count, chapter_spine_map, chapter_names, page_count
      FROM books
    `;
    await prisma.$executeRaw`
      INSERT INTO book_thumbnails_new (user_id, book_id, width, data, mime)
      SELECT ${u.id}, book_id, width, data, mime FROM book_thumbnails
    `;
    await prisma.$executeRaw`
      INSERT INTO book_id_history_new (user_id, old_id, current_id, timestamp, type)
      SELECT ${u.id}, old_id, current_id, timestamp, type FROM book_id_history
    `;
    for (const { id } of legacyBooks) {
      const src = path.join(booksDir, id + '.epub');
      const dest = path.join(booksDir, u.username, id + '.epub');
      try {
        fs.copyFileSync(src, dest);
      } catch {
        log.warn(`Per-user libraries: could not copy ${id}.epub for "${u.username}" (missing file)`);
      }
    }
  }

  await prisma.$executeRawUnsafe(`DROP TABLE "book_thumbnails"`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "book_thumbnails_new" RENAME TO "book_thumbnails"`);
  await prisma.$executeRawUnsafe(`DROP TABLE "books"`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "books_new" RENAME TO "books"`);
  await prisma.$executeRawUnsafe(`DROP TABLE "book_id_history"`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "book_id_history_new" RENAME TO "book_id_history"`);

  await prisma.$executeRaw`PRAGMA foreign_keys = ON`;

  // 4. Remove legacy flat files — also when there are zero users (per spec,
  // the unreachable legacy library is deleted).
  for (const { id } of legacyBooks) {
    fs.rmSync(path.join(booksDir, id + '.epub'), { force: true });
  }
  if (legacyBooks.length > 0) {
    log.info(
      `Per-user libraries: distributed ${legacyBooks.length} book(s) to ${users.length} user(s)`
    );
  }
});
```

- [ ] **Step 6: opdsAuth attaches the owner; global.d.ts**

In `app/server/global.d.ts`, extend the Express Request interface:

```typescript
declare global {
  namespace Express {
    interface Request {
      kosyncUser?: string;
      kosyncUserId?: string;
      opdsOwner?: { userId: string; username: string };
    }
  }
}
```

In `app/server/middleware/auth.ts`, change the body of `opdsAuth` after decoding username/password to capture the user ID and attach the owner:

```typescript
const userId = await userStore.authenticate(username, UserStore.hashSyncPassword(password));
if (!userId) {
  log.warn(`OPDS auth failed for user "${username}"`);
  res.set('WWW-Authenticate', 'Basic realm="HASS-ODPS"');
  res.status(401).send();
  return;
}
req.opdsOwner = { userId, username };
next();
```

- [ ] **Step 7: Owner-scope the UI routes**

In `app/server/routes/ui.ts`:

1. Import `Owner` from `../types` and drop the now-unused `adminAuth` import.
2. Staging dir: replace `const stagingDir = path.join(bookStore.getBooksDir(), '.staging');` with `const stagingDir = bookStore.getStagingDir();`
3. Add an owner resolver inside `createUiRouter` (after the multer setup):

```typescript
/**
 * Resolves which library this request operates on. Regular users always get
 * their own library (passing ?user= is forbidden). Admin sessions have no
 * library, so they must name a target via ?user=<username>.
 * Responds with the appropriate error and returns null when unresolvable.
 */
async function resolveOwner(req: Request, res: Response): Promise<Owner | null> {
  const target = req.query.user;
  if (req.session.isAdmin) {
    if (typeof target !== 'string' || !target.trim()) {
      res.status(400).json({ error: 'user query parameter is required for admin sessions' });
      return null;
    }
    const userId = await userStore.getUserIdByUsername(target);
    if (!userId) {
      res.status(404).json({ error: 'User not found' });
      return null;
    }
    return { userId, username: target };
  }
  if (target !== undefined) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  const userId = requireUserId(req, res);
  if (!userId) return null;
  return { userId, username: req.session.username! };
}
```

4. Remove `adminAuth` from every route that has it (`/api/books/:id/lineage`, `/api/books/:id/link`, `/api/books/:id/link/:documentId`, DELETE `/api/books/:id`, `/api/books/scan`, `/api/books/:id/metadata`, `/api/books/:id/regen-chapters`).
5. At the top of every `/api/books*` handler, resolve the owner and thread it through. The pattern for each route:

```typescript
router.get('/api/books', sessionAuth, async (req: Request, res: Response) => {
  const owner = await resolveOwner(req, res);
  if (!owner) return;
  res.json(
    (await bookStore.listBooks(owner)).map((b) => {
      /* destructuring unchanged */
    })
  );
});
```

Exact call replacements per route:
- upload: `await bookStore.addBook(owner, id, savedPath, { ...meta, title: titleFallback });` and `thumbnailQueue.enqueue(owner.userId, id);`
- GET `/api/books/:id`: `await bookStore.getBookById(owner, req.params.id)`
- lineage: `await bookStore.getBookLineage(owner, req.params.id)`
- link: `await bookStore.linkDocument(owner, req.params.id, documentId.trim())`
- unlink: `await bookStore.unlinkDocument(owner, req.params.id, req.params.documentId)`
- cover: `await bookStore.getThumbnail(owner.userId, req.params.id, parsedWidth)` / `await bookStore.getCover(owner.userId, req.params.id)`
- delete: `await bookStore.deleteBook(owner, req.params.id)`
- scan: `await bookStore.scan(owner)`
- metadata patch: `await bookStore.getBookById(owner, req.params.id)`, `await bookStore.reimportBook(owner, req.params.id)`, `thumbnailQueue.enqueue(owner.userId, updated.id);`
- regen-chapters: `await bookStore.getBookById(owner, req.params.id)`, `await bookStore.reimportBook(owner, req.params.id)`

The upload route resolves the owner once before the file loop. `/api/my/*`, `/api/login`, `/api/me`, `/api/config` are untouched.

- [ ] **Step 8: Owner-scope OPDS routes**

In `app/server/routes/opds.ts`, each handler reads `const owner = req.opdsOwner!;` (set by `opdsAuth`) and calls:
- `/books`: `await bookStore.listBooks(owner)`
- `/books/:id/download`: `await bookStore.getBookById(owner, req.params.id)` — the `decodeBasicUser` helper can be deleted; use `owner.username` for the log line.
- `/books/:id/cover`: `await bookStore.getThumbnail(owner.userId, req.params.id, parsedWidth)` / `await bookStore.getCover(owner.userId, req.params.id)`

- [ ] **Step 9: KOSync passes the user to resolveBookId**

In `app/server/routes/kosync.ts`, both occurrences of
`await bookStore.resolveBookId(document)` / `await bookStore.resolveBookId(req.params.document)`
become
`await bookStore.resolveBookId(req.kosyncUserId!, document)` / `await bookStore.resolveBookId(req.kosyncUserId!, req.params.document)`.

- [ ] **Step 10: User folder lifecycle in the users router**

Change the signature in `app/server/routes/users.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
```

```typescript
export function createUsersRouter(
  userStore: UserStore,
  adminUsername: string,
  booksRoot: string
): Router {
```

In `POST /` after a successful `createUser`:

```typescript
fs.mkdirSync(path.join(booksRoot, trimmedUsername), { recursive: true });
```

In `DELETE /:username` after a successful `deleteUser` (the username is guaranteed safe to use as a path because creation validates it; legacy names were sanitized by the migration — but guard anyway):

```typescript
if (isValidUsername(username)) {
  fs.rmSync(path.join(booksRoot, username), { recursive: true, force: true });
}
```

(`isValidUsername` is already imported from Task 2.)

- [ ] **Step 11: Add `UserStore.listOwners`, wire `server.ts` and `index.ts`**

In `app/server/services/user-store.ts` add (import `Owner` from `../types`):

```typescript
async listOwners(): Promise<Owner[]> {
  const rows = await this.prisma.user.findMany({
    select: { id: true, username: true },
    orderBy: { username: 'asc' },
  });
  return rows.map((r) => ({ userId: r.id, username: r.username }));
}
```

In `app/server/server.ts`: `createUsersRouter(userStore, config.username, config.booksDir)`.

In `app/server/index.ts`, replace the startup scan block:

```typescript
// Startup scan: per user — create missing folders, import untracked EPUBs,
// clean up stale DB entries.
try {
  const owners = await userStore.listOwners();
  let imported = 0;
  let removed = 0;
  for (const owner of owners) {
    fs.mkdirSync(path.join(config.booksDir, owner.username), { recursive: true });
    const scanResult = await bookStore.scan(owner);
    imported += scanResult.imported.length;
    removed += scanResult.removed.length;
  }
  log.info(`Startup scan (${owners.length} user(s)): ${imported} imported, ${removed} removed`);
} catch (err: unknown) {
  log.error(`Startup scan failed: ${err instanceof Error ? err.message : String(err)}`);
}
```

- [ ] **Step 12: Update server tests**

General sweep, applied to `book-store.test.ts`, `ui.test.ts`, `opds.test.ts`, `kosync.test.ts`, `users.test.ts`, `thumbnail-queue.test.ts`:

1. **Test owners.** Where tests construct a `BookStore`, create a user first and define an owner. Pattern for `book-store.test.ts` setup:

```typescript
import { Owner } from '../types';

const OWNER: Owner = { userId: 'usr_test000000000000000', username: 'alice' };

// in beforeEach, after runMigrations:
await prisma.user.create({ data: { id: OWNER.userId, username: OWNER.username } });
booksDir = path.join(tmpRoot, OWNER.username); // per-user folder used by stage()/assertions
```

   Then mechanically add the owner argument to every BookStore call:
   `bookStore.listBooks()` → `bookStore.listBooks(OWNER)`, `bookStore.addBook(id, …)` → `bookStore.addBook(OWNER, id, …)`, `bookStore.scan()` → `bookStore.scan(OWNER)`, `bookStore.getCover(id)` → `bookStore.getCover(OWNER.userId, id)`, `bookStore.saveThumbnail(bookId, …)` → `bookStore.saveThumbnail(OWNER.userId, bookId, …)`, `bookStore.getThumbnail(bookId, w)` → `bookStore.getThumbnail(OWNER.userId, bookId, w)`, `bookStore.resolveBookId(id)` → `bookStore.resolveBookId(OWNER.userId, id)`, and so on for every method. On-disk assertions move from `<booksDir>/<id>.epub` to `<booksDir>/<username>/<id>.epub` where the test previously treated `booksDir` as the flat library.

2. **Route tests** (`ui.test.ts`): regular-user sessions exercise their own library exactly as before (no URL changes). Admin-session tests for book routes must add `?user=<username>`; tests that asserted admin-only 403s for regular users on delete/scan/metadata/lineage flip to asserting success on the user's own library.

3. **New authorization tests** in `ui.test.ts` (full code — adapt agent/login helpers to the file's existing pattern):

```typescript
describe('per-user library authorization', () => {
  it('user A cannot see user B's book', async () => {
    // aliceAgent uploaded FIXTURE_EPUB earlier in setup; bobAgent is a second logged-in user
    const res = await bobAgent.get(`/api/books/${aliceBookId}`);
    expect(res.status).toBe(404);
  });

  it('user A cannot delete user B's book', async () => {
    const res = await bobAgent.delete(`/api/books/${aliceBookId}`);
    expect(res.status).toBe(404);
  });

  it('non-admin sending ?user= gets 403', async () => {
    const res = await bobAgent.get('/api/books?user=alice');
    expect(res.status).toBe(403);
  });

  it('admin without ?user= gets 400', async () => {
    const res = await adminAgent.get('/api/books');
    expect(res.status).toBe(400);
  });

  it('admin with ?user= operates on the target library', async () => {
    const res = await adminAgent.get('/api/books?user=alice');
    expect(res.status).toBe(200);
    expect(res.body.map((b: { id: string }) => b.id)).toContain(aliceBookId);
  });

  it('admin targeting an unknown user gets 404', async () => {
    const res = await adminAgent.get('/api/books?user=nobody');
    expect(res.status).toBe(404);
  });

  it('two users can own the same epub without conflict', async () => {
    // upload the same fixture as bob that alice already owns
    const res = await bobAgent
      .post('/api/books/upload')
      .attach('files', FIXTURE_EPUB, 'same-book.epub');
    expect(res.status).toBe(200);
  });
});
```

4. **OPDS tests** (`opds.test.ts`): seed two users with distinct books; assert each user's feed contains only their own books and that downloading the other user's book ID returns 404.

5. **Thumbnail queue tests** (`thumbnail-queue.test.ts`): `enqueue(bookId)` → `enqueue(OWNER.userId, bookId)`; mock/spy expectations for `getCover`/`saveThumbnail` gain the leading `userId` argument; `getMissingThumbnailPairs` stub values gain `userId`.

- [ ] **Step 13: Full verification and the single commit**

Run: `npm test` (from repo root) — expected: all suites pass.
Run: `npm run lint` — expected: clean.

```bash
git add -A
git commit -m "feat: per-user libraries — owner-scoped book store, routes, and data migration"
```

---

### Task 5: Legacy-upgrade migration tests

**Files:**
- Create: `app/server/db/migrate.test.ts`

- [ ] **Step 1: Write the tests**

The test builds a *legacy-shaped* database with raw SQL (the pre-0005 schema: flat `books` PK `id`, global `book_id_history`, modern `users`/`progress`), puts flat epub files in a temp books dir, then runs `runMigrations` and asserts the per-user end state. Follow `book-store.test.ts` for the PrismaClient + better-sqlite3 adapter setup in a temp dir.

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { runMigrations } from './migrate';
import { createPrismaClient } from './client';

jest.mock('../logger');

describe('data_v11_per_user_libraries', () => {
  let tmpDir: string;
  let booksDir: string;
  let prisma: PrismaClient;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
    booksDir = path.join(tmpDir, 'books');
    fs.mkdirSync(booksDir, { recursive: true });
    prisma = createPrismaClient(`file:${path.join(tmpDir, 'db.sqlite')}`);
  });

  afterEach(async () => {
    await prisma.$disconnect();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Builds the pre-per-user schema and marks all earlier migrations applied. */
  async function seedLegacyDb(opts: {
    users: Array<{ id: string; username: string }>;
    bookIds: string[];
  }): Promise<void> {
    // Minimal legacy schema (post-0004, pre-0005 shape)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "books" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "title" TEXT NOT NULL,
        "file_as" TEXT NOT NULL DEFAULT '',
        "author" TEXT NOT NULL DEFAULT '',
        "description" TEXT NOT NULL DEFAULT '',
        "publisher" TEXT NOT NULL DEFAULT '',
        "series" TEXT NOT NULL DEFAULT '',
        "series_index" REAL NOT NULL DEFAULT 0,
        "identifiers" TEXT NOT NULL DEFAULT '[]',
        "subjects" TEXT NOT NULL DEFAULT '[]',
        "cover_data" BLOB,
        "cover_mime" TEXT,
        "size" INTEGER NOT NULL,
        "mtime" REAL NOT NULL,
        "added_at" REAL NOT NULL,
        "chapter_count" INTEGER NOT NULL DEFAULT 0,
        "chapter_spine_map" TEXT NOT NULL DEFAULT '[]',
        "chapter_names" TEXT,
        "page_count" INTEGER NOT NULL DEFAULT 0
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "book_thumbnails" (
        "book_id" TEXT NOT NULL,
        "width" INTEGER NOT NULL,
        "data" BLOB NOT NULL,
        "mime" TEXT NOT NULL,
        PRIMARY KEY ("book_id", "width")
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "book_id_history" (
        "old_id" TEXT NOT NULL PRIMARY KEY,
        "current_id" TEXT NOT NULL,
        "timestamp" REAL NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        "type" TEXT NOT NULL DEFAULT 'edit'
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "users" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "username" TEXT NOT NULL,
        "password_hash" TEXT,
        "sync_password" TEXT,
        "must_change_password" BOOLEAN NOT NULL DEFAULT 0
      )
    `);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX "users_username_key" ON "users"("username")`
    );
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "progress" (
        "user_id" TEXT NOT NULL,
        "document" TEXT NOT NULL,
        "progress" TEXT NOT NULL,
        "percentage" REAL NOT NULL,
        "device" TEXT NOT NULL,
        "device_id" TEXT NOT NULL,
        "timestamp" INTEGER NOT NULL,
        PRIMARY KEY ("user_id", "document")
      )
    `);
    // Mark every migration up to and including split_password_fields/must_change_password
    // as applied so runMigrations only runs 0005 + the data migrations.
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "_prisma_migrations" (
        id TEXT NOT NULL PRIMARY KEY, checksum TEXT NOT NULL, finished_at DATETIME,
        migration_name TEXT NOT NULL, logs TEXT, rolled_back_at DATETIME,
        started_at DATETIME NOT NULL DEFAULT current_timestamp,
        applied_steps_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    const applied = [
      '0000_baseline',
      '0001_add_book_id_history',
      '0002_add_book_id_history_timestamp',
      '0003_add_book_id_history_type',
      '0004_add_user_id',
      '20260609100450_split_password_fields',
      '20260610120000_add_must_change_password',
      'data_v10_user_surrogate_id',
      'data_v2_book_ids',
      'data_v8_page_count',
      'data_v9_chapter_data',
    ];
    for (const name of applied) {
      await prisma.$executeRaw`
        INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count)
        VALUES (${crypto.randomUUID()}, '', ${name}, current_timestamp, 1)
      `;
    }

    for (const u of opts.users) {
      await prisma.$executeRaw`INSERT INTO users (id, username) VALUES (${u.id}, ${u.username})`;
    }
    for (const id of opts.bookIds) {
      await prisma.$executeRaw`
        INSERT INTO books (id, title, size, mtime, added_at) VALUES (${id}, ${'Book ' + id}, 1, 0, 0)
      `;
      fs.writeFileSync(path.join(booksDir, id + '.epub'), 'epub-' + id);
    }
  }

  it('copies every book to every user and removes the flat files', async () => {
    await seedLegacyDb({
      users: [
        { id: 'u1', username: 'alice' },
        { id: 'u2', username: 'bob' },
      ],
      bookIds: ['a'.repeat(32), 'b'.repeat(32)],
    });

    await runMigrations(prisma, booksDir);

    for (const username of ['alice', 'bob']) {
      for (const id of ['a'.repeat(32), 'b'.repeat(32)]) {
        expect(fs.existsSync(path.join(booksDir, username, id + '.epub'))).toBe(true);
      }
    }
    expect(fs.existsSync(path.join(booksDir, 'a'.repeat(32) + '.epub'))).toBe(false);
    expect(fs.existsSync(path.join(booksDir, 'b'.repeat(32) + '.epub'))).toBe(false);

    const rows = await prisma.$queryRaw<Array<{ user_id: string; id: string }>>`
      SELECT user_id, id FROM books ORDER BY user_id, id
    `;
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.user_id))).toEqual(new Set(['u1', 'u2']));
  });

  it('renames filesystem-unsafe usernames with a deduplicating suffix', async () => {
    await seedLegacyDb({
      users: [
        { id: 'u1', username: 'bad name' },
        { id: 'u2', username: 'bad-name' },
      ],
      bookIds: [],
    });

    await runMigrations(prisma, booksDir);

    const users = await prisma.$queryRaw<Array<{ id: string; username: string }>>`
      SELECT id, username FROM users ORDER BY id
    `;
    expect(users.find((u) => u.id === 'u2')!.username).toBe('bad-name'); // already valid
    expect(users.find((u) => u.id === 'u1')!.username).toBe('bad-name-2'); // sanitized + deduped
  });

  it('deletes legacy files when zero users exist', async () => {
    await seedLegacyDb({ users: [], bookIds: ['c'.repeat(32)] });

    await runMigrations(prisma, booksDir);

    expect(fs.existsSync(path.join(booksDir, 'c'.repeat(32) + '.epub'))).toBe(false);
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM books`;
    expect(rows).toHaveLength(0);
  });

  it('does not run twice', async () => {
    await seedLegacyDb({ users: [{ id: 'u1', username: 'alice' }], bookIds: ['d'.repeat(32)] });
    await runMigrations(prisma, booksDir);
    await runMigrations(prisma, booksDir); // second run must be a no-op
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM books`;
    expect(rows).toHaveLength(1);
  });
});
```

Add `import * as crypto from 'crypto';` at the top.

- [ ] **Step 2: Run the tests**

Run: `npx jest db/migrate.test.ts` (from `app/server`)
Expected: PASS (the migration was implemented in Task 4; if any test fails, fix `data_v11_per_user_libraries`, not the test, unless the test contradicts the spec)

- [ ] **Step 3: Lint and commit**

Run: `npm run lint`

```bash
git add app/server/db/migrate.test.ts
git commit -m "test: cover per-user library data migration upgrade paths"
```

---

### Task 6: Client — library-target provider

**Files:**
- Create: `app/client/src/provider/library-target/context.ts`
- Create: `app/client/src/provider/library-target/provider.tsx`
- Create: `app/client/src/provider/library-target/index.ts`
- Create: `app/client/src/provider/library-target/hook/use-library-target.ts`
- Create: `app/client/src/provider/library-target/hook/use-with-target-user.ts`
- Create: `app/client/src/provider/library-target/hook/index.ts`
- Create: `app/client/src/provider/library-target/hook/use-with-target-user.test.tsx`
- Modify: `app/client/src/App.tsx`

- [ ] **Step 1: Write the failing hook test**

Follow the rendering conventions in `app/client/src/test-utils.tsx` (wrap with providers; mock `/api/me` the way existing provider tests do):

```tsx
// app/client/src/provider/library-target/hook/use-with-target-user.test.tsx
import { renderHook, act } from '@testing-library/react';
import { type ReactNode } from 'react';

import { AuthProvider } from '~/provider/auth';
import { LibraryTargetProvider } from '~/provider/library-target';

import { useLibraryTarget } from './use-library-target';
import { useWithTargetUser } from './use-with-target-user';

const wrapper = ({ children }: { children: ReactNode }) => (
  <AuthProvider>
    <LibraryTargetProvider>{children}</LibraryTargetProvider>
  </AuthProvider>
);

const mockMe = (isAdmin: boolean) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ username: 'x', isAdmin, mustChangePassword: false }),
    })
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('returns URLs unchanged for non-admin users', async () => {
  mockMe(false);
  const { result } = renderHook(
    () => ({ withTarget: useWithTargetUser(), target: useLibraryTarget() }),
    { wrapper }
  );
  await act(async () => {
    result.current.target[1]('alice');
  });
  expect(result.current.withTarget('/api/books')).toBe('/api/books');
});

it('appends ?user= for admins with a target selected', async () => {
  mockMe(true);
  const { result } = renderHook(
    () => ({ withTarget: useWithTargetUser(), target: useLibraryTarget() }),
    { wrapper }
  );
  await act(async () => {
    result.current.target[1]('alice');
  });
  expect(result.current.withTarget('/api/books')).toBe('/api/books?user=alice');
  expect(result.current.withTarget('/api/books/x/cover?width=60')).toBe(
    '/api/books/x/cover?width=60&user=alice'
  );
});

it('persists the target in localStorage', async () => {
  mockMe(true);
  const { result } = renderHook(() => useLibraryTarget(), { wrapper });
  await act(async () => {
    result.current[1]('bob');
  });
  expect(localStorage.getItem('library-target-user')).toBe('bob');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/provider/library-target` (from `app/client`)
Expected: FAIL — modules don't exist

- [ ] **Step 3: Implement the provider and hooks**

```typescript
// app/client/src/provider/library-target/context.ts
import { createContext } from 'react';

export type LibraryTargetContext = {
  /** Username of the library an admin is operating on; undefined = none selected. */
  targetUsername: string | undefined;
  setTargetUsername: (username: string | undefined) => void;
};

export const Context = createContext<LibraryTargetContext>({
  targetUsername: undefined,
  setTargetUsername: () => undefined,
});
```

```tsx
// app/client/src/provider/library-target/provider.tsx
import { type ReactNode, useCallback, useMemo, useState } from 'react';

import { Context } from './context';

const STORAGE_KEY = 'library-target-user';

export type LibraryTargetProviderProps = { children: ReactNode };
export const LibraryTargetProvider = ({ children }: LibraryTargetProviderProps) => {
  const [targetUsername, setTargetUsernameRaw] = useState<string | undefined>(
    () => localStorage.getItem(STORAGE_KEY) ?? undefined
  );

  const setTargetUsername = useCallback((username: string | undefined) => {
    if (username === undefined) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, username);
    }
    setTargetUsernameRaw(username);
  }, []);

  const state = useMemo(
    () => ({ targetUsername, setTargetUsername }),
    [targetUsername, setTargetUsername]
  );

  return <Context.Provider value={state}>{children}</Context.Provider>;
};
```

```typescript
// app/client/src/provider/library-target/hook/use-library-target.ts
import { useContext } from 'react';

import { Context } from '../context';

export type UseLibraryTarget = [string | undefined, (username: string | undefined) => void];

export const useLibraryTarget = (): UseLibraryTarget => {
  const { targetUsername, setTargetUsername } = useContext(Context);
  return [targetUsername, setTargetUsername];
};
```

```typescript
// app/client/src/provider/library-target/hook/use-with-target-user.ts
import { useCallback, useContext } from 'react';

import { useIsAdmin } from '~/provider/auth';

import { Context } from '../context';

export type WithTargetUser = (url: string) => string;

/**
 * Returns a function that appends ?user=<target> to book API URLs when an
 * admin has a library selected. For regular users it returns URLs unchanged —
 * the server scopes requests to their own library.
 */
export const useWithTargetUser = (): WithTargetUser => {
  const [isAdmin] = useIsAdmin();
  const { targetUsername } = useContext(Context);

  return useCallback(
    (url: string) => {
      if (!isAdmin || !targetUsername) return url;
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}user=${encodeURIComponent(targetUsername)}`;
    },
    [isAdmin, targetUsername]
  );
};
```

```typescript
// app/client/src/provider/library-target/hook/index.ts
export * from './use-library-target';
export * from './use-with-target-user';
```

```typescript
// app/client/src/provider/library-target/index.ts
export * from './context';
export * from './provider';
export * from './hook';
```

In `app/client/src/App.tsx`, add the provider between `AuthProvider` and `UserProvider`:

```tsx
import { LibraryTargetProvider } from './provider/library-target';

const ProvidersTree = buildProvidersTree([
  [ThemeProvider],
  [AuthProvider],
  [LibraryTargetProvider],
  [UserProvider],
  [BookProvider],
  [ProgressProvider],
]);
```

- [ ] **Step 4: Run tests, lint**

Run: `npx vitest run src/provider/library-target` then `npm run lint`
Expected: PASS, clean

- [ ] **Step 5: Commit**

```bash
git add app/client/src/provider/library-target app/client/src/App.tsx
git commit -m "feat: add library-target provider for admin library switching"
```

---

### Task 7: Client — thread the target through all book API calls

**Files (each gets `const withTargetUser = useWithTargetUser();` and wraps its URL):**
- Modify: `app/client/src/provider/book/hook/use-fetch-book-list.ts:25`
- Modify: `app/client/src/provider/book/hook/use-fetch-book.ts` (fetch of `/api/books/:id`)
- Modify: `app/client/src/provider/book/hook/use-delete-book.ts`
- Modify: `app/client/src/provider/book/hook/use-scan-library.ts:39`
- Modify: `app/client/src/provider/book/hook/use-patch-book-metadata.ts`
- Modify: `app/client/src/provider/book/hook/use-regen-chapters.ts`
- Modify: `app/client/src/provider/book/hook/use-book-lineage.ts`
- Modify: `app/client/src/provider/book/hook/use-unlink-book-lineage.ts`
- Modify: `app/client/src/provider/book/hook/use-upload-book-list.ts:41`
- Modify: `app/client/src/provider/book/hook/use-upload-queue.ts:128`
- Modify: `app/client/src/provider/progress/hook/use-link-progress.ts:32`
- Modify: `app/client/src/component/cover/index.tsx:15-16`
- Modify: `app/client/src/component/book-row/index.tsx:66`
- Modify: `app/client/src/page/book/index.tsx:108`

- [ ] **Step 1: Apply the wrap in every fetch hook**

The transformation is identical everywhere. Import and instantiate the hook at the top of each hook/component body:

```typescript
import { useWithTargetUser } from '~/provider/library-target';
// inside the hook/component:
const withTargetUser = useWithTargetUser();
```

Exact URL replacements (add `withTargetUser` to the enclosing `useCallback`/`useMemo` dependency arrays):

| File | Old | New |
|---|---|---|
| use-fetch-book-list.ts | `fetch('/api/books')` | `fetch(withTargetUser('/api/books'))` |
| use-fetch-book.ts | `` fetch(`/api/books/${encodeURIComponent(id)}`) `` | `` fetch(withTargetUser(`/api/books/${encodeURIComponent(id)}`)) `` |
| use-delete-book.ts | `` fetch(`/api/books/${encodeURIComponent(bookId)}`, … `` | `` fetch(withTargetUser(`/api/books/${encodeURIComponent(bookId)}`), … `` |
| use-scan-library.ts | `fetch('/api/books/scan', { method: 'POST' })` | `fetch(withTargetUser('/api/books/scan'), { method: 'POST' })` |
| use-patch-book-metadata.ts | `` …/metadata`, … `` | wrap the whole template string with `withTargetUser(…)` |
| use-regen-chapters.ts | `` …/regen-chapters`, … `` | wrap with `withTargetUser(…)` |
| use-book-lineage.ts | `` …/lineage`) `` | wrap with `withTargetUser(…)` |
| use-unlink-book-lineage.ts | `` …/link/${…}`, … `` | wrap with `withTargetUser(…)` |
| use-upload-book-list.ts | `fetch('/api/books/upload', …)` | `fetch(withTargetUser('/api/books/upload'), …)` |
| use-upload-queue.ts | `xhr.open('POST', '/api/books/upload')` | `xhr.open('POST', withTargetUser('/api/books/upload'))` |
| use-link-progress.ts | `` fetch(`/api/books/${encodeURIComponent(bookId)}/link`, … `` | wrap with `withTargetUser(…)` |
| component/cover/index.tsx | both cover URL branches | wrap each with `withTargetUser(…)` |
| component/book-row/index.tsx | img `src={…}` | `src={withTargetUser(…)}` |
| page/book/index.tsx | img `src={…}` | `src={withTargetUser(…)}` |

(Adjust the "Old" column to the file's actual line if it differs slightly — the rule is: every URL beginning `/api/books` gets wrapped.)

- [ ] **Step 2: Skip fetching when an admin has no target**

In `use-fetch-book-list.ts`, an admin with no selected library must not fire a request (it would 400). At the top of the returned callback add:

```typescript
if (isAdmin && !targetUsername) return;
```

with:

```typescript
import { useIsAdmin } from '~/provider/auth';
import { useLibraryTarget } from '~/provider/library-target';
// inside the hook:
const [isAdmin] = useIsAdmin();
const [targetUsername] = useLibraryTarget();
```

(add both to the dependency array).

- [ ] **Step 3: Refetch when the target changes**

Find where the book list is initially fetched (the consumer calling `useFetchBookList` on mount — check `use-book-list.ts`). Switching libraries must mark the list unfetched and refetch. Use a previous-value ref so all dependencies stay in the array (repo rule: never `eslint-disable` react-hooks rules — restructure instead):

```typescript
const [targetUsername] = useLibraryTarget();
const prevTargetRef = useRef(targetUsername);
useEffect(() => {
  if (prevTargetRef.current === targetUsername) return;
  prevTargetRef.current = targetUsername;
  setBookListFetched(false);
  fetchBookList();
}, [targetUsername, fetchBookList, setBookListFetched]);
```

Adapt to the file's existing effect structure — the requirement: changing `targetUsername` marks the list unfetched and triggers exactly one refetch, with no lint suppressions.

- [ ] **Step 4: Run client tests, fix fallout**

Run: `npm test -w app/client`
Existing hook tests mock `fetch` and assert URLs; where they now run under a default (non-admin) auth context the URLs are unchanged and tests should pass. Wrap any failing test renders with `LibraryTargetProvider` (add it to `test-utils.tsx` if the shared render helper exists there).

- [ ] **Step 5: Lint and commit**

Run: `npm run lint`

```bash
git add app/client/src
git commit -m "feat: thread admin library target through book API calls"
```

---

### Task 8: Client — header library switcher + library page prompt

**Files:**
- Create: `app/client/src/component/library-switcher/index.tsx`
- Create: `app/client/src/component/library-switcher/style.ts`
- Create: `app/client/src/component/library-switcher/index.test.tsx`
- Modify: `app/client/src/component/header/index.tsx`
- Modify: `app/client/src/component/index.ts` (export)
- Modify: `app/client/src/page/library/index.tsx`

- [ ] **Step 1: Write the failing switcher test**

```tsx
// app/client/src/component/library-switcher/index.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Follow the mocking pattern used by existing component tests (see
// component/header or page/user tests) to provide: an admin auth context,
// a user list [{ username: 'alice' }, { username: 'bob' }], and the
// LibraryTargetProvider.

import { LibrarySwitcher } from '.';

it('renders nothing for non-admin users', () => {
  renderAsUser(<LibrarySwitcher />); // non-admin render helper
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});

it('lists users and selects a target library', async () => {
  renderAsAdmin(<LibrarySwitcher />);
  const select = await screen.findByRole('combobox');
  await userEvent.selectOptions(select, 'alice');
  expect(localStorage.getItem('library-target-user')).toBe('alice');
});
```

(Concretize `renderAsUser`/`renderAsAdmin` with the project's existing test-utils auth mocking.)

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run src/component/library-switcher` — Expected: FAIL (module missing)

- [ ] **Step 3: Implement the switcher**

```tsx
// app/client/src/component/library-switcher/index.tsx
import { useIsAdmin } from '~/provider/auth';
import { useLibraryTarget } from '~/provider/library-target';
import { useUserList } from '~/provider/user';

import { useStyle } from './style';

export const LibrarySwitcher = () => {
  const styles = useStyle();
  const [isAdmin] = useIsAdmin();
  const [targetUsername, setTargetUsername] = useLibraryTarget();
  const [userList] = useUserList();

  if (!isAdmin) {
    return null;
  }

  return (
    <select
      className={styles.root}
      aria-label="Library"
      value={targetUsername ?? ''}
      onChange={(e) => setTargetUsername(e.target.value || undefined)}
    >
      <option value="">Select library…</option>
      {(userList ?? []).map((user) => (
        <option key={user.username} value={user.username}>
          {user.username}
        </option>
      ))}
    </select>
  );
};
```

(Check `useUserList`'s actual return shape in `app/client/src/provider/user/hook/use-user-list.ts` and adapt; if the list isn't fetched on mount outside the user-list page, call its fetch function in an effect here.)

`style.ts`: follow any existing small control style (e.g. `control/switch/style.ts`) — a compact select styled to the header; content not behavior, keep minimal.

- [ ] **Step 4: Mount it in the header**

In `app/client/src/component/header/index.tsx`, render `<LibrarySwitcher />` inside the nav, after the navigation-item container:

```tsx
import { LibrarySwitcher } from '~/component/library-switcher';
// inside <nav className={styles.navigation}> after the item container div:
<LibrarySwitcher />
```

(If `~/component` barrel imports would create a cycle, import directly as shown.) Add `export * from './library-switcher';` to `app/client/src/component/index.ts`.

- [ ] **Step 5: Library page prompt for admins without a selection**

In `app/client/src/page/library/index.tsx`:

```tsx
import { useIsAdmin } from '~/provider/auth';
import { useLibraryTarget } from '~/provider/library-target';
// inside LibraryPage, before the existing return:
const [isAdmin] = useIsAdmin();
const [targetUsername] = useLibraryTarget();

if (isAdmin && !targetUsername) {
  return (
    <Page>
      <div className={style.emptyState}>
        <div className={style.emptyStateTitle}>Select a library</div>
        <div className={style.emptyStateSubtitle}>
          Choose a user from the library selector in the header to view and manage their books
        </div>
      </div>
    </Page>
  );
}
```

- [ ] **Step 6: Run tests, lint, commit**

Run: `npm test -w app/client` then `npm run lint`
Expected: PASS, clean

```bash
git add app/client/src
git commit -m "feat: add admin library switcher and library page prompt"
```

---

### Task 9: Client — ownership affordances replace admin gating

**Files:**
- Modify: `app/client/src/control/delete-book-button/index.tsx` (remove lines using `useIsAdmin`, ~21 and ~45)
- Modify: `app/client/src/control/regen-chapters-button/index.tsx` (~13, ~20)
- Modify: `app/client/src/control/unlink-book-lineage-button/index.tsx` (~27, ~50)
- Modify: `app/client/src/page/book/index.tsx` (~146, ~152)
- Modify: `app/client/src/page/upload/index.tsx` (~24)
- Modify: affected colocated tests

- [ ] **Step 1: Remove the gates**

1. In each of the three controls (`delete-book-button`, `regen-chapters-button`, `unlink-book-lineage-button`): delete the `useIsAdmin` import/call and the `if (!isAdmin) { return null; }` block.
2. In `page/book/index.tsx`: change `{isAdmin && (<BookLineageCard …/>)}` and `{isAdmin && (<div className={styles.buttonContainer}>…</div>)}` to render unconditionally (remove the `isAdmin &&` wrapper, keep the JSX). Keep `!isAdmin` on the progress metadata and the "Set progress" button (the admin account has no reading state). Remove the `useIsAdmin` call only if no longer referenced.
3. In `page/upload/index.tsx`: remove `isAdmin &&` around the `LibraryScan` row (every user can scan their own library) and drop the now-unused `useIsAdmin`.
4. `page/series/index.tsx` keeps its `!isAdmin` progress gating unchanged. The header's Users link stays admin-only.

- [ ] **Step 2: Update affected tests**

Tests asserting these controls are hidden for non-admins now assert the opposite. Find them: `npx vitest run src/control src/page` and fix each failure: non-admin renders now show delete/regen/unlink/edit affordances and the scan row; assertions that admin sees them still hold (admins additionally need a selected target for the underlying calls — the controls themselves render regardless).

- [ ] **Step 3: Run full client suite, lint, commit**

Run: `npm test -w app/client` then `npm run lint`
Expected: PASS, clean

```bash
git add app/client/src
git commit -m "feat: expose book management to library owners"
```

---

### Task 10: Final verification

- [ ] **Step 1: Full test suite and lint from the repo root**

Run: `npm test` — Expected: all server + client suites pass
Run: `npm run lint` — Expected: clean
Run: `npm run build` — Expected: both workspaces build

- [ ] **Step 2: Spec compliance walk-through**

Re-read `docs/superpowers/specs/2026-06-10-per-user-libraries-design.md` section by section and verify each requirement maps to landed code (disk layout, username safety, schema, migration incl. zero-user deletion, owner-scoped store/routes, OPDS, KOSync resolveBookId, error handling, client switcher/affordances/localStorage, tests). Fix any gap found.

- [ ] **Step 3: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: final verification fixes for per-user libraries"
```

(Skip the commit if the tree is clean.)
