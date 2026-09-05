# Book Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reader asks the library admin for a book that isn't in Bookplate; the admin uploads the EPUB from the request row and the request closes itself.

**Architecture:** A new `BookRequest` Prisma model owned by a `User`, written through a `services/book-request.ts` function module and read through a new `schema/book-request/` Pothos module. One `User.bookRequests` connection serves the reader (via `Viewer.user`) and the admin (via `Query.user(id:)`). On the client, the session-wide upload provider gains per-item targeting and per-item request binding, so an admin can upload into a specific reader's library straight from the request row.

**Tech Stack:** TypeScript, Prisma + SQLite, Pothos (`@pothos/plugin-prisma` 4.15, `@pothos/plugin-relay` 4.7, `@pothos/plugin-scope-auth` 4.1), GraphQL, React 19, Apollo Client 4, vitest, zod.

**Spec:** `docs/superpowers/specs/2026-08-28-book-requests-design.md`

## Global Constraints

- **Resolver bodies contain no `try`, no `catch`, no `throw`.** `toResult` (`app/server/graphql/to-result.ts`) is the single boundary that turns known domain errors into union members.
- **Reads live in the schema; writes live in `services/*.ts`** as plain exported functions taking `prisma` as the first argument. Do not move writes into resolvers; do not reintroduce store classes.
- **Import `../x/model`, never `../x`,** inside schema model files — the entity index files side-effect-import mutations and close require cycles.
- **Plugin order in `builder.ts` is `RelayPlugin, ScopeAuthPlugin, PrismaPlugin`** and is load-bearing. Do not touch it.
- **Do not add `@pothos/plugin-errors` or `@pothos/plugin-validation`.** They were removed on purpose; every mutation parses its input with zod *inside* the resolver, after auth, and returns `InvalidInputError` as an ordinary union member.
- **Error and payload types are `builder.objectRef` over plain readonly data, never classes.**
- **`CONNECTION_LIMITS` rejects, never clamps.** Use `rejectOversizePage`.
- **No raw book id may appear anywhere under `app/client/src/provider/upload/`** — `bookGlobalId` only. This is an existing documented constraint on `TransportItem`.
- **`MAX_OPEN_BOOK_REQUESTS = 10`, a module constant.** Not a config option.
- **Enum members are SCREAMING_CASE with a lowercase `value:`**, `satisfies`-checked against the TS union.
- **`app/server/graphql/schema.generated.graphql` is checked in** and asserted by `print-schema.test.ts`. Regenerate deliberately with `npm run graphql:schema -w app/server` in the same commit as the schema change, and say so in the commit message.
- **Client documents use literal page sizes**, never a variable `first`/`last` — a variable prices at the field's `maxSize` in the cost budget.
- Verification, all three green before any task is offered as done:
  ```
  npm run lint
  npm test
  npm run test:cost -w app/server
  ```

---

## File Structure

**Server — created**

| File | Responsibility |
| --- | --- |
| `app/server/prisma/migrations/20260830000000_add_book_requests/migration.sql` | Deliberate no-op. The real DDL cannot run here; see Task 1. |
| `app/server/services/book-request.ts` | Every write, the cap constant, the pure `dedupeKey`, the `BookRequestStatus` union. |
| `app/server/services/book-request.test.ts` | Service tests. |
| `app/server/graphql/schema/book-request-status/model.ts` + `index.ts` | The `BookRequestStatus` enum. |
| `app/server/graphql/schema/book-request/model.ts` | The `BookRequest` prismaNode and the `requestKeyset` helper. |
| `app/server/graphql/schema/book-request/index.ts` | Re-exports the model, side-effect-imports the mutations. |
| `app/server/graphql/schema/book-request/model.test.ts` | Node scope, connection, keyset, `pendingBookRequestCount`. |
| `app/server/graphql/schema/book-request/mutation/{create,fulfill,decline,delete}.ts` + `.test.ts` | One mutation per file. |
| `app/server/graphql/schema/book-request-limit-exceeded-error/model.ts` | Error ref. |
| `app/server/graphql/schema/duplicate-book-request-error/model.ts` | Error ref. |
| `app/server/graphql/schema/book-request-not-pending-error/model.ts` | Error ref. |

**Server — modified**

| File | Change |
| --- | --- |
| `app/server/prisma/schema.prisma` | The `BookRequest` model; back-relations on `User` and `Book`. |
| `app/server/db/migrate.ts` | `data_v18_book_requests`. |
| `app/server/db/migrate.test.ts` | Asserts the table exists. |
| `app/server/graphql/schema/pagination.ts` | `CONNECTION_LIMITS.userBookRequests`. |
| `app/server/graphql/schema/user/model.ts` | `bookRequests` connection, `pendingBookRequestCount`. |
| `app/server/graphql/schema/index.ts` | Registers the two new entity directories. |
| `app/server/graphql/test-util.ts` | A `seedNodeFor('BookRequest')` branch — **mandatory**, or the generic node-scope suite throws. |
| `app/server/graphql/schema.generated.graphql` | Regenerated. |

**Client — created**

| File | Responsibility |
| --- | --- |
| `app/client/src/component/book-requests/index.tsx` + `style.ts` | The reader's `Card` on `/user`, with the count subtitle. |
| `app/client/src/component/book-requests-content/index.tsx` + `style.ts` + `index.test.tsx` | The reader's list + create form; owns its document. |
| `app/client/src/component/book-request-row/index.tsx` + `style.ts` + `index.test.tsx` | One request row, both readings (reader and admin). |
| `app/client/src/component/user-request-list/index.tsx` + `style.ts` + `index.test.tsx` | The admin's per-user list; owns its document. |
| `app/client/src/graphql/book-request.ts` | The shared fragment and the reader's documents. |

**Client — modified**

| File | Change |
| --- | --- |
| `app/client/src/provider/upload/hook/use-upload-transport.ts` | `AddFileOptions`, `targetUsername`, `fulfillsRequestId`, `onUploaded(libraryId)`. |
| `app/client/src/provider/upload/hook/use-upload-queue.ts` | Threads the options through; fires `bookRequestFulfill` once per item. |
| `app/client/src/provider/upload/context.ts` | The widened `addFiles` default. |
| `app/client/src/component/user-row-content/index.tsx` | Mounts `UserRequestList`. |
| `app/client/src/component/user-row/index.tsx` | The pending-count badge. |
| `app/client/src/page/user/index.tsx` | Mounts `BookRequests` in the non-admin branch. |
| `app/client/src/component/index.ts` | Exports the new components. |

---

## Design decisions this plan makes that the spec left to the implementer

Both are recorded here rather than buried in a task, because a reviewer should be able to reject them.

1. **Duplicate detection is scoped to `status: 'pending'`.** The spec says "reject duplicates" without qualifying. A *fulfilled* request means the book is already in the library, and a *declined* one is a wish the admin turned down — a reader may legitimately ask again in both cases. Only an open request blocks an identical open request.
2. **`fulfillBookRequest` runs in a transaction; `declineBookRequest` does not.** Fulfilment must validate a second row (the book) before writing, so read and write must be atomic together. Declining validates nothing else, so a single guarded `updateMany` is both atomic and one query.

---

## Task 1: Prisma model and migration

**Files:**
- Modify: `app/server/prisma/schema.prisma`
- Create: `app/server/prisma/migrations/20260830000000_add_book_requests/migration.sql`
- Modify: `app/server/db/migrate.ts` (append after `data_v17_validation`, at the end of the data-migration sequence)
- Test: `app/server/db/migrate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the `bookRequest` Prisma delegate with compound key `userId_id`, the compound unique `userId_createdAt_id`, and relations `user`, `book`.

**Why the DDL migration is a no-op — read this before writing it.** `book_requests` carries a composite foreign key to `books(user_id, id)`. That key only becomes a valid target once the `data_v11_per_user_libraries` data migration rebuilds `books` with a composite primary key, and plain DDL migrations run *before* any data migration. Creating the table in the SQL file would raise SQLite's `foreign key mismatch` on any real upgrade from an old install. `pending_fixes` (`20260725000000_add_pending_fixes`) and the validation tables (`20260726120000_add_validation_tables`) are both no-ops for exactly this reason and create their tables in `migrate.ts` instead. Follow that pattern; do not "fix" the no-op.

- [ ] **Step 1: Add the model to `schema.prisma`**

```prisma
model BookRequest {
  userId        String  @map("user_id")
  id            String
  title         String
  author        String
  note          String  @default("")
  status        String  @default("pending")
  declineReason String  @default("") @map("decline_reason")
  dedupeKey     String  @map("dedupe_key")
  createdAt     Float   @default(dbgenerated("strftime('%s','now') * 1000")) @map("created_at")
  resolvedAt    Float?  @map("resolved_at")
  bookUserId    String? @map("book_user_id")
  bookId        String? @map("book_id")

  user User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  // `onUpdate: Cascade`, matching `PendingFix`: a book id is a content hash and
  // rotates whenever the EPUB is rewritten (accepting a metadata fix does
  // exactly that), so a fulfilled request would otherwise point at a dead id.
  // `onDelete: SetNull`: a fulfilled request whose book is later deleted stays
  // fulfilled but loses its link, and the reader's card renders "added to your
  // library" without one rather than as an error.
  book Book? @relation(fields: [bookUserId, bookId], references: [userId, id], onDelete: SetNull, onUpdate: Cascade)

  @@id([userId, id])
  // EXISTS FOR THE CURSOR AND NOTHING ELSE — no query uses it as a lookup key.
  // `User.bookRequests` is a `t.prismaConnection`, and the plugin paginates by
  // SEEKING TO A ROW, which returns an empty page with `hasNextPage: false`
  // when that row has been deleted. Deleting a request is a first-class action
  // on both surfaces, so the resolver rebuilds a keyset predicate from the
  // cursor instead, and every column the page sorts on has to be inside the
  // cursor for that to work. `id` is the tiebreaker and is required, not
  // cosmetic: `created_at` defaults to whole seconds scaled by 1000, so two
  // requests made in the same second share a timestamp, and cursor pagination
  // needs a total order or a page boundary can repeat or skip a row. Same
  // device, same reason, as `@@unique([userId, timestamp, document])` on
  // `Progress`.
  @@unique([userId, createdAt, id])
  @@index([userId, status])
  @@index([userId, dedupeKey])
  @@map("book_requests")
}
```

Add the back-relations. In `model User`, beside `books`:

```prisma
  bookRequests       BookRequest[]
```

In `model Book`, beside `pendingFix`:

```prisma
  bookRequests    BookRequest[]
```

- [ ] **Step 2: Write the no-op DDL migration**

Create `app/server/prisma/migrations/20260830000000_add_book_requests/migration.sql`:

```sql
-- This migration is intentionally a no-op.
--
-- The book_requests table has a composite foreign key to books(user_id, id),
-- which only becomes a valid target once the data_v11_per_user_libraries data
-- migration rebuilds "books" with a composite primary key. Creating the table
-- here (during the plain DDL migration pass, which runs before any data
-- migration) would raise SQLite's "foreign key mismatch" error for databases
-- still on the pre-per-user-libraries schema.
--
-- The table is instead created by the data_v18_book_requests data migration in
-- migrate.ts, which runs after data_v11_per_user_libraries — mirroring
-- 20260725000000_add_pending_fixes and 20260726120000_add_validation_tables.
SELECT 1;
```

- [ ] **Step 3: Write the failing migration test**

Append to `app/server/db/migrate.test.ts`:

```ts
describe('data_v18_book_requests', () => {
  let tmpDir: string;
  let booksDir: string;
  let prisma: PrismaClient;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-req-'));
    booksDir = path.join(tmpDir, 'books');
    fs.mkdirSync(booksDir, { recursive: true });
    prisma = createPrismaClient(`file:${path.join(tmpDir, 'db.sqlite')}`);
  });

  afterEach(async () => {
    await prisma.$disconnect();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the book_requests table', async () => {
    await runMigrations(prisma, booksDir);
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='book_requests'`
    );
    expect(rows.map((r) => r.name)).toEqual(['book_requests']);
  });

  it('enforces the compound unique that backs the cursor', async () => {
    await runMigrations(prisma, booksDir);
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='book_requests'`
    );
    expect(rows.map((r) => r.name)).toContain('book_requests_user_id_created_at_id_key');
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run db/migrate.test.ts -t book_requests --root app/server`
Expected: FAIL — both assertions get `[]`, because nothing creates the table yet.

- [ ] **Step 5: Add the data migration**

In `app/server/db/migrate.ts`, immediately after the `data_v17_validation` block and inside the same function:

```ts
  // Data migration: create the book_requests table. Runs after
  // data_v11_per_user_libraries so the composite FK on (book_user_id, book_id)
  // is valid. The Prisma DDL migration (20260830000000_add_book_requests) is a
  // no-op; see its comment.
  await runDataMigration(prisma, 'data_v18_book_requests', async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "book_requests" (
        "user_id" TEXT NOT NULL,
        "id" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "author" TEXT NOT NULL,
        "note" TEXT NOT NULL DEFAULT '',
        "status" TEXT NOT NULL DEFAULT 'pending',
        "decline_reason" TEXT NOT NULL DEFAULT '',
        "dedupe_key" TEXT NOT NULL,
        "created_at" REAL NOT NULL DEFAULT (strftime('%s','now') * 1000),
        "resolved_at" REAL,
        "book_user_id" TEXT,
        "book_id" TEXT,
        PRIMARY KEY ("user_id", "id"),
        CONSTRAINT "book_requests_user_fkey" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "book_requests_book_fkey" FOREIGN KEY ("book_user_id", "book_id")
          REFERENCES "books" ("user_id", "id") ON DELETE SET NULL ON UPDATE CASCADE
      )
    `);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "book_requests_user_id_created_at_id_key"
         ON "book_requests" ("user_id", "created_at", "id")`
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "book_requests_user_id_status_idx"
         ON "book_requests" ("user_id", "status")`
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "book_requests_user_id_dedupe_key_idx"
         ON "book_requests" ("user_id", "dedupe_key")`
    );
  });
```

- [ ] **Step 6: Regenerate the Prisma client and run the test**

Run: `npx prisma generate --schema app/server/prisma/schema.prisma`
Then: `npx vitest run db/migrate.test.ts -t book_requests --root app/server`
Expected: PASS, both.

- [ ] **Step 7: Full verification**

Run: `npm run lint && npm test`
Expected: exit 0 for both. No SDL change yet — nothing is exposed in GraphQL.

- [ ] **Step 8: Commit**

```bash
git add app/server/prisma app/server/db
git commit -m "feat(server): add the book_requests table

The DDL migration is a no-op and the table is created by
data_v18_book_requests, for the same reason pending_fixes and the validation
tables are: a composite FK to books(user_id, id) is only a valid target after
data_v11_per_user_libraries rebuilds that table's primary key, and DDL
migrations run first.

The compound unique on (user_id, created_at, id) exists for the connection
cursor and nothing else; created_at is whole seconds scaled, so id is a
required tiebreaker rather than a cosmetic one."
```

---

## Task 2: `dedupeKey` and `createBookRequest`

**Files:**
- Create: `app/server/services/book-request.ts`
- Test: `app/server/services/book-request.test.ts`

**Interfaces:**
- Consumes: the `bookRequest` delegate from Task 1.
- Produces:
  ```ts
  export type BookRequestStatus = 'pending' | 'fulfilled' | 'declined';
  export const MAX_OPEN_BOOK_REQUESTS = 10;
  export const dedupeKey: (title: string, author: string) => string;
  export type BookRequestInput = { userId: string; title: string; author: string; note: string };
  export type CreateBookRequestOutcome =
    | { kind: 'created'; id: string }
    | { kind: 'limit'; limit: number }
    | { kind: 'duplicate'; existingId: string };
  export function createBookRequest(
    prisma: PrismaClient, input: BookRequestInput
  ): Promise<CreateBookRequestOutcome>;
  ```

**Why the outcomes are returned, not thrown.** `KNOWN_DOMAIN_ERROR_CLASSES` gains no members here and `toResult` is not involved. This codebase draws the line at whether the function decides the failure itself: `createUser` returns `false` on its P2002 race and `updateDevice` returns `null` on P2025, both with doc comments saying why, while `DeviceSlugConflictError` is thrown because it escapes from a Prisma call as an exception. The cap and the duplicate are decided by explicit reads inside this same function, so they are values.

- [ ] **Step 1: Write the failing tests**

Create `app/server/services/book-request.test.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from '../db/client';
import { runMigrations } from '../db/migrate';
import {
  createBookRequest,
  dedupeKey,
  MAX_OPEN_BOOK_REQUESTS,
} from './book-request';

vi.mock('../logger');

let tmpDir: string;
let prisma: PrismaClient;
const ALICE = 'user-alice';

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'book-request-'));
  const booksDir = path.join(tmpDir, 'books');
  fs.mkdirSync(booksDir, { recursive: true });
  prisma = createPrismaClient(`file:${path.join(tmpDir, 'db.sqlite')}`);
  await runMigrations(prisma, booksDir);
  await prisma.user.create({ data: { id: ALICE, username: 'alice' } });
});

afterEach(async () => {
  await prisma.$disconnect();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const input = (overrides: Partial<Parameters<typeof createBookRequest>[1]> = {}) => ({
  userId: ALICE,
  title: 'Dune',
  author: 'Frank Herbert',
  note: '',
  ...overrides,
});

describe('dedupeKey', () => {
  it('folds case, collapses whitespace, and trims', () => {
    expect(dedupeKey('  The   DUNE ', 'Frank  Herbert')).toBe('the dune\0frank herbert');
  });

  it('separates the halves so a title cannot impersonate an author', () => {
    expect(dedupeKey('a b', 'c')).not.toBe(dedupeKey('a', 'b c'));
  });
});

describe('createBookRequest', () => {
  it('creates a pending request and returns its id', async () => {
    const outcome = await createBookRequest(prisma, input());
    expect(outcome.kind).toBe('created');

    const rows = await prisma.bookRequest.findMany({ where: { userId: ALICE } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'Dune',
      author: 'Frank Herbert',
      status: 'pending',
      dedupeKey: 'dune\0frank herbert',
    });
  });

  it('rejects a second OPEN request for the same title and author, case-insensitively', async () => {
    const first = await createBookRequest(prisma, input());
    const second = await createBookRequest(prisma, input({ title: 'dune', author: 'FRANK HERBERT' }));

    expect(second).toEqual({
      kind: 'duplicate',
      existingId: first.kind === 'created' ? first.id : '',
    });
    expect(await prisma.bookRequest.count()).toBe(1);
  });

  it('allows re-requesting a book whose earlier request was declined', async () => {
    const first = await createBookRequest(prisma, input());
    if (first.kind !== 'created') throw new Error('setup failed');
    await prisma.bookRequest.update({
      where: { userId_id: { userId: ALICE, id: first.id } },
      data: { status: 'declined' },
    });

    const second = await createBookRequest(prisma, input());
    expect(second.kind).toBe('created');
  });

  it('accepts the 10th open request and refuses the 11th', async () => {
    for (let n = 0; n < MAX_OPEN_BOOK_REQUESTS; n++) {
      const outcome = await createBookRequest(prisma, input({ title: `Book ${n}` }));
      expect(outcome.kind).toBe('created');
    }

    const overflow = await createBookRequest(prisma, input({ title: 'One too many' }));
    expect(overflow).toEqual({ kind: 'limit', limit: MAX_OPEN_BOOK_REQUESTS });
    expect(await prisma.bookRequest.count()).toBe(MAX_OPEN_BOOK_REQUESTS);
  });

  it('does not count resolved requests against the cap', async () => {
    for (let n = 0; n < MAX_OPEN_BOOK_REQUESTS; n++) {
      await createBookRequest(prisma, input({ title: `Book ${n}` }));
    }
    await prisma.bookRequest.updateMany({
      where: { userId: ALICE, title: 'Book 0' },
      data: { status: 'fulfilled' },
    });

    const outcome = await createBookRequest(prisma, input({ title: 'Now there is room' }));
    expect(outcome.kind).toBe('created');
  });

  it('trims the stored strings', async () => {
    await createBookRequest(prisma, input({ title: '  Dune  ', author: ' Frank Herbert ', note: ' please ' }));
    const row = await prisma.bookRequest.findFirstOrThrow({ where: { userId: ALICE } });
    expect(row).toMatchObject({ title: 'Dune', author: 'Frank Herbert', note: 'please' });
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run services/book-request.test.ts --root app/server`
Expected: FAIL — `Cannot find module './book-request'`.

- [ ] **Step 3: Write the implementation**

Create `app/server/services/book-request.ts`:

```ts
import { randomUUID } from 'crypto';

import { PrismaClient } from '@prisma/client';

/**
 * Stored lowercase; exposed through the `BookRequestStatus` GraphQL enum,
 * whose SCREAMING_CASE members map back onto these exact strings. The enum
 * `satisfies`-checks against this union so the two cannot drift.
 */
export type BookRequestStatus = 'pending' | 'fulfilled' | 'declined';

/**
 * How many requests one reader may have open at once. A module constant, NOT
 * an add-on config option: making it configurable would cost `config.yaml`,
 * the README, and the options table for a number nobody will tune. Counts
 * `pending` rows only — resolving a request frees a slot.
 */
export const MAX_OPEN_BOOK_REQUESTS = 10;

const normalize = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The duplicate-detection key: both halves lowercased and whitespace-collapsed,
 * joined by a NUL. The separator has to be a character that cannot occur in
 * either half, or `("a b", "c")` and `("a", "b c")` would collide.
 *
 * Pure and exported so the GraphQL layer can test it without a database.
 */
export const dedupeKey = (title: string, author: string): string =>
  `${normalize(title)}\0${normalize(author)}`;

export type BookRequestInput = {
  userId: string;
  title: string;
  author: string;
  note: string;
};

export type CreateBookRequestOutcome =
  | { kind: 'created'; id: string }
  | { kind: 'limit'; limit: number }
  | { kind: 'duplicate'; existingId: string };

/**
 * Creates a pending request, or reports why it did not.
 *
 * RETURNED, NOT THROWN, and therefore never wrapped in `toResult`: both
 * failures are decided by an explicit read inside this function, which is the
 * line this codebase already draws (`createUser` returns `false`,
 * `updateDevice` returns `null`; `DeviceSlugConflictError` is thrown because it
 * escapes a Prisma call as an exception). `KNOWN_DOMAIN_ERROR_CLASSES` gains
 * nothing here.
 *
 * The dedupe check, the cap count, and the insert run in ONE transaction so
 * two concurrent creates cannot both read a count of 9 and both insert.
 *
 * Duplicate detection is scoped to OPEN requests. A fulfilled request means the
 * book is already in the library and a declined one is a wish the admin turned
 * down; a reader may legitimately ask again after either.
 */
export async function createBookRequest(
  prisma: PrismaClient,
  input: BookRequestInput
): Promise<CreateBookRequestOutcome> {
  const key = dedupeKey(input.title, input.author);

  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.bookRequest.findFirst({
      where: { userId: input.userId, dedupeKey: key, status: 'pending' },
      select: { id: true },
    });
    if (duplicate !== null) return { kind: 'duplicate', existingId: duplicate.id };

    const open = await tx.bookRequest.count({
      where: { userId: input.userId, status: 'pending' },
    });
    if (open >= MAX_OPEN_BOOK_REQUESTS) {
      return { kind: 'limit', limit: MAX_OPEN_BOOK_REQUESTS };
    }

    const created = await tx.bookRequest.create({
      data: {
        userId: input.userId,
        id: randomUUID(),
        title: input.title.trim(),
        author: input.author.trim(),
        note: input.note.trim(),
        dedupeKey: key,
      },
      select: { id: true },
    });
    return { kind: 'created', id: created.id };
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run services/book-request.test.ts --root app/server`
Expected: PASS, all eight.

- [ ] **Step 5: Commit**

```bash
git add app/server/services/book-request.ts app/server/services/book-request.test.ts
git commit -m "feat(server): createBookRequest, with the cap and the dedupe key

Both failures are returned as values rather than thrown, so neither joins
KNOWN_DOMAIN_ERROR_CLASSES and neither goes through toResult — the same line
createUser's false and updateDevice's null already sit on. The count, the
dedupe read and the insert share one transaction so the cap cannot be raced.

Duplicate detection covers OPEN requests only: a fulfilled request means the
book is already there, and a declined one is a wish the admin turned down."
```

---

## Task 3: `fulfillBookRequest`, `declineBookRequest`, `deleteBookRequest`

**Files:**
- Modify: `app/server/services/book-request.ts`
- Test: `app/server/services/book-request.test.ts`

**Interfaces:**
- Consumes: Task 2's module.
- Produces:
  ```ts
  export type ResolveOutcome =
    | { kind: 'resolved' }
    | { kind: 'missing' }
    | { kind: 'notPending'; status: BookRequestStatus };
  export type FulfillOutcome = ResolveOutcome | { kind: 'noSuchBook' };
  export function fulfillBookRequest(
    prisma: PrismaClient,
    args: { userId: string; id: string; bookUserId: string; bookId: string }
  ): Promise<FulfillOutcome>;
  export function declineBookRequest(
    prisma: PrismaClient, args: { userId: string; id: string; reason: string }
  ): Promise<ResolveOutcome>;
  export function deleteBookRequest(
    prisma: PrismaClient, args: { userId: string; id: string }
  ): Promise<boolean>;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `app/server/services/book-request.test.ts`, and extend the import at the top of the file to
`import { createBookRequest, declineBookRequest, dedupeKey, deleteBookRequest, fulfillBookRequest, MAX_OPEN_BOOK_REQUESTS } from './book-request';`:

```ts
const BOB = 'user-bob';
const seedBook = async (userId: string, id: string) => {
  await prisma.book.create({
    data: { userId, id, title: 'Dune', size: 1, mtime: 0, addedAt: 0 },
  });
};
const seedRequest = async (): Promise<string> => {
  const outcome = await createBookRequest(prisma, input());
  if (outcome.kind !== 'created') throw new Error('setup failed');
  return outcome.id;
};

describe('fulfillBookRequest', () => {
  it('marks the request fulfilled and links the book', async () => {
    const id = await seedRequest();
    await seedBook(ALICE, 'a'.repeat(32));

    const outcome = await fulfillBookRequest(prisma, {
      userId: ALICE,
      id,
      bookUserId: ALICE,
      bookId: 'a'.repeat(32),
    });

    expect(outcome).toEqual({ kind: 'resolved' });
    const row = await prisma.bookRequest.findUniqueOrThrow({
      where: { userId_id: { userId: ALICE, id } },
    });
    expect(row.status).toBe('fulfilled');
    expect(row.bookId).toBe('a'.repeat(32));
    expect(row.resolvedAt).not.toBeNull();
  });

  it('refuses a book from a different library', async () => {
    const id = await seedRequest();
    await prisma.user.create({ data: { id: BOB, username: 'bob' } });
    await seedBook(BOB, 'b'.repeat(32));

    const outcome = await fulfillBookRequest(prisma, {
      userId: ALICE,
      id,
      bookUserId: BOB,
      bookId: 'b'.repeat(32),
    });

    expect(outcome).toEqual({ kind: 'noSuchBook' });
    const row = await prisma.bookRequest.findUniqueOrThrow({
      where: { userId_id: { userId: ALICE, id } },
    });
    expect(row.status).toBe('pending');
  });

  it('refuses a book that does not exist', async () => {
    const id = await seedRequest();
    const outcome = await fulfillBookRequest(prisma, {
      userId: ALICE,
      id,
      bookUserId: ALICE,
      bookId: 'c'.repeat(32),
    });
    expect(outcome).toEqual({ kind: 'noSuchBook' });
  });

  it('reports a missing request', async () => {
    const outcome = await fulfillBookRequest(prisma, {
      userId: ALICE,
      id: 'no-such-request',
      bookUserId: ALICE,
      bookId: 'a'.repeat(32),
    });
    expect(outcome).toEqual({ kind: 'missing' });
  });

  it('refuses to resolve an already-resolved request', async () => {
    const id = await seedRequest();
    await seedBook(ALICE, 'a'.repeat(32));
    await fulfillBookRequest(prisma, { userId: ALICE, id, bookUserId: ALICE, bookId: 'a'.repeat(32) });

    const again = await declineBookRequest(prisma, { userId: ALICE, id, reason: 'changed my mind' });
    expect(again).toEqual({ kind: 'notPending', status: 'fulfilled' });
  });
});

describe('declineBookRequest', () => {
  it('marks the request declined and records the reason', async () => {
    const id = await seedRequest();
    const outcome = await declineBookRequest(prisma, { userId: ALICE, id, reason: "Can't find it" });

    expect(outcome).toEqual({ kind: 'resolved' });
    const row = await prisma.bookRequest.findUniqueOrThrow({
      where: { userId_id: { userId: ALICE, id } },
    });
    expect(row).toMatchObject({ status: 'declined', declineReason: "Can't find it" });
    expect(row.resolvedAt).not.toBeNull();
  });

  it('reports a missing request', async () => {
    const outcome = await declineBookRequest(prisma, { userId: ALICE, id: 'nope', reason: '' });
    expect(outcome).toEqual({ kind: 'missing' });
  });
});

describe('deleteBookRequest', () => {
  it('deletes the row and reports true', async () => {
    const id = await seedRequest();
    expect(await deleteBookRequest(prisma, { userId: ALICE, id })).toBe(true);
    expect(await prisma.bookRequest.count()).toBe(0);
  });

  it('reports false for a row that is not there', async () => {
    expect(await deleteBookRequest(prisma, { userId: ALICE, id: 'nope' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run services/book-request.test.ts --root app/server`
Expected: FAIL — `fulfillBookRequest is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `app/server/services/book-request.ts`, and add `import { isPrismaError } from './prisma-errors';` to the imports:

```ts
export type ResolveOutcome =
  | { kind: 'resolved' }
  | { kind: 'missing' }
  | { kind: 'notPending'; status: BookRequestStatus };

export type FulfillOutcome = ResolveOutcome | { kind: 'noSuchBook' };

/**
 * Links a book to a pending request and closes it.
 *
 * IN A TRANSACTION, unlike `declineBookRequest`, and the asymmetry is
 * deliberate: this one has to validate a SECOND row — the book — before it
 * writes, so the read and the write have to be atomic together. Declining
 * validates nothing else and gets a single guarded `updateMany` instead.
 *
 * `bookUserId !== args.userId` is `noSuchBook`, not a distinct outcome: an
 * admin must not fulfil alice's request with a book off bob's shelf, and
 * saying so in more detail would confirm that bob has that book.
 */
export async function fulfillBookRequest(
  prisma: PrismaClient,
  args: { userId: string; id: string; bookUserId: string; bookId: string }
): Promise<FulfillOutcome> {
  return prisma.$transaction(async (tx) => {
    const request = await tx.bookRequest.findUnique({
      where: { userId_id: { userId: args.userId, id: args.id } },
      select: { status: true },
    });
    if (request === null) return { kind: 'missing' };
    if (request.status !== 'pending') {
      return { kind: 'notPending', status: request.status as BookRequestStatus };
    }

    if (args.bookUserId !== args.userId) return { kind: 'noSuchBook' };
    const book = await tx.book.findUnique({
      where: { userId_id: { userId: args.bookUserId, id: args.bookId } },
      select: { id: true },
    });
    if (book === null) return { kind: 'noSuchBook' };

    await tx.bookRequest.update({
      where: { userId_id: { userId: args.userId, id: args.id } },
      data: {
        status: 'fulfilled',
        resolvedAt: Date.now(),
        bookUserId: args.bookUserId,
        bookId: args.bookId,
      },
    });
    return { kind: 'resolved' };
  });
}

/**
 * Closes a pending request as declined, with an optional reason.
 *
 * The `status: 'pending'` term in the `where` is what makes this atomic
 * WITHOUT a transaction: the guard and the write are one statement, so two
 * concurrent resolves cannot both see `pending`. The follow-up read only runs
 * when nothing was updated, to tell "no such row" from "already resolved".
 */
export async function declineBookRequest(
  prisma: PrismaClient,
  args: { userId: string; id: string; reason: string }
): Promise<ResolveOutcome> {
  const updated = await prisma.bookRequest.updateMany({
    where: { userId: args.userId, id: args.id, status: 'pending' },
    data: { status: 'declined', declineReason: args.reason.trim(), resolvedAt: Date.now() },
  });
  if (updated.count === 1) return { kind: 'resolved' };

  const existing = await prisma.bookRequest.findUnique({
    where: { userId_id: { userId: args.userId, id: args.id } },
    select: { status: true },
  });
  return existing === null
    ? { kind: 'missing' }
    : { kind: 'notPending', status: existing.status as BookRequestStatus };
}

/**
 * Deletes a request whatever its status — the reader withdrawing a pending one
 * and either party clearing a resolved one are the same operation. Returns
 * `false` when there was no such row (`P2025`) rather than throwing, the same
 * convention `deleteDevice` and `deleteUser` use.
 */
export async function deleteBookRequest(
  prisma: PrismaClient,
  args: { userId: string; id: string }
): Promise<boolean> {
  try {
    await prisma.bookRequest.delete({
      where: { userId_id: { userId: args.userId, id: args.id } },
    });
    return true;
  } catch (e) {
    if (isPrismaError(e, 'P2025')) return false; // already deleted
    throw e;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run services/book-request.test.ts --root app/server`
Expected: PASS, all nineteen.

- [ ] **Step 5: Full verification**

Run: `npm run lint && npm test`
Expected: exit 0 for both.

- [ ] **Step 6: Commit**

```bash
git add app/server/services/book-request.ts app/server/services/book-request.test.ts
git commit -m "feat(server): fulfil, decline and delete a book request

fulfillBookRequest runs in a transaction because it validates a second row (the
book) before writing; declineBookRequest does not, because a status-guarded
updateMany is already atomic and is one query. A book from another library is
reported as noSuchBook rather than a distinct outcome — a more specific answer
would confirm that the other library has it."
```

---

## Task 4: The `BookRequestStatus` enum and the `BookRequest` node

**Files:**
- Create: `app/server/graphql/schema/book-request-status/model.ts`, `app/server/graphql/schema/book-request-status/index.ts`
- Create: `app/server/graphql/schema/book-request/model.ts`, `app/server/graphql/schema/book-request/index.ts`
- Modify: `app/server/graphql/schema/index.ts`
- Modify: `app/server/graphql/test-util.ts`
- Modify: `app/server/graphql/schema.generated.graphql` (regenerated)

**Interfaces:**
- Consumes: Task 3's service module (for `BookRequestStatus`).
- Produces: `model` (the `BookRequest` prismaNode ref) exported from `schema/book-request/model.ts`; `model` (the enum ref) from `schema/book-request-status/model.ts`.

**Registering a prismaNode obliges you to seed it.** `node-scope.test.ts` walks every type implementing `Node` and calls `harness.seedNodeFor(typeName)`, which **throws** for a type with no branch. That is deliberate — a silent skip is how the suite would quietly stop covering a type someone added later. Step 4 below adds the branch; the generic suite is this task's test.

- [ ] **Step 1: Write the enum**

Create `app/server/graphql/schema/book-request-status/model.ts`:

```ts
import type { BookRequestStatus } from '../../../services/book-request';
import { builder } from '../builder';

/**
 * Mirrors `BookRequestStatus` in `services/book-request.ts`. Member names are
 * SCREAMING_CASE per GraphQL convention; `value:` maps to the stored lowercase,
 * exactly as `CoverFit` does. The value union is `satisfies`-checked against
 * the imported type so the two cannot silently drift apart.
 */
export const model = builder.enumType('BookRequestStatus', {
  values: {
    PENDING: { value: 'pending' },
    FULFILLED: { value: 'fulfilled' },
    DECLINED: { value: 'declined' },
  } as const satisfies Record<Uppercase<BookRequestStatus>, { value: BookRequestStatus }>,
});
```

Create `app/server/graphql/schema/book-request-status/index.ts`:

```ts
export { model } from './model';
```

- [ ] **Step 2: Write the node**

Create `app/server/graphql/schema/book-request/model.ts`:

```ts
import type { BookRequestStatus } from '../../../services/book-request';
import { epochToDate } from '../../derive';
import { model as bookRequestStatus } from '../book-request-status/model';
import { builder } from '../builder';
import { ownerScopedFindUnique } from '../node-scope';

/**
 * A reader's wish for a book that is not in Bookplate yet.
 *
 * A `prismaNode` keyed on the COMPOUND id (`@@id([userId, id])`), not on a
 * plain `id`, and the difference is what makes the guard possible:
 * `ownerScopedFindUnique` decides ownership WITHOUT reading the row, by taking
 * the `userId` out of the global id itself and substituting `NO_MATCH_USER_ID`
 * when the viewer is neither the owner nor an admin. A plain `String @id`
 * would carry no owner in the global id, so the guard would have to read the
 * row first — and `node-scope.test.ts` enforces generically that every
 * tenant-owned node type routes its `findUnique` through this helper.
 *
 * `nullable: true` for the same reason every other guarded node here is: a
 * denied read is a null node, not an error.
 */
export const model = builder.prismaNode('BookRequest', {
  id: { field: 'userId_id' },
  findUnique: ownerScopedFindUnique((userId: string, id: string) => ({
    userId_id: { userId, id },
  })),
  nullable: true,
  fields: (t) => ({
    title: t.exposeString('title'),
    author: t.exposeString('author'),
    note: t.exposeString('note'),
    declineReason: t.exposeString('declineReason'),
    status: t.field({
      type: bookRequestStatus,
      resolve: (request) => request.status as BookRequestStatus,
    }),
    createdAt: t.field({
      type: 'DateTime',
      resolve: (request) => epochToDate(request.createdAt),
    }),
    resolvedAt: t.field({
      type: 'DateTime',
      nullable: true,
      resolve: (request) => (request.resolvedAt === null ? null : epochToDate(request.resolvedAt)),
    }),

    /**
     * The book this request was fulfilled with, once it has been. Nullable in
     * two distinct cases the client renders identically: the request is not
     * fulfilled yet, and the book it was fulfilled with has since been deleted
     * (`onDelete: SetNull`, `prisma/schema.prisma`). "Added to your library"
     * without a link is the correct rendering of the second, not an error.
     */
    book: t.relation('book', { nullable: true }),
  }),
});
```

Create `app/server/graphql/schema/book-request/index.ts`:

```ts
export { model } from './model';
```

(Mutation side-effect imports are added to this file in Tasks 7–9.)

- [ ] **Step 3: Register both directories**

In `app/server/graphql/schema/index.ts`, add the two imports alongside the existing entity-directory imports, keeping the file's existing ordering convention:

```ts
import './book-request';
import './book-request-status';
```

- [ ] **Step 4: Add the `seedNodeFor` branch**

In `app/server/graphql/test-util.ts`, inside `seedNodeFor`'s `switch`, before the `default:`:

```ts
      // Compound id (`userId_id`), like Book — so the global id is
      // `JSON.stringify([userId, id])` as the local id, not a plain
      // `encodeGlobalID('BookRequest', id)`. Read it back through the schema
      // rather than hand-encoding, matching every other branch here.
      case 'BookRequest': {
        await prisma.bookRequest.create({
          data: {
            userId: aliceId,
            id: 'seed-request-1',
            title: 'Seed',
            author: 'Seed Author',
            dedupeKey: 'seed\0seed author',
          },
        });
        const seeded = await execute(
          `{ viewer { user { bookRequests(first: 1) { edges { node { id } } } } } }`,
          { viewer: aliceViewer }
        );
        const data = seeded.data as {
          viewer: { user: { bookRequests: { edges: { node: { id: string } }[] } } | null };
        } | null;
        const globalId = data?.viewer.user?.bookRequests.edges[0]?.node.id;
        if (globalId === undefined) {
          throw new Error(
            'seedNodeFor("BookRequest") could not read back the seeded request global id'
          );
        }
        return globalId;
      }
```

> **Ordering note for the executor:** this branch reads through
> `User.bookRequests`, which Task 5 adds. Write the branch now, expect the
> node-scope suite to fail until Task 5 lands, and run the two tasks together
> before committing either if you prefer a green tree at every commit. The
> alternative — hand-encoding the global id here — is exactly what every other
> branch's comment says not to do.

- [ ] **Step 5: Regenerate the SDL and run the suites**

Run: `npm run graphql:schema -w app/server`
Then: `npx vitest run graphql/schema/node-scope.test.ts graphql/schema/print-schema.test.ts --root app/server`
Expected: the print-schema snapshot passes with the regenerated file; node-scope's `BookRequest` cases pass once Task 5 is in place.

- [ ] **Step 6: Commit (with Task 5, if you kept the tree green)**

```bash
git add app/server/graphql/schema/book-request app/server/graphql/schema/book-request-status \
        app/server/graphql/schema/index.ts app/server/graphql/test-util.ts \
        app/server/graphql/schema.generated.graphql
git commit -m "feat(server): the BookRequest node and its status enum

Keyed on the compound id so ownerScopedFindUnique can decide ownership from the
global id without reading the row — the same reason Book is. node-scope.test.ts
enforces that helper across every Node type and throws for one seedNodeFor has
no branch for, so test-util gains a BookRequest branch in the same commit.

SDL regenerated deliberately: adds BookRequest and BookRequestStatus."
```

---

## Task 5: `User.bookRequests`

**Files:**
- Modify: `app/server/graphql/schema/pagination.ts`
- Modify: `app/server/graphql/schema/book-request/model.ts` (add `requestKeyset`)
- Modify: `app/server/graphql/schema/user/model.ts`
- Test: `app/server/graphql/schema/book-request/model.test.ts`
- Modify: `app/server/graphql/schema.generated.graphql` (regenerated)

**Interfaces:**
- Consumes: Task 4's `model` ref.
- Produces: `requestKeyset(from, take)` exported from `book-request/model.ts`; the `User.bookRequests` field; `CONNECTION_LIMITS.userBookRequests`.

**Read `Library.progress` in `schema/library/model.ts` before writing this.** It is the same construction with different columns, and its doc comments carry the reasoning this field depends on. In particular: `take`'s **sign** is the direction and must be forwarded exactly as the plugin computed it, because `resolvePrismaCursorConnection` slices the extra row off using its own copy of that number — changing it corrupts `hasNextPage` rather than resizing the page.

- [ ] **Step 1: Add the connection bound**

In `app/server/graphql/schema/pagination.ts`, inside `CONNECTION_LIMITS`:

```ts
  userBookRequests: { maxSize: 100, defaultSize: 20 },
```

- [ ] **Step 2: Write the failing tests**

Create `app/server/graphql/schema/book-request/model.test.ts`:

```ts
import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const LIST = `
  query List($first: Int!, $after: String) {
    viewer {
      user {
        bookRequests(first: $first, after: $after) {
          edges { cursor node { id title status } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

const ADMIN_LIST = `
  query AdminList($userId: ID!) {
    user(id: $userId) {
      bookRequests(first: 10) { edges { node { title } } }
    }
  }
`;

/** Seeds `count` requests with strictly increasing `createdAt`, newest last. */
const seed = async (userId: string, count: number): Promise<void> => {
  for (let n = 0; n < count; n++) {
    await harness.prisma.bookRequest.create({
      data: {
        userId,
        id: `req-${n}`,
        title: `Book ${n}`,
        author: 'Author',
        dedupeKey: `book ${n}\0author`,
        createdAt: 1_000 + n,
      },
    });
  }
};

describe('User.bookRequests', () => {
  it('lists the viewer own requests, newest first', async () => {
    await seed(harness.aliceOwner.userId, 3);

    const result = await harness.execute(LIST, {
      viewer: harness.aliceViewer,
      variables: { first: 10 },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data as {
      viewer: { user: { bookRequests: { edges: { node: { title: string } }[] } } };
    };
    expect(data.viewer.user.bookRequests.edges.map((e) => e.node.title)).toEqual([
      'Book 2',
      'Book 1',
      'Book 0',
    ]);
  });

  it('is null for the config admin, which has no User row', async () => {
    const result = await harness.execute(LIST, {
      viewer: harness.adminViewer,
      variables: { first: 10 },
    });

    expect(result.errors).toBeUndefined();
    expect((result.data as { viewer: { user: unknown } }).viewer.user).toBeNull();
  });

  it('lets an admin read a target user requests, not their own', async () => {
    await seed(harness.aliceOwner.userId, 1);

    const result = await harness.execute(ADMIN_LIST, {
      viewer: harness.adminViewer,
      variables: { userId: harness.aliceGlobalId },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data as {
      user: { bookRequests: { edges: { node: { title: string } }[] } };
    };
    expect(data.user.bookRequests.edges.map((e) => e.node.title)).toEqual(['Book 0']);
  });

  it('rejects a page larger than maxSize rather than clamping it', async () => {
    const result = await harness.execute(LIST, {
      viewer: harness.aliceViewer,
      variables: { first: 101 },
    });
    expect(result.errors?.[0]?.message).toMatch(/User\.bookRequests/);
  });

  /**
   * THE REASON THIS FIELD USES A KEYSET INSTEAD OF THE PLUGIN CURSOR SEEK.
   * Prisma implements `cursor` by seeking to a row, so a deleted cursor row
   * yields an EMPTY page with `hasNextPage: false` and no error. Deleting a
   * request is a first-class action here, so this is the normal case.
   */
  it('keeps paginating after the cursor row is deleted', async () => {
    await seed(harness.aliceOwner.userId, 4);

    const page1 = await harness.execute(LIST, {
      viewer: harness.aliceViewer,
      variables: { first: 2 },
    });
    const p1 = page1.data as {
      viewer: {
        user: {
          bookRequests: {
            edges: { cursor: string; node: { title: string } }[];
            pageInfo: { endCursor: string };
          };
        };
      };
    };
    expect(p1.viewer.user.bookRequests.edges.map((e) => e.node.title)).toEqual([
      'Book 3',
      'Book 2',
    ]);
    const cursor = p1.viewer.user.bookRequests.pageInfo.endCursor;

    // Delete the exact row that cursor names.
    await harness.prisma.bookRequest.delete({
      where: { userId_id: { userId: harness.aliceOwner.userId, id: 'req-2' } },
    });

    const page2 = await harness.execute(LIST, {
      viewer: harness.aliceViewer,
      variables: { first: 2, after: cursor },
    });
    const p2 = page2.data as {
      viewer: { user: { bookRequests: { edges: { node: { title: string } }[] } } };
    };
    expect(p2.viewer.user.bookRequests.edges.map((e) => e.node.title)).toEqual([
      'Book 1',
      'Book 0',
    ]);
  });

  it('paginates backward', async () => {
    await seed(harness.aliceOwner.userId, 4);

    const forward = await harness.execute(LIST, {
      viewer: harness.aliceViewer,
      variables: { first: 2 },
    });
    const cursor = (
      forward.data as {
        viewer: { user: { bookRequests: { pageInfo: { endCursor: string } } } };
      }
    ).viewer.user.bookRequests.pageInfo.endCursor;

    const backward = await harness.execute(
      `query Back($last: Int!, $before: String) {
         viewer { user { bookRequests(last: $last, before: $before) {
           edges { node { title } } } } }
       }`,
      { viewer: harness.aliceViewer, variables: { last: 1, before: cursor } }
    );

    const data = backward.data as {
      viewer: { user: { bookRequests: { edges: { node: { title: string } }[] } } };
    };
    expect(data.viewer.user.bookRequests.edges.map((e) => e.node.title)).toEqual(['Book 3']);
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run graphql/schema/book-request/model.test.ts --root app/server`
Expected: FAIL — `Cannot query field "bookRequests" on type "User"`.

- [ ] **Step 4: Add the keyset helper**

Append to `app/server/graphql/schema/book-request/model.ts`:

```ts
import type { Prisma } from '@prisma/client';

/**
 * Translates `User.bookRequests`'s parsed cursor into the keyset `where` that
 * page starts from, for `orderBy: [{createdAt:'desc'}, {id:'asc'}]`.
 *
 * WHY THIS EXISTS AT ALL — `t.prismaConnection` already hands the resolver a
 * ready-made `{ cursor, skip: 1, take }`, and using it directly is one line.
 * That line has a defect worth this function: Prisma implements `cursor` by
 * SEEKING TO A ROW, so it needs that row to still be there. When it is not,
 * the page comes back EMPTY with `hasNextPage: false` and no error. A keyset
 * compares VALUES CARRIED IN the cursor and never looks the row up, and both
 * values it needs are in there — that is what `@@unique([userId, createdAt,
 * id])` is for. Deleting a request is a first-class action on both surfaces
 * (`bookRequestDelete`), so this is the expected case, not an edge one.
 *
 * `take`'s SIGN is the direction, and it is the plugin's own
 * (`prismaCursorConnectionQuery` negates it for `before`/`last`), not something
 * re-derived from `args` here. Forward (`take > 0`) means rows strictly AFTER
 * the cursor in the sort order — an OLDER `createdAt`, or the same `createdAt`
 * and a LATER `id`. Backward is the mirror image.
 *
 * No cursor (a first page, forward or backward) means no predicate at all.
 *
 * Same construction as `progressKeyset` in `schema/library/model.ts`, over
 * different columns; read that one's comments too.
 */
export const requestKeyset = (
  from: { createdAt: number; id: string } | undefined,
  take: number | undefined
): Prisma.BookRequestWhereInput => {
  if (!from) return {};
  return take !== undefined && take < 0
    ? {
        OR: [
          { createdAt: { gt: from.createdAt } },
          { createdAt: from.createdAt, id: { lt: from.id } },
        ],
      }
    : {
        OR: [
          { createdAt: { lt: from.createdAt } },
          { createdAt: from.createdAt, id: { gt: from.id } },
        ],
      };
};
```

- [ ] **Step 5: Add the field to `User`**

In `app/server/graphql/schema/user/model.ts`, add these imports (note `../book-request/model`, never `../book-request`):

```ts
import { model as bookRequest, requestKeyset } from '../book-request/model';
import { CONNECTION_LIMITS, rejectOversizePage } from '../pagination';
```

and this field inside `fields: (t) => ({ ... })`, after `progressCount`:

```ts
    /**
     * This reader's book requests, newest first — the ONE field behind both
     * surfaces. The reader reaches it as `viewer { user { bookRequests } }`
     * (`Viewer.user` is already null for the config admin, which has no `User`
     * row and cannot be a requester) and the admin as
     * `user(id:) { bookRequests }` (`Query.user` is admin-gated). A separate
     * `Viewer.bookRequests` would duplicate this field, its `CONNECTION_LIMITS`
     * entry and its auth tests for no gain.
     *
     * `ownerOf` on the PARENT's id, exactly like `library` below it — ownership
     * is decided once, from the row this type is pinned to, never from
     * `context.viewer`: an admin reading `user(id:).bookRequests` must page the
     * target user's rows, not their own.
     *
     * `t.prismaConnection`, not `t.relatedConnection`, and the `resolve` drops
     * the plugin's `cursor`/`skip` — see `requestKeyset` for why. A
     * `t.relatedConnection` could not carry that fix: its `resolve` is a
     * FALLBACK ONLY, because on the normal path its rows arrive through the
     * parent's merged `select`.
     */
    bookRequests: t.prismaConnection(
      {
        type: bookRequest,
        description:
          'Books this reader has asked the library admin for, newest first. ' +
          'Paginates in both directions.',
        authScopes: (parent) => ({ ownerOf: parent.id }),
        cursor: 'userId_createdAt_id',
        // Native maxSize/defaultSize bound the Prisma query itself, but by
        // CLAMPING rather than rejecting, which pagination.ts's "reject, never
        // clamp" ruling forbids. Kept as defense in depth on the SQL; the
        // actual reject is in `resolve`.
        maxSize: CONNECTION_LIMITS.userBookRequests.maxSize,
        defaultSize: CONNECTION_LIMITS.userBookRequests.defaultSize,
        resolve: (query, parent, args, context) => {
          rejectOversizePage(
            'User.bookRequests',
            args,
            CONNECTION_LIMITS.userBookRequests.maxSize
          );
          // `cursor` and `skip` are DELIBERATELY DROPPED and `take` is
          // deliberately kept — `resolvePrismaCursorConnection` slices the
          // extra row off using its OWN copy of `take`, so changing it here
          // corrupts `hasNextPage` rather than resizing the page.
          const { cursor, skip: _skip, ...page } = query;
          return context.prisma.bookRequest.findMany({
            ...page,
            where: {
              userId: parent.id,
              ...requestKeyset(cursor?.userId_createdAt_id, page.take),
            },
            // `id asc` is the tiebreaker and is required: `createdAt` is whole
            // seconds scaled by 1000, so two requests made in the same second
            // share one, and cursor pagination needs a total order.
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          });
        },
      },
      { name: 'UserBookRequestsConnection' },
      { name: 'UserBookRequestsConnectionEdge' }
    ),
```

- [ ] **Step 6: Regenerate the SDL and run the tests**

Run: `npm run graphql:schema -w app/server`
Then: `npx vitest run graphql/schema/book-request graphql/schema/node-scope.test.ts --root app/server`
Expected: PASS — including the two `BookRequest` cases in the generic node-scope suite, which now have a working `seedNodeFor` branch.

- [ ] **Step 7: Full verification**

Run: `npm run lint && npm test && npm run test:cost -w app/server`
Expected: exit 0 for all three. If a cost budget moved, record before/after in the commit message rather than adjusting the budget.

- [ ] **Step 8: Commit**

```bash
git add app/server/graphql app/server/prisma
git commit -m "feat(server): User.bookRequests, a keyset prismaConnection

One field serves both surfaces: the reader through viewer.user, the admin
through Query.user(id:). A separate Viewer.bookRequests would have duplicated
the field, its CONNECTION_LIMITS entry and its auth tests.

The resolver drops the plugin's cursor/skip and rebuilds the keyset from the
parsed cursor, as Library.progress does. Prisma paginates by seeking to a row,
so a deleted cursor row yields an empty page with hasNextPage: false and no
error — and deleting a request is a first-class action here, not an edge case.
t.relatedConnection could not carry that fix: its resolve is a fallback only.

SDL regenerated deliberately: adds User.bookRequests and its connection types."
```

---

## Task 6: `User.pendingBookRequestCount`

**Files:**
- Modify: `app/server/graphql/schema/user/model.ts`
- Test: `app/server/graphql/schema/book-request/model.test.ts`
- Modify: `app/server/graphql/schema.generated.graphql` (regenerated)

**Interfaces:**
- Consumes: the `bookRequests` Prisma relation on `User`.
- Produces: the `User.pendingBookRequestCount` field.

- [ ] **Step 1: Write the failing test**

Append to `app/server/graphql/schema/book-request/model.test.ts`:

```ts
describe('User.pendingBookRequestCount', () => {
  it('counts only pending requests', async () => {
    await seed(harness.aliceOwner.userId, 3);
    await harness.prisma.bookRequest.update({
      where: { userId_id: { userId: harness.aliceOwner.userId, id: 'req-0' } },
      data: { status: 'fulfilled' },
    });

    const result = await harness.execute(
      '{ viewer { user { pendingBookRequestCount } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const data = result.data as {
      viewer: { user: { pendingBookRequestCount: number } };
    };
    expect(data.viewer.user.pendingBookRequestCount).toBe(2);
  });

  it('is zero for a reader with no requests', async () => {
    const result = await harness.execute(
      '{ viewer { user { pendingBookRequestCount } } }',
      { viewer: harness.aliceViewer }
    );
    const data = result.data as {
      viewer: { user: { pendingBookRequestCount: number } };
    };
    expect(data.viewer.user.pendingBookRequestCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run graphql/schema/book-request/model.test.ts -t pendingBookRequestCount --root app/server`
Expected: FAIL — `Cannot query field "pendingBookRequestCount"`.

- [ ] **Step 3: Add the field**

In `app/server/graphql/schema/user/model.ts`, immediately after `progressCount`:

```ts
    /**
     * How many requests this reader is still waiting on — the badge the admin's
     * `/users` list renders per row.
     *
     * A FILTERED `t.relationCount`, which compiles to a `_count` select with a
     * `where`, merged into whichever query already fetched this row. So
     * `Viewer.users` stays one query however many users exist, exactly as
     * `progressCount` above does — not a per-user `bookRequest.count()`, and
     * not a rows-then-length read, which would pay the connection's cost
     * multiplier to compute a number.
     */
    pendingBookRequestCount: t.relationCount('bookRequests', {
      where: { status: 'pending' },
    }),
```

- [ ] **Step 4: Regenerate the SDL and run the tests**

Run: `npm run graphql:schema -w app/server`
Then: `npx vitest run graphql/schema/book-request/model.test.ts --root app/server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/server/graphql
git commit -m "feat(server): User.pendingBookRequestCount, a filtered relationCount

Compiles to a _count select with a where, merged into the read that already
fetched the row — so Viewer.users stays one query however many users exist,
exactly as progressCount does.

SDL regenerated deliberately: adds User.pendingBookRequestCount."
```

---

## Task 7: The three error refs and `bookRequestCreate`

**Files:**
- Create: `app/server/graphql/schema/book-request-limit-exceeded-error/model.ts` + `index.ts`
- Create: `app/server/graphql/schema/duplicate-book-request-error/model.ts` + `index.ts`
- Create: `app/server/graphql/schema/book-request-not-pending-error/model.ts` + `index.ts`
- Create: `app/server/graphql/schema/book-request/mutation/create.ts`
- Test: `app/server/graphql/schema/book-request/mutation/create.test.ts`
- Modify: `app/server/graphql/schema/book-request/index.ts`, `app/server/graphql/schema/index.ts`
- Modify: `app/server/graphql/schema.generated.graphql` (regenerated)

**Interfaces:**
- Consumes: `createBookRequest`, `MAX_OPEN_BOOK_REQUESTS` from Task 2; `model` from Task 4.
- Produces:
  ```ts
  // book-request-limit-exceeded-error/model.ts
  export const bookRequestLimitExceededError: (limit: number) => BookRequestLimitExceededErrorShape;
  export const model; // objectRef
  // duplicate-book-request-error/model.ts
  export const duplicateBookRequestError: (existingId: string) => DuplicateBookRequestErrorShape;
  export const model;
  // book-request-not-pending-error/model.ts
  export const bookRequestNotPendingError: (status: BookRequestStatus) => BookRequestNotPendingErrorShape;
  export const model;
  ```

**These three carry no domain-error class.** Unlike `DeviceSlugConflictError`, none of them is thrown — the service returns them as values (Task 2's doc comment says why). So each factory takes the plain data the resolver already holds, and the `message` is written here rather than copied off an error instance.

- [ ] **Step 1: Write the three error refs**

`app/server/graphql/schema/book-request-limit-exceeded-error/model.ts`:

```ts
import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * The reader already has `MAX_OPEN_BOOK_REQUESTS` requests open.
 *
 * NOT built from a thrown domain-error class: `createBookRequest` decides this
 * with an explicit count inside its own transaction and RETURNS it, so there is
 * no error instance to carry a message. See that function's doc comment for why
 * the outcome is a value rather than a throw.
 */
export type BookRequestLimitExceededErrorShape = {
  readonly __typename: 'BookRequestLimitExceededError';
  readonly message: string;
  readonly limit: number;
};

export const bookRequestLimitExceededError = (
  limit: number
): BookRequestLimitExceededErrorShape => ({
  __typename: 'BookRequestLimitExceededError',
  message: `You can have ${limit} open requests at a time. Resolve or withdraw one first.`,
  limit,
});

export const model = builder
  .objectRef<BookRequestLimitExceededErrorShape>('BookRequestLimitExceededError')
  .implement({
    description: 'The reader already has the maximum number of open requests.',
    interfaces: [userError],
    fields: (t) => ({
      limit: t.exposeInt('limit'),
    }),
  });
```

`app/server/graphql/schema/duplicate-book-request-error/model.ts`:

```ts
import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * The reader already has an OPEN request for this title and author.
 *
 * `existingRequestId` is the RAW row id, not a global id, and is deliberately
 * plain `ID`: it exists so the client can scroll to or highlight the request
 * the reader already has, and the list it would look in is keyed on the node's
 * global id. Resolving it to a node here would mean a second read on the
 * failure path of a create.
 *
 * Only OPEN requests collide — see `createBookRequest`'s doc comment.
 */
export type DuplicateBookRequestErrorShape = {
  readonly __typename: 'DuplicateBookRequestError';
  readonly message: string;
  readonly existingRequestId: string;
};

export const duplicateBookRequestError = (
  existingId: string
): DuplicateBookRequestErrorShape => ({
  __typename: 'DuplicateBookRequestError',
  message: 'You have already requested this book.',
  existingRequestId: existingId,
});

export const model = builder
  .objectRef<DuplicateBookRequestErrorShape>('DuplicateBookRequestError')
  .implement({
    description: 'An open request for this title and author already exists.',
    interfaces: [userError],
    fields: (t) => ({
      existingRequestId: t.exposeID('existingRequestId'),
    }),
  });
```

`app/server/graphql/schema/book-request-not-pending-error/model.ts`:

```ts
import type { BookRequestStatus } from '../../../services/book-request';
import { model as bookRequestStatus } from '../book-request-status/model';
import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * The request has already been resolved. Returned instead of silently
 * overwriting, so a double resolve — two admins, or one admin and a stale tab —
 * is a typed answer the client can render rather than a lost decision.
 */
export type BookRequestNotPendingErrorShape = {
  readonly __typename: 'BookRequestNotPendingError';
  readonly message: string;
  readonly status: BookRequestStatus;
};

export const bookRequestNotPendingError = (
  status: BookRequestStatus
): BookRequestNotPendingErrorShape => ({
  __typename: 'BookRequestNotPendingError',
  message: `This request has already been ${status}.`,
  status,
});

export const model = builder
  .objectRef<BookRequestNotPendingErrorShape>('BookRequestNotPendingError')
  .implement({
    description: 'The request was already resolved; nothing was changed.',
    interfaces: [userError],
    fields: (t) => ({
      status: t.field({ type: bookRequestStatus, resolve: (error) => error.status }),
    }),
  });
```

Each directory also gets an `index.ts` containing `export * from './model';`, matching the sibling error directories.

- [ ] **Step 1b: Add a zod-free `InvalidInputError` factory**

Task 8 needs to report "that book is not in this reader's library" as an
`InvalidInputError`, and it has no `ZodError` to build one from. Do **not**
hand-construct one: this project is on zod 4 (`app/server/package.json`), whose
`$ZodIssue` carries fields beyond `{ code, path, message }`, so a hand-rolled
issue is a type error waiting to happen. Add a second factory beside the
existing one in `app/server/graphql/schema/invalid-input-error/model.ts`:

```ts
/**
 * The same shape `invalidInputError` produces, for the resolvers that reject an
 * argument WITHOUT a zod parse to reject it — `bookRequestFulfill`'s
 * "that book is not in this reader's library", for instance, which is decided
 * by a database read rather than by parsing.
 *
 * Deliberately not a hand-built `ZodError`: this project is on zod 4, whose
 * issue type carries more than `{ code, path, message }`, so constructing one
 * by hand to feed the parser-shaped factory would be fragile for no gain. The
 * SDL shape is `{ path, message }` either way.
 */
export const invalidInputIssue = (path: string[], message: string): InvalidInputErrorShape => ({
  __typename: 'InvalidInputError',
  message: 'Invalid input',
  issues: [{ path, message }],
});
```

- [ ] **Step 2: Register the three directories**

Add to `app/server/graphql/schema/index.ts`, alongside the other error-type imports:

```ts
import './book-request-limit-exceeded-error';
import './book-request-not-pending-error';
import './duplicate-book-request-error';
```

- [ ] **Step 3: Write the failing mutation test**

Create `app/server/graphql/schema/book-request/mutation/create.test.ts`:

```ts
import { MAX_OPEN_BOOK_REQUESTS } from '../../../../services/book-request';
import { createHarness, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const MUTATION = `
  mutation Create($input: BookRequestCreateInput!) {
    bookRequestCreate(input: $input) {
      __typename
      ... on BookRequestCreatePayload { bookRequest { title author note status } }
      ... on InvalidInputError { message issues { path message } }
      ... on BookRequestLimitExceededError { message limit }
      ... on DuplicateBookRequestError { message existingRequestId }
    }
  }
`;

const validInput = (overrides: Record<string, unknown> = {}) => ({
  title: 'Dune',
  author: 'Frank Herbert',
  note: '',
  ...overrides,
});

describe('Mutation.bookRequestCreate', () => {
  it('creates a pending request for a reader', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: validInput({ note: 'any edition' }) },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookRequestCreate).toEqual({
      __typename: 'BookRequestCreatePayload',
      bookRequest: {
        title: 'Dune',
        author: 'Frank Herbert',
        note: 'any edition',
        status: 'PENDING',
      },
    });
  });

  it('refuses an empty title', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: validInput({ title: '   ' }) },
    });

    const payload = result.data?.bookRequestCreate as {
      __typename: string;
      issues: { path: string[] }[];
    };
    expect(payload.__typename).toBe('InvalidInputError');
    expect(payload.issues.map((i) => i.path)).toContainEqual(['title']);
    expect(await harness.prisma.bookRequest.count()).toBe(0);
  });

  it('refuses an empty author', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: validInput({ author: '' }) },
    });
    const payload = result.data?.bookRequestCreate as {
      __typename: string;
      issues: { path: string[] }[];
    };
    expect(payload.__typename).toBe('InvalidInputError');
    expect(payload.issues.map((i) => i.path)).toContainEqual(['author']);
  });

  it('reports the duplicate, with the id of the request already open', async () => {
    await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: validInput() },
    });
    const existing = await harness.prisma.bookRequest.findFirstOrThrow();

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: validInput({ title: 'DUNE' }) },
    });

    expect(result.data?.bookRequestCreate).toEqual({
      __typename: 'DuplicateBookRequestError',
      message: 'You have already requested this book.',
      existingRequestId: existing.id,
    });
  });

  it('reports the cap once it is reached', async () => {
    for (let n = 0; n < MAX_OPEN_BOOK_REQUESTS; n++) {
      await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: { input: validInput({ title: `Book ${n}` }) },
      });
    }

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: validInput({ title: 'One too many' }) },
    });

    const payload = result.data?.bookRequestCreate as { __typename: string; limit: number };
    expect(payload.__typename).toBe('BookRequestLimitExceededError');
    expect(payload.limit).toBe(MAX_OPEN_BOOK_REQUESTS);
  });

  it('refuses the config admin, which has no User row to own a request', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: validInput() },
    });

    expect(result.data?.bookRequestCreate ?? null).toBeNull();
    expect(result.errors).toBeDefined();
    expect(await harness.prisma.bookRequest.count()).toBe(0);
  });

  it('refuses an unauthenticated caller', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: null,
      variables: { input: validInput() },
    });
    expect(result.errors).toBeDefined();
    expect(await harness.prisma.bookRequest.count()).toBe(0);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run graphql/schema/book-request/mutation/create.test.ts --root app/server`
Expected: FAIL — `Unknown type "BookRequestCreateInput"`.

- [ ] **Step 5: Write the mutation**

Create `app/server/graphql/schema/book-request/mutation/create.ts`:

```ts
import { z } from 'zod';

import { createBookRequest } from '../../../../services/book-request';
import { builder } from '../../builder';
import {
  bookRequestLimitExceededError,
  model as bookRequestLimitExceededErrorModel,
} from '../../book-request-limit-exceeded-error/model';
import {
  duplicateBookRequestError,
  model as duplicateBookRequestErrorModel,
} from '../../duplicate-book-request-error/model';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { model as bookRequestModel } from '../model';

/**
 * Title and author are both REQUIRED — the settled decision, and the reason
 * `.min(1)` runs against the TRIMMED value: "   " is an empty title, not a
 * three-character one. `note` is optional and defaults to the empty string,
 * which is also the column's default.
 */
const inputSchema = z.object({
  title: z.string().trim().min(1, 'A title is required').max(500),
  author: z.string().trim().min(1, 'An author is required').max(500),
  note: z.string().trim().max(2000),
});

const input = builder.inputType('BookRequestCreateInput', {
  fields: (t) => ({
    title: t.string({ required: true }),
    author: t.string({ required: true }),
    note: t.string({ required: false }),
  }),
});

type BookRequestCreatePayloadShape = {
  readonly __typename: 'BookRequestCreatePayload';
  readonly userId: string;
  readonly requestId: string;
};

/**
 * A fresh `t.prismaField` lookup by the id the service reported, never the
 * created row handed straight to a `prismaObject` field — the same pattern
 * `DeviceCreatePayload.device` and `UserRegisterPayload.user` use, and required
 * for the same reason: a `prismaObject` field expects a real Prisma row shape,
 * not an arbitrary object with matching field names.
 */
const payload = builder
  .objectRef<BookRequestCreatePayloadShape>('BookRequestCreatePayload')
  .implement({
    fields: (t) => ({
      bookRequest: t.prismaField({
        type: bookRequestModel,
        resolve: (query, parent, _args, context) =>
          context.prisma.bookRequest.findUniqueOrThrow({
            ...query,
            where: { userId_id: { userId: parent.userId, id: parent.requestId } },
          }),
      }),
    }),
  });

/** No `resolveType`: every member value carries its own `__typename`. */
const result = builder.unionType('BookRequestCreateResult', {
  types: [
    payload,
    invalidInputErrorModel,
    bookRequestLimitExceededErrorModel,
    duplicateBookRequestErrorModel,
  ],
});

/**
 * A reader asks for a book that is not in Bookplate.
 *
 * NO FIELD-LEVEL `authScopes`, deliberately: `builder.mutationType` already
 * declares `{ authenticated: true }` on the whole `Mutation` type
 * (`schema/builder.ts`), Pothos ANDs type-level and field-level scopes, and
 * this mutation needs nothing beyond "signed in". `root-auth.test.ts` walks
 * every root field and fails on an ungated one, so the gate is enforced, not
 * assumed.
 *
 * The explicit `userId === null` guard is a separate matter: the CONFIG-BASED
 * ADMIN is authenticated but has no row in `users`, so it cannot own a library
 * row and cannot be a requester. That is a schema-level fact, not a policy this
 * mutation invents — `Viewer.user` is null for the same viewer, and the reader
 * card never renders for an admin.
 *
 * Input is parsed INSIDE the resolver, after auth, and `InvalidInputError` is
 * an ordinary union member — see `invalid-input-error/model.ts` for why this
 * schema does not use declarative arg validation.
 *
 * No `toResult`: `createBookRequest` throws nothing. Both of its failure
 * outcomes are values it decided itself, so they map straight onto union
 * members here.
 */
builder.mutationField('bookRequestCreate', (t) =>
  t.field({
    type: result,
    description: 'Asks the library admin for a book that is not in Bookplate.',
    args: { input: t.arg({ type: input, required: true }) },
    resolve: async (_parent, args, context) => {
      const userId = context.viewer?.userId ?? null;
      if (userId === null) {
        throw new Error('The configured admin account cannot request books');
      }

      const parsed = inputSchema.safeParse({
        title: args.input.title,
        author: args.input.author,
        note: args.input.note ?? '',
      });
      if (!parsed.success) return invalidInputError(parsed.error);

      const outcome = await createBookRequest(context.prisma, {
        userId,
        title: parsed.data.title,
        author: parsed.data.author,
        note: parsed.data.note,
      });

      switch (outcome.kind) {
        case 'created':
          return { __typename: 'BookRequestCreatePayload' as const, userId, requestId: outcome.id };
        case 'limit':
          return bookRequestLimitExceededError(outcome.limit);
        case 'duplicate':
          return duplicateBookRequestError(outcome.existingId);
      }
    },
  })
);
```

- [ ] **Step 6: Wire the side-effect import**

In `app/server/graphql/schema/book-request/index.ts`:

```ts
export { model } from './model';

import './mutation/create';
```

- [ ] **Step 7: Regenerate the SDL and run the tests**

Run: `npm run graphql:schema -w app/server`
Then: `npx vitest run graphql/schema/book-request --root app/server`
Expected: PASS, all seven create cases.

- [ ] **Step 8: Commit**

```bash
git add app/server/graphql
git commit -m "feat(server): bookRequestCreate, and the three request error types

None of the three errors comes from a thrown class: the service returns the cap
and the duplicate as values it decided itself, so the factories take plain data
and no toResult wrapper is involved.

The config admin is refused explicitly — it has no users row, so it cannot own
a request, the same fact that makes Viewer.user null for it.

SDL regenerated deliberately: adds bookRequestCreate, its input, payload and
result union, and the three error types."
```

---

## Task 8: `bookRequestFulfill` and `bookRequestDecline`

**Files:**
- Create: `app/server/graphql/schema/book-request/mutation/fulfill.ts`, `decline.ts`
- Test: `app/server/graphql/schema/book-request/mutation/fulfill.test.ts`, `decline.test.ts`
- Modify: `app/server/graphql/schema/book-request/index.ts`
- Modify: `app/server/graphql/schema.generated.graphql` (regenerated)

**Interfaces:**
- Consumes: `fulfillBookRequest`, `declineBookRequest` (Task 3); `bookRequestNotPendingError` (Task 7); `parseCompoundId` from `../node-scope`.
- Produces: the two mutation fields.

**Both `id` args are global ids that decode to `[userId, id]`.** Use `parseCompoundId` on the local id the relay plugin hands you — the same helper `ownerScopedFindUnique` uses. Do not hand-parse.

- [ ] **Step 1: Write the failing fulfil test**

Create `app/server/graphql/schema/book-request/mutation/fulfill.test.ts`:

```ts
import { encodeGlobalID } from '@pothos/plugin-relay';

import { createHarness, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const MUTATION = `
  mutation Fulfill($id: ID!, $bookId: ID!) {
    bookRequestFulfill(id: $id, bookId: $bookId) {
      __typename
      ... on BookRequestFulfillPayload {
        bookRequest { status book { title } }
      }
      ... on InvalidInputError { message }
      ... on BookRequestNotPendingError { message status }
    }
  }
`;

const BOOK_ID = 'a'.repeat(32);

const seedRequest = async (userId: string): Promise<string> => {
  await harness.prisma.bookRequest.create({
    data: {
      userId,
      id: 'req-1',
      title: 'Dune',
      author: 'Frank Herbert',
      dedupeKey: 'dune\0frank herbert',
      createdAt: 1_000,
    },
  });
  return encodeGlobalID('BookRequest', JSON.stringify([userId, 'req-1']));
};

const seedBook = async (userId: string, id: string): Promise<string> => {
  await harness.prisma.book.create({
    data: { userId, id, title: 'Dune', size: 1, mtime: 0, addedAt: 0 },
  });
  return encodeGlobalID('Book', JSON.stringify([userId, id]));
};

describe('Mutation.bookRequestFulfill', () => {
  it('closes the request and links the book, for an admin', async () => {
    const alice = harness.aliceOwner.userId;
    const requestGid = await seedRequest(alice);
    const bookGid = await seedBook(alice, BOOK_ID);

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { id: requestGid, bookId: bookGid },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookRequestFulfill).toEqual({
      __typename: 'BookRequestFulfillPayload',
      bookRequest: { status: 'FULFILLED', book: { title: 'Dune' } },
    });
  });

  it('refuses a book from a different library', async () => {
    const alice = harness.aliceOwner.userId;
    const requestGid = await seedRequest(alice);
    const bobBookGid = await seedBook(harness.bobOwner.userId, 'b'.repeat(32));

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { id: requestGid, bookId: bobBookGid },
    });

    expect((result.data?.bookRequestFulfill as { __typename: string }).__typename).toBe(
      'InvalidInputError'
    );
    const row = await harness.prisma.bookRequest.findFirstOrThrow();
    expect(row.status).toBe('pending');
  });

  it('reports an already-resolved request instead of overwriting it', async () => {
    const alice = harness.aliceOwner.userId;
    const requestGid = await seedRequest(alice);
    const bookGid = await seedBook(alice, BOOK_ID);
    await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { id: requestGid, bookId: bookGid },
    });

    const again = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { id: requestGid, bookId: bookGid },
    });

    expect(again.data?.bookRequestFulfill).toEqual({
      __typename: 'BookRequestNotPendingError',
      message: 'This request has already been fulfilled.',
      status: 'FULFILLED',
    });
  });

  it('refuses a non-admin, even the request owner', async () => {
    const alice = harness.aliceOwner.userId;
    const requestGid = await seedRequest(alice);
    const bookGid = await seedBook(alice, BOOK_ID);

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: requestGid, bookId: bookGid },
    });

    expect(result.errors).toBeDefined();
    const row = await harness.prisma.bookRequest.findFirstOrThrow();
    expect(row.status).toBe('pending');
  });

  it('returns null for a request that does not exist', async () => {
    const bookGid = await seedBook(harness.aliceOwner.userId, BOOK_ID);
    const missing = encodeGlobalID(
      'BookRequest',
      JSON.stringify([harness.aliceOwner.userId, 'no-such-request'])
    );

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { id: missing, bookId: bookGid },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookRequestFulfill ?? null).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing decline test**

Create `app/server/graphql/schema/book-request/mutation/decline.test.ts` with the same harness scaffolding (`createHarness`, `seedRequest` as above, `vi.mock('../../../../logger')`) and:

```ts
const MUTATION = `
  mutation Decline($id: ID!, $reason: String) {
    bookRequestDecline(id: $id, reason: $reason) {
      __typename
      ... on BookRequestDeclinePayload { bookRequest { status declineReason } }
      ... on BookRequestNotPendingError { message status }
    }
  }
`;

describe('Mutation.bookRequestDecline', () => {
  it('closes the request with the reason, for an admin', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { id: gid, reason: "Couldn't find a copy" },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookRequestDecline).toEqual({
      __typename: 'BookRequestDeclinePayload',
      bookRequest: { status: 'DECLINED', declineReason: "Couldn't find a copy" },
    });
  });

  it('accepts an omitted reason', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { id: gid },
    });
    expect(result.data?.bookRequestDecline).toEqual({
      __typename: 'BookRequestDeclinePayload',
      bookRequest: { status: 'DECLINED', declineReason: '' },
    });
  });

  it('reports an already-resolved request', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    await harness.execute(MUTATION, { viewer: harness.adminViewer, variables: { id: gid } });

    const again = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { id: gid },
    });

    expect(again.data?.bookRequestDecline).toEqual({
      __typename: 'BookRequestNotPendingError',
      message: 'This request has already been declined.',
      status: 'DECLINED',
    });
  });

  it('refuses a non-admin', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: gid },
    });
    expect(result.errors).toBeDefined();
  });
});
```

- [ ] **Step 3: Run both and watch them fail**

Run: `npx vitest run graphql/schema/book-request/mutation --root app/server`
Expected: FAIL — `Cannot query field "bookRequestFulfill"` / `"bookRequestDecline"`.

- [ ] **Step 4: Write `fulfill.ts`**

Create `app/server/graphql/schema/book-request/mutation/fulfill.ts`:

```ts
import { fulfillBookRequest } from '../../../../services/book-request';
import {
  bookRequestNotPendingError,
  model as bookRequestNotPendingErrorModel,
} from '../../book-request-not-pending-error/model';
import { builder } from '../../builder';
import {
  invalidInputIssue,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { parseCompoundId } from '../../node-scope';
import { model as bookRequestModel } from '../model';

type BookRequestFulfillPayloadShape = {
  readonly __typename: 'BookRequestFulfillPayload';
  readonly userId: string;
  readonly requestId: string;
};

const payload = builder
  .objectRef<BookRequestFulfillPayloadShape>('BookRequestFulfillPayload')
  .implement({
    fields: (t) => ({
      bookRequest: t.prismaField({
        type: bookRequestModel,
        resolve: (query, parent, _args, context) =>
          context.prisma.bookRequest.findUniqueOrThrow({
            ...query,
            where: { userId_id: { userId: parent.userId, id: parent.requestId } },
          }),
      }),
    }),
  });

const result = builder.unionType('BookRequestFulfillResult', {
  types: [payload, invalidInputErrorModel, bookRequestNotPendingErrorModel],
});

/**
 * Links a book to a request and closes it — the mutation the upload queue fires
 * on its own when an item bound to a request finishes, and the one the admin's
 * "link an existing book" picker calls by hand. Two entry points, one mutation.
 *
 * BOTH `id` ARGS ARE GLOBAL IDS. A `BookRequest` global id decodes to
 * `[userId, id]` and a `Book` global id to `[userId, id]` too, through
 * `parseCompoundId` — the same helper `ownerScopedFindUnique` uses. `bookId` is
 * a global id rather than a raw content hash both because every mutation here
 * takes global ids and because the client half is forbidden from handling a raw
 * book id at all (`provider/upload`'s documented constraint).
 *
 * A NULL RESULT MEANS "no such request", and says nothing more. A book that is
 * not in the request owner's library is `InvalidInputError`, not a distinct
 * member: a more specific answer would confirm which library does have it.
 *
 * No `toResult`: `fulfillBookRequest` throws nothing — every outcome is a value
 * it decided inside its own transaction.
 */
builder.mutationField('bookRequestFulfill', (t) =>
  t.field({
    type: result,
    nullable: true,
    description: 'Marks a request fulfilled by a book in that reader library.',
    args: {
      id: t.arg.id({ required: true }),
      bookId: t.arg.id({ required: true }),
    },
    authScopes: { admin: true },
    resolve: async (_parent, args, context) => {
      const request = parseCompoundId(String(args.id));
      const book = parseCompoundId(String(args.bookId));
      if (request === null || book === null) {
        return invalidInputIssue(['id'], 'Malformed identifier');
      }

      const [userId, requestId] = request;
      const [bookUserId, bookId] = book;

      const outcome = await fulfillBookRequest(context.prisma, {
        userId,
        id: requestId,
        bookUserId,
        bookId,
      });

      switch (outcome.kind) {
        case 'resolved':
          return { __typename: 'BookRequestFulfillPayload' as const, userId, requestId };
        case 'missing':
          return null;
        case 'notPending':
          return bookRequestNotPendingError(outcome.status);
        case 'noSuchBook':
          return invalidInputIssue(['bookId'], 'That book is not in this reader library');
      }
    },
  })
);
```

- [ ] **Step 5: Write `decline.ts`**

Create `app/server/graphql/schema/book-request/mutation/decline.ts` — same construction, with `BookRequestDeclinePayload`, `BookRequestDeclineResult` over `[payload, bookRequestNotPendingErrorModel]`, and:

```ts
    args: {
      id: t.arg.id({ required: true }),
      reason: t.arg.string({ required: false }),
    },
    authScopes: { admin: true },
    resolve: async (_parent, args, context) => {
      const request = parseCompoundId(String(args.id));
      if (request === null) return null;
      const [userId, requestId] = request;

      const outcome = await declineBookRequest(context.prisma, {
        userId,
        id: requestId,
        reason: args.reason ?? '',
      });

      switch (outcome.kind) {
        case 'resolved':
          return { __typename: 'BookRequestDeclinePayload' as const, userId, requestId };
        case 'missing':
          return null;
        case 'notPending':
          return bookRequestNotPendingError(outcome.status);
      }
    },
```

with this doc comment on the field:

```ts
/**
 * Turns a request down, with an optional reason the reader sees.
 *
 * A malformed id is `null`, not `InvalidInputError` — unlike `fulfill`, this
 * mutation has no second identifier for a client to get wrong, so "no such
 * request" is the whole of the answer.
 */
```

- [ ] **Step 6: Wire the side-effect imports**

`app/server/graphql/schema/book-request/index.ts`:

```ts
export { model } from './model';

import './mutation/create';
import './mutation/decline';
import './mutation/fulfill';
```

- [ ] **Step 7: Regenerate the SDL and run the tests**

Run: `npm run graphql:schema -w app/server`
Then: `npx vitest run graphql/schema/book-request --root app/server`
Expected: PASS, all nine new cases.

- [ ] **Step 8: Commit**

```bash
git add app/server/graphql
git commit -m "feat(server): bookRequestFulfill and bookRequestDecline

Both take global ids and decode them with parseCompoundId, the same helper
ownerScopedFindUnique uses. Fulfilling with a book from another library is an
InvalidInputError rather than a distinct member — a more specific answer would
confirm which library has it — and a missing request is a null result that says
nothing more.

A double resolve is BookRequestNotPendingError, so the second decision is
reported rather than silently overwriting the first.

SDL regenerated deliberately: adds both mutations, their payloads and unions."
```

---

## Task 9: `bookRequestDelete`

**Files:**
- Create: `app/server/graphql/schema/book-request/mutation/delete.ts`
- Test: `app/server/graphql/schema/book-request/mutation/delete.test.ts`
- Modify: `app/server/graphql/schema/book-request/index.ts`
- Modify: `app/server/graphql/schema.generated.graphql` (regenerated)

**Interfaces:**
- Consumes: `deleteBookRequest` (Task 3), `isOwnerOrAdmin` and `parseCompoundId` from `../node-scope`.
- Produces: the `bookRequestDelete` mutation field.

**This is the one mutation that is owner-or-admin, not admin-only.** It serves both "the reader withdraws a pending request" and "clear a resolved one off my list". The scope has to be computed from the id's own `userId`, because the row's owner is in the global id.

- [ ] **Step 1: Write the failing test**

Create `app/server/graphql/schema/book-request/mutation/delete.test.ts`, with the same scaffolding and `seedRequest` helper as Task 8:

```ts
const MUTATION = `
  mutation Delete($id: ID!) {
    bookRequestDelete(id: $id) { deletedId }
  }
`;

describe('Mutation.bookRequestDelete', () => {
  it('lets the owner withdraw their own request', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: gid },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookRequestDelete).toEqual({ deletedId: gid });
    expect(await harness.prisma.bookRequest.count()).toBe(0);
  });

  it('lets an admin clear a request', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { id: gid },
    });
    expect(result.data?.bookRequestDelete).toEqual({ deletedId: gid });
    expect(await harness.prisma.bookRequest.count()).toBe(0);
  });

  it('refuses another reader', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);

    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: { id: gid },
    });

    expect(result.data?.bookRequestDelete ?? null).toBeNull();
    expect(await harness.prisma.bookRequest.count()).toBe(1);
  });

  it('returns null for a request that is not there', async () => {
    const missing = encodeGlobalID(
      'BookRequest',
      JSON.stringify([harness.aliceOwner.userId, 'gone'])
    );
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: missing },
    });
    expect(result.data?.bookRequestDelete ?? null).toBeNull();
  });

  it('deletes a resolved request too', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    await harness.prisma.bookRequest.updateMany({ data: { status: 'declined' } });

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: gid },
    });
    expect(result.data?.bookRequestDelete).toEqual({ deletedId: gid });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run graphql/schema/book-request/mutation/delete.test.ts --root app/server`
Expected: FAIL — `Cannot query field "bookRequestDelete"`.

- [ ] **Step 3: Write the mutation**

Create `app/server/graphql/schema/book-request/mutation/delete.ts`:

```ts
import { deleteBookRequest } from '../../../../services/book-request';
import { builder } from '../../builder';
import { isOwnerOrAdmin, parseCompoundId } from '../../node-scope';

type BookRequestDeletePayloadShape = {
  readonly __typename: 'BookRequestDeletePayload';
  readonly deletedId: string;
};

/**
 * `deletedId` is the global id the caller passed, echoed back so a normalizing
 * client cache can evict the exact entry it already holds — the same contract
 * `BookDeletePayload.deletedId` carries.
 */
const payload = builder
  .objectRef<BookRequestDeletePayloadShape>('BookRequestDeletePayload')
  .implement({
    fields: (t) => ({
      deletedId: t.exposeID('deletedId'),
    }),
  });

/**
 * Withdraws or clears a request. THE ONE MUTATION HERE THAT IS OWNER-OR-ADMIN
 * rather than admin-only: it serves both "the reader withdraws a pending
 * request" and "clear a resolved one off my list", and the reader is the owner
 * in the first case.
 *
 * The scope is computed from the ID's OWN `userId`, not from `context.viewer`,
 * because the row's owner rides inside the global id — the same reasoning
 * `ownerScopedFindUnique` rests on. A caller who is neither gets `null`, the
 * same answer a request that does not exist gets, so nothing leaks about
 * whether another reader has that id.
 *
 * No union: there is no failure a client renders differently. Null is the whole
 * of "it is not there, or it is not yours".
 */
builder.mutationField('bookRequestDelete', (t) =>
  t.field({
    type: payload,
    nullable: true,
    description: 'Withdraws a pending request, or clears a resolved one.',
    // No field-level `authScopes`: `Mutation` is already `{ authenticated:
    // true }` at the type level and Pothos ANDs the two. The owner check
    // CANNOT be an `ownerOf` scope here, because the owner is not an argument —
    // it rides inside the compound global id and has to be parsed out first.
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const parsed = parseCompoundId(String(args.id));
      if (parsed === null) return null;
      const [userId, requestId] = parsed;

      if (!isOwnerOrAdmin(context.viewer, userId)) return null;

      const deleted = await deleteBookRequest(context.prisma, { userId, id: requestId });
      return deleted
        ? { __typename: 'BookRequestDeletePayload' as const, deletedId: String(args.id) }
        : null;
    },
  })
);
```

- [ ] **Step 4: Wire the side-effect import**

Add `import './mutation/delete';` to `app/server/graphql/schema/book-request/index.ts`, keeping the imports alphabetical.

- [ ] **Step 5: Regenerate the SDL and run everything**

Run: `npm run graphql:schema -w app/server`
Then: `npm run lint && npm test && npm run test:cost -w app/server`
Expected: exit 0 for all three. **This is the gate for the whole server half** — the client work starts from a green tree.

- [ ] **Step 6: Commit**

```bash
git add app/server/graphql
git commit -m "feat(server): bookRequestDelete, owner-or-admin

The only request mutation that is not admin-only: it serves the reader
withdrawing a pending request and either party clearing a resolved one. The
scope is computed from the id's own userId, since the row's owner rides inside
the global id, and a caller who is neither owner nor admin gets the same null a
missing request gets — so nothing leaks about another reader's ids.

Completes the server half. SDL regenerated deliberately."
```

---

## Task 10: Per-item upload targeting (a standalone bug fix)

**Files:**
- Modify: `app/client/src/provider/upload/hook/use-upload-transport.ts`
- Modify: `app/client/src/provider/upload/hook/use-upload-queue.ts:605` (the `addFiles` pass-through)
- Modify: `app/client/src/provider/upload/context.ts`
- Test: `app/client/src/provider/upload/hook/use-upload-transport.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  export type AddFileOptions = {
    target?: { libraryId: string; username: string };
    fulfillsRequestId?: string;
  };
  // TransportItem gains:
  //   targetUsername?: string;
  //   targetLibraryId?: string;
  //   fulfillsRequestId?: string;
  // UseUploadTransport.addFiles becomes:
  //   (files: FileList, options?: AddFileOptions) => void
  // useUploadTransport's callback becomes:
  //   (libraryId: string | undefined) => void
  ```

**This task fixes a real bug that exists today, with no book request involved.** `use-upload-transport.ts:203` reads `withTargetUserRef.current('/api/books/upload')` at **send** time, not at add time, and `withTargetUser` is derived from the admin's *global* library-switcher selection. So an admin who queues files for alice and then switches the switcher to bob has the still-queued items upload into **bob's** library. Capturing the target when the item is added closes that. Land this task on its own merits; the request binding in Task 11 then has somewhere to live.

- [ ] **Step 1: Write the failing tests**

Append to `app/client/src/provider/upload/hook/use-upload-transport.test.tsx`, following the existing file's harness and mocking style:

```tsx
  it('uploads to the target captured at add time, not the current switcher selection', async () => {
    // The switcher points at alice when the files are added.
    setTargetUsername('alice');
    const { result } = renderTransport();

    act(() => {
      result.current.addFiles(fileListOf('a.epub'), {
        target: { libraryId: 'lib-bob', username: 'bob' },
      });
    });

    // The admin switches to a third library while the item is still queued.
    act(() => setTargetUsername('carol'));
    await flushUploads();

    expect(lastXhr().url).toBe('/api/books/upload?user=bob');
  });

  it('falls back to the current switcher selection when no target is given', async () => {
    setTargetUsername('alice');
    const { result } = renderTransport();

    act(() => {
      result.current.addFiles(fileListOf('a.epub'));
    });
    await flushUploads();

    expect(lastXhr().url).toBe('/api/books/upload?user=alice');
  });

  it('regression: a switcher change mid-queue does not retarget a queued item', async () => {
    setTargetUsername('alice');
    const { result } = renderTransport();

    act(() => {
      result.current.addFiles(fileListOf('a.epub'), {
        target: { libraryId: 'lib-alice', username: 'alice' },
      });
    });
    act(() => setTargetUsername('bob'));
    await flushUploads();

    expect(lastXhr().url).toBe('/api/books/upload?user=alice');
  });

  it('reports the item own library id when the upload completes', async () => {
    const onUploaded = vi.fn();
    const { result } = renderTransport({ onUploaded });

    act(() => {
      result.current.addFiles(fileListOf('a.epub'), {
        target: { libraryId: 'lib-bob', username: 'bob' },
      });
    });
    await flushUploads();

    expect(onUploaded).toHaveBeenCalledWith('lib-bob');
  });
```

> Reuse whatever names the existing test file already uses for its XHR stub,
> its `withTargetUser` mock and its `FileList` builder; the four helpers above
> (`setTargetUsername`, `renderTransport`, `flushUploads`, `lastXhr`,
> `fileListOf`) are placeholders for those. Do not introduce a second stub.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/provider/upload --root app/client`
Expected: FAIL — `addFiles` takes one argument; `onUploaded` is called with none.

- [ ] **Step 3: Widen `TransportItem` and `addFiles`**

In `app/client/src/provider/upload/hook/use-upload-transport.ts`:

```ts
export type AddFileOptions = {
  /**
   * The library these bytes go to, captured AT ADD TIME. Without it the
   * transport reads the admin's GLOBAL switcher selection at SEND time, so an
   * admin who queues files for one reader and then switches libraries has the
   * still-queued items upload into the new target. That is a real bug this
   * option fixes, independent of book requests.
   */
  target?: { libraryId: string; username: string };
  /**
   * The `BookRequest` global id this upload fulfils, if it was started from a
   * request row. The queue fires `bookRequestFulfill` once when the item lands.
   */
  fulfillsRequestId?: string;
};
```

Add to `TransportItem`:

```ts
  /** Captured at add time — see `AddFileOptions.target`. */
  targetUsername?: string;
  /** Captured at add time, so `onUploaded` can evict the right library. */
  targetLibraryId?: string;
  /** See `AddFileOptions.fulfillsRequestId`. */
  fulfillsRequestId?: string;
```

Change the `UseUploadTransport['addFiles']` signature to
`(files: FileList, options?: AddFileOptions) => void`, and the hook's parameter
to `(onUploaded: (libraryId: string | undefined) => void)`.

- [ ] **Step 4: Use the captured target**

Replace the `xhr.open` line (currently `use-upload-transport.ts:203`):

```ts
          // `item.targetUsername` when the caller named one, else the global
          // switcher. Read from the ITEM, not from the ref, so a switcher
          // change while this item sat queued cannot retarget it.
          const url =
            item.targetUsername === undefined
              ? withTargetUserRef.current('/api/books/upload')
              : `/api/books/upload?user=${encodeURIComponent(item.targetUsername)}`;
          xhr.open('POST', url);
```

Replace `onUploadedRef.current();` in `xhr.onload` with:

```ts
          onUploadedRef.current(item.targetLibraryId);
```

Rewrite `addFiles`:

```ts
  const addFiles = useCallback((files: FileList, options?: AddFileOptions) => {
    const newItems: Item[] = Array.from(files).map((file) => ({
      id: String(nextIdRef.current++),
      file,
      fileName: file.name,
      fileSize: file.size,
      status: 'queued' as const,
      bytesUploaded: 0,
      targetUsername: options?.target?.username,
      targetLibraryId: options?.target?.libraryId,
      fulfillsRequestId: options?.fulfillsRequestId,
    }));
    setItems((prev) => [...prev, ...newItems]);
  }, []);
```

- [ ] **Step 5: Update the two consumers**

In `use-upload-queue.ts`, make `onUploaded` take the item's library and fall back to the ambient one:

```ts
  // `itemLibraryId` is the library the bytes ACTUALLY went to, captured on the
  // item at add time — not `useCurrentLibraryId()`, which is the admin's global
  // switcher selection and may have moved since. Falling back to it keeps every
  // pre-existing call site (an upload with no explicit target) behaving exactly
  // as before.
  const onUploaded = useCallback(
    (itemLibraryId: string | undefined) => {
      const evictId = itemLibraryId ?? libraryId;
      if (evictId !== undefined) {
        client.cache.evict({
          id: client.cache.identify({ __typename: 'Library', id: evictId }),
          fieldName: 'entries',
        });
        client.cache.gc();
      }
      void refetch();
    },
    [client, libraryId, refetch]
  );
```

Widen the queue's own `addFiles` type (`use-upload-queue.ts:109`) to
`(files: FileList, options?: AddFileOptions) => void`, and update the default in
`app/client/src/provider/upload/context.ts` to match.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/provider/upload --root app/client`
Expected: PASS, including every pre-existing case — no call site passes options yet, so the fallback path must stay identical.

- [ ] **Step 7: Full verification**

Run: `npm run lint && npm test`
Expected: exit 0 for both.

- [ ] **Step 8: Commit**

```bash
git add app/client/src/provider/upload
git commit -m "fix(client): capture the upload target when files are added

The transport read the admin's global library-switcher selection at SEND time,
so an admin who queued files for one reader and then switched libraries had the
still-queued items upload into the new target. The target is now captured on the
item at add time, and onUploaded evicts the library the bytes actually went to
rather than whichever one the switcher points at now.

A standalone fix — no book request is involved. addFiles also gains a
fulfillsRequestId option, unused until the queue wires it up."
```

---

## Task 11: Fire `bookRequestFulfill` when a bound upload lands

**Files:**
- Modify: `app/client/src/provider/upload/hook/use-upload-queue.ts`
- Create: `app/client/src/graphql/book-request.ts`
- Test: `app/client/src/provider/upload/hook/use-upload-queue.test.tsx`

**Interfaces:**
- Consumes: `TransportItem.fulfillsRequestId` and `bookGlobalId` (Task 10); the `bookRequestFulfill` mutation (Task 8).
- Produces: `BookRequestFulfillDocument` in `app/client/src/graphql/book-request.ts`.

**Fire exactly once per item.** Copy the `announcedRef` pattern from `page/upload/index.tsx:55` — a `useRef(new Set<string>())` of item ids already acted on, added to *before* the async call resolves so a re-render mid-flight cannot fire a second one.

- [ ] **Step 1: Write the document**

Create `app/client/src/graphql/book-request.ts`:

```ts
import { graphql } from '~/gql';

/**
 * Fired by the upload queue when an item bound to a request lands, and by the
 * admin's "link an existing book" picker. Both take GLOBAL ids — the raw
 * content-hash book id must never appear under `provider/upload/`.
 */
export const BookRequestFulfillDocument = graphql(`
  mutation BookRequestFulfill($id: ID!, $bookId: ID!) {
    bookRequestFulfill(id: $id, bookId: $bookId) {
      __typename
      ... on BookRequestFulfillPayload {
        bookRequest {
          id
          status
          resolvedAt
          book {
            id
            title
          }
        }
      }
      ... on BookRequestNotPendingError {
        message
        status
      }
      ... on InvalidInputError {
        message
      }
    }
  }
`);
```

The payload selects the request's own fields so Apollo reconciles the row in
every open list by normalization — no manual cache write.

- [ ] **Step 2: Write the failing tests**

Append to `app/client/src/provider/upload/hook/use-upload-queue.test.tsx`:

```tsx
  it('fulfils the bound request once when the item lands', async () => {
    const { fulfillCalls } = renderQueueWithItem({
      status: 'done',
      bookGlobalId: 'Qm9vazox',
      fulfillsRequestId: 'Qm9va1JlcXVlc3Q6MQ==',
    });

    await waitFor(() => expect(fulfillCalls()).toHaveLength(1));
    expect(fulfillCalls()[0]).toEqual({
      id: 'Qm9va1JlcXVlc3Q6MQ==',
      bookId: 'Qm9vazox',
    });
  });

  it('does not fire again on a re-render', async () => {
    const { fulfillCalls, rerender } = renderQueueWithItem({
      status: 'done',
      bookGlobalId: 'Qm9vazox',
      fulfillsRequestId: 'Qm9va1JlcXVlc3Q6MQ==',
    });
    await waitFor(() => expect(fulfillCalls()).toHaveLength(1));

    rerender();
    rerender();

    expect(fulfillCalls()).toHaveLength(1);
  });

  it('does not fire for an item with no bound request', async () => {
    const { fulfillCalls } = renderQueueWithItem({
      status: 'done',
      bookGlobalId: 'Qm9vazox',
    });
    await waitFor(() => expect(fulfillCalls()).toHaveLength(0));
  });

  it('does not fire for a bound item that failed to upload', async () => {
    const { fulfillCalls } = renderQueueWithItem({
      status: 'error',
      fulfillsRequestId: 'Qm9va1JlcXVlc3Q6MQ==',
    });
    await waitFor(() => expect(fulfillCalls()).toHaveLength(0));
  });
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run src/provider/upload/hook/use-upload-queue.test.tsx --root app/client`
Expected: FAIL — nothing calls the mutation.

- [ ] **Step 4: Wire the effect**

In `use-upload-queue.ts`, add the mutation hook alongside the existing ones and this effect after `const transport = useUploadTransport(onUploaded);`:

```ts
  /**
   * Item ids whose `bookRequestFulfill` has already been fired. Same guard
   * `page/upload`'s `announcedRef` uses, and for the same reason: this effect
   * runs on every render where `transport.items` changed, and a `done` item
   * stays `done`. The id is added BEFORE the call is awaited, so a re-render
   * while the mutation is in flight cannot fire a second one.
   */
  const fulfilledRef = useRef(new Set<string>());
  useEffect(() => {
    for (const item of transport.items) {
      if (item.status !== 'done') continue;
      if (item.fulfillsRequestId === undefined || item.bookGlobalId === undefined) continue;
      if (fulfilledRef.current.has(item.id)) continue;

      fulfilledRef.current.add(item.id);
      void fulfillRequest({
        variables: { id: item.fulfillsRequestId, bookId: item.bookGlobalId },
      });
    }
  }, [transport.items, fulfillRequest]);
```

**Do not add a retry here.** If the mutation fails, the book has landed and the
request stays pending; the admin closes it with the request row's "link an
existing book" picker (Task 14). A client-side retry was considered and rejected
in the spec: the item is session state, so a closed tab loses the retry and
leaves the request with no way to close but declining and re-requesting.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/provider/upload --root app/client`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/provider/upload app/client/src/graphql/book-request.ts
git commit -m "feat(client): fulfil the bound request when its upload lands

Guarded by a ref set added to before the mutation is awaited, so a re-render
mid-flight cannot fire twice — the same announcedRef pattern page/upload uses.

Deliberately no retry: the item is session state, so a closed tab would lose it
and strand the request. Recovery is the request row's link-an-existing-book
picker instead."
```

---

## Task 12: The reader's card on `/user`

**Files:**
- Create: `app/client/src/component/book-requests/index.tsx`, `style.ts`
- Create: `app/client/src/component/book-requests-content/index.tsx`, `style.ts`, `index.test.tsx`
- Create: `app/client/src/component/book-request-row/index.tsx`, `style.ts`, `index.test.tsx`
- Modify: `app/client/src/graphql/book-request.ts`
- Modify: `app/client/src/page/user/index.tsx`, `app/client/src/component/index.ts`

**Interfaces:**
- Consumes: `User.bookRequests`, `pendingBookRequestCount`, `bookRequestCreate`, `bookRequestDelete`.
- Produces: `<BookRequests />`; `BookRequestRowFragment`; `<BookRequestRow request={...} canResolve={false} />`.

**Follow `MyProgress` / `MyProgressContent` exactly.** `Card` with `isCollapsible defaultCollapsed` does not render its children into the tree while collapsed, so `BookRequestsContent` is never mounted and never fetches until the card is expanded. The count subtitle comes from a separate cheap query, as `MyProgressCountDocument` does. `BookRequests` renders only in `/user`'s non-admin branch — the config admin has no `User` row and cannot be a requester.

- [ ] **Step 1: Add the documents**

Append to `app/client/src/graphql/book-request.ts`:

```ts
/**
 * One request row, in both readings — the reader's own card and the admin's
 * per-user list. `book` is null in two cases the row renders differently: the
 * request is not fulfilled yet, and the book it was fulfilled with has since
 * been deleted (`onDelete: SetNull` on the server).
 */
export const BookRequestRowFragment = graphql(`
  fragment BookRequestRowFragment on BookRequest {
    id
    title
    author
    note
    status
    declineReason
    createdAt
    resolvedAt
    book {
      id
      title
    }
  }
`);

/** The count subtitle on the reader's collapsed card — cheap, no rows. */
export const MyBookRequestCountDocument = graphql(`
  query MyBookRequestCount {
    viewer {
      user {
        id
        pendingBookRequestCount
      }
    }
  }
`);

/**
 * The reader's own list. `first: 20` is a LITERAL, not a variable: the cost
 * model prices a variable page size at the field's `maxSize` (100), not the
 * value passed.
 */
export const MyBookRequestListDocument = graphql(`
  query MyBookRequestList($after: String) {
    viewer {
      user {
        id
        bookRequests(first: 20, after: $after) {
          edges {
            cursor
            node {
              id
              ...BookRequestRowFragment
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`);

export const BookRequestCreateDocument = graphql(`
  mutation BookRequestCreate($input: BookRequestCreateInput!) {
    bookRequestCreate(input: $input) {
      __typename
      ... on BookRequestCreatePayload {
        bookRequest {
          id
          ...BookRequestRowFragment
        }
      }
      ... on InvalidInputError {
        message
        issues {
          path
          message
        }
      }
      ... on BookRequestLimitExceededError {
        message
        limit
      }
      ... on DuplicateBookRequestError {
        message
        existingRequestId
      }
    }
  }
`);

export const BookRequestDeleteDocument = graphql(`
  mutation BookRequestDelete($id: ID!) {
    bookRequestDelete(id: $id) {
      deletedId
    }
  }
`);
```

- [ ] **Step 2: Write the failing row test**

Create `app/client/src/component/book-request-row/index.test.tsx`, following the existing component tests' render helper:

```tsx
describe('BookRequestRow', () => {
  it('shows title, author and a pending state', () => {
    renderRow({ status: 'PENDING', title: 'Dune', author: 'Frank Herbert' });
    expect(screen.getByText('Dune')).toBeInTheDocument();
    expect(screen.getByText(/Frank Herbert/)).toBeInTheDocument();
    expect(screen.getByText(/Pending/i)).toBeInTheDocument();
  });

  it('links to the book once fulfilled', () => {
    renderRow({ status: 'FULFILLED', book: { id: 'Qm9vazox', title: 'Dune' } });
    expect(screen.getByRole('link', { name: /Dune/ })).toHaveAttribute('href', '/book/Qm9vazox');
  });

  it('says the book was added even when the link is gone', () => {
    renderRow({ status: 'FULFILLED', book: null });
    expect(screen.getByText(/added to your library/i)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the decline reason when there is one', () => {
    renderRow({ status: 'DECLINED', declineReason: "Couldn't find a copy" });
    expect(screen.getByText(/Couldn't find a copy/)).toBeInTheDocument();
  });

  it('offers no resolve actions when canResolve is false', () => {
    renderRow({ status: 'PENDING' }, { canResolve: false });
    expect(screen.queryByRole('button', { name: /decline/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/component/book-request-row --root app/client`
Expected: FAIL — the module does not exist.

- [ ] **Step 4: Write `BookRequestRow`**

Create `app/client/src/component/book-request-row/index.tsx`. It unmasks its own
`BookRequestRowFragment` ref rather than having the parent unmask centrally —
the same contract `UserProgressRow` follows. Props:

```tsx
interface BookRequestRowProps {
  /** A masked `BookRequestRowFragment` ref, unmasked inside this component. */
  request: FragmentType<typeof BookRequestRowFragment>;
  /**
   * Whether to render the admin's resolve actions (upload, link an existing
   * book, decline). `false` on the reader's own card — a reader can withdraw a
   * request but never resolve one.
   */
  canResolve: boolean;
  /** Withdraw / clear. Both surfaces offer this; the server is owner-or-admin. */
  onDelete: (id: string) => void;
}
```

Render, in order: the title, `by {author}`, the note when non-empty, a status
chip, and then per status —

- `PENDING`: nothing extra on the reader's card; Task 14 fills the admin's actions in.
- `FULFILLED` with `book`: a `<Link to={`/book/${book.id}`}>` reading "Added to your library — {book.title}".
- `FULFILLED` without `book`: the plain text "Added to your library", no link. **This is not an error state** — the book was deleted after the fact (`onDelete: SetNull`).
- `DECLINED`: "Declined" plus `declineReason` when non-empty.

Every row gets a delete control, labelled "Withdraw" while `PENDING` and
"Clear" once resolved.

- [ ] **Step 5: Write the failing content test**

Create `app/client/src/component/book-requests-content/index.test.tsx`:

```tsx
describe('BookRequestsContent', () => {
  it('renders the reader own requests', async () => {
    renderContent({ requests: [{ title: 'Dune' }, { title: 'Neuromancer' }] });
    expect(await screen.findByText('Dune')).toBeInTheDocument();
    expect(screen.getByText('Neuromancer')).toBeInTheDocument();
  });

  it('fetches nothing while skipped', () => {
    const { queryCount } = renderContent({ skip: true });
    expect(queryCount()).toBe(0);
  });

  it('creates a request and clears the form', async () => {
    const { user, createCalls } = renderContent({ requests: [] });
    await user.type(screen.getByLabelText(/title/i), 'Dune');
    await user.type(screen.getByLabelText(/author/i), 'Frank Herbert');
    await user.click(screen.getByRole('button', { name: /request/i }));

    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(createCalls()[0].input).toMatchObject({ title: 'Dune', author: 'Frank Herbert' });
    expect(screen.getByLabelText(/title/i)).toHaveValue('');
  });

  it('will not submit without both title and author', async () => {
    const { user, createCalls } = renderContent({ requests: [] });
    await user.type(screen.getByLabelText(/title/i), 'Dune');
    await user.click(screen.getByRole('button', { name: /request/i }));

    expect(createCalls()).toHaveLength(0);
    expect(screen.getByText(/author is required/i)).toBeInTheDocument();
  });

  it('surfaces the cap', async () => {
    const { user } = renderContent({
      requests: [],
      createResult: { __typename: 'BookRequestLimitExceededError', message: 'Too many', limit: 10 },
    });
    await user.type(screen.getByLabelText(/title/i), 'Dune');
    await user.type(screen.getByLabelText(/author/i), 'Frank Herbert');
    await user.click(screen.getByRole('button', { name: /request/i }));

    expect(await screen.findByText('Too many')).toBeInTheDocument();
  });

  it('surfaces a duplicate', async () => {
    const { user } = renderContent({
      requests: [],
      createResult: {
        __typename: 'DuplicateBookRequestError',
        message: 'You have already requested this book.',
        existingRequestId: 'req-1',
      },
    });
    await user.type(screen.getByLabelText(/title/i), 'Dune');
    await user.type(screen.getByLabelText(/author/i), 'Frank Herbert');
    await user.click(screen.getByRole('button', { name: /request/i }));

    expect(await screen.findByText(/already requested/i)).toBeInTheDocument();
  });

  it('shows the empty state with the form still available', async () => {
    renderContent({ requests: [] });
    expect(await screen.findByText(/no requests yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Write `BookRequestsContent`**

Create `app/client/src/component/book-requests-content/index.tsx`, modelled on
`component/my-progress-content`:

- `usePaginatedConnection({ document: MyBookRequestListDocument, variables: {}, skip, select: (d) => d?.viewer.user?.bookRequests, resetKey: String(skip), loadMoreErrorMessage: 'Failed to load more requests' })`.
- `skip` is a **required, explicit prop**, for the reason `MyProgressContent`'s own doc comment gives: the component's tests gate the query directly rather than depending on `Card`'s mount timing as an implicit contract.
- The create form above the list: `TextInput` for title and author, `TextArea` for the note, a submit `Button`. Client-side, both title and author must be non-empty after trimming — the same rule the server's zod schema applies, checked here so the round trip is not spent on an obvious miss.
- On a `BookRequestCreatePayload`, clear the form and let Apollo's normalization add the row; on any error member, render its `message` next to the form.
- `onDelete` runs `BookRequestDeleteDocument` and evicts the returned `deletedId` from the cache.
- Loading, first-page error, and empty states follow `MyProgressContent`'s three-branch shape exactly.

- [ ] **Step 7: Write `BookRequests` and mount it**

Create `app/client/src/component/book-requests/index.tsx`:

```tsx
/**
 * The reader's request card on `/user`. Mirrors `MyProgress`: the subtitle
 * reads a cheap dedicated count query, and `Card`'s
 * `isCollapsible`/`defaultCollapsed` pair does not render children into the
 * tree while collapsed — so `BookRequestsContent` is never mounted, and never
 * fetches a row, until the card is expanded. `skip={false}` is therefore always
 * correct at this one call site.
 *
 * Rendered only in `/user`'s NON-ADMIN branch: the config admin has no `User`
 * row, so `viewer.user` is null and it cannot be a requester.
 */
export const BookRequests = () => {
  const styles = useStyle();
  const { data } = useQuery(MyBookRequestCountDocument);
  const pending = data?.viewer.user?.pendingBookRequestCount;

  return (
    <Card
      title="Book requests"
      isCollapsible
      defaultCollapsed
      subTitle={
        pending !== undefined
          ? `${pending} request${pending === 1 ? '' : 's'} pending`
          : undefined
      }
    >
      <div className={styles.content}>
        <BookRequestsContent skip={false} />
      </div>
    </Card>
  );
};
```

Export both new components from `app/client/src/component/index.ts`, and mount
`<BookRequests />` in `app/client/src/page/user/index.tsx`'s non-admin return,
after `<SyncPassword />`.

- [ ] **Step 8: Run the tests and the cost budget**

Run: `npx vitest run src/component/book-request --root app/client`
Then: `npm run lint && npm test && npm run test:cost -w app/server`
Expected: exit 0. The two new client documents are priced automatically off
`persisted-documents.json`; if a budget moves, report before/after.

- [ ] **Step 9: Commit**

```bash
git add app/client/src
git commit -m "feat(client): the reader's book-requests card on /user

Mirrors MyProgress: a cheap count query drives the subtitle, and Card does not
render children while collapsed, so the list and its query are never mounted
until the reader expands it. Rendered only in the non-admin branch — the config
admin has no User row and cannot be a requester.

A fulfilled request whose book was later deleted renders 'added to your library'
without a link, which is correct, not an error state."
```

---

## Task 13: The admin's per-user list and the pending badge

**Files:**
- Create: `app/client/src/component/user-request-list/index.tsx`, `style.ts`, `index.test.tsx`
- Modify: `app/client/src/component/user-row-content/index.tsx`
- Modify: `app/client/src/component/user-row/index.tsx`
- Modify: `app/client/src/graphql/book-request.ts`
- Modify: `app/client/src/component/index.ts`

**Interfaces:**
- Consumes: `BookRequestRowFragment` and `<BookRequestRow />` (Task 12).
- Produces: `UserRequestListDocument`; `<UserRequestList userId={...} skip={...} />`.

**Declare the document in the component, not the route.** `user-row-content`'s own doc comment spells out why: it is a child of `Card`'s collapsible pair and is never mounted while collapsed, and hoisting a per-user document to the per-viewer `page/user-list` would fetch it for every user on every visit under `Viewer.users`'s ×50 multiplier. A **separate** document from `UserProgressListDocument`, because the two lists page independently.

- [ ] **Step 1: Add the document**

Append to `app/client/src/graphql/book-request.ts`:

```ts
/**
 * The admin's view of ONE user's requests. Rooted at `Query.user(id:)`, which
 * is admin-only — correct here, since this list renders only for admins.
 *
 * `first: 20` is a LITERAL for the same pricing reason as the reader's list.
 */
export const UserRequestListDocument = graphql(`
  query UserRequestList($userId: ID!, $after: String) {
    user(id: $userId) {
      id
      bookRequests(first: 20, after: $after) {
        edges {
          cursor
          node {
            id
            ...BookRequestRowFragment
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`);
```

- [ ] **Step 2: Write the failing test**

Create `app/client/src/component/user-request-list/index.test.tsx`:

```tsx
describe('UserRequestList', () => {
  it('renders the target user requests', async () => {
    renderList({ requests: [{ title: 'Dune' }] });
    expect(await screen.findByText('Dune')).toBeInTheDocument();
  });

  it('fetches nothing while skipped', () => {
    const { queryCount } = renderList({ skip: true });
    expect(queryCount()).toBe(0);
  });

  it('shows an empty state', async () => {
    renderList({ requests: [] });
    expect(await screen.findByText(/no requests/i)).toBeInTheDocument();
  });

  it('roots at the target user, not the viewer', async () => {
    const { variables } = renderList({ userId: 'VXNlcjphbGljZQ==', requests: [] });
    await waitFor(() => expect(variables()).toMatchObject({ userId: 'VXNlcjphbGljZQ==' }));
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/component/user-request-list --root app/client`
Expected: FAIL — the module does not exist.

- [ ] **Step 4: Write `UserRequestList`**

Create `app/client/src/component/user-request-list/index.tsx`, structurally a
copy of `UserRowContent`'s list half: `usePaginatedConnection` over
`UserRequestListDocument`, `resetKey: \`${userId}:${skip}\``, the same
loading / first-page-error / empty three-branch shape, and a `Load more` button
plus an inline retry on a `fetchMore` failure. Rows are
`<BookRequestRow request={node} canResolve onDelete={...} />` — `canResolve` is
`true` here and `false` on the reader's card.

- [ ] **Step 5: Mount it and add the badge**

In `user-row-content/index.tsx`, render `<UserRequestList userId={userId} skip={skip} />`
above the progress rows, under its own small heading, and pass `skip` straight
through — the same prop this component already receives.

In `user-row/index.tsx`, render the `pendingBookRequestCount` badge in the row
header when it is greater than zero. The count is already on the `Viewer.users`
read `page/user-list` performs, so **add the field to the existing
`UserRowFragment` rather than issuing a new query** — it is a filtered
`t.relationCount` and merges into that read.

- [ ] **Step 6: Run everything**

Run: `npx vitest run src/component --root app/client`
Then: `npm run lint && npm test && npm run test:cost -w app/server`
Expected: exit 0. `UserList`'s cost will move — the badge adds a scalar under
`Viewer.users`'s multiplier. Record before/after in the commit message.

- [ ] **Step 7: Commit**

```bash
git add app/client/src
git commit -m "feat(client): the admin's per-user request list and pending badge

The document is declared on the component, not the route, for the reason
user-row-content's own comment gives: it is never mounted while the card is
collapsed, and hoisting a per-user document to the per-viewer route would fetch
it for every user on every visit under Viewer.users's x50 multiplier. Separate
from UserProgressListDocument because the two lists page independently.

The badge reads pendingBookRequestCount off the existing UserRowFragment — a
filtered relationCount that merges into the read page/user-list already makes."
```

---

## Task 14: The request row's resolve actions

**Files:**
- Modify: `app/client/src/component/book-request-row/index.tsx`, `style.ts`, `index.test.tsx`
- Create: `app/client/src/control/link-existing-book-modal/index.tsx`, `style.ts`, `index.test.tsx`
- Modify: `app/client/src/control/index.ts`
- Modify: `app/client/src/graphql/book-request.ts`

**Interfaces:**
- Consumes: `addFiles(files, options)` (Task 10), `BookRequestFulfillDocument` (Task 11), `bookRequestDecline`.
- Produces: `<LinkExistingBookModal libraryId={...} onPick={(bookGlobalId) => void} />`.

**This is where Approach B lands.** The row's upload control calls the
session-wide queue's `addFiles` with **both** options — the target library and
the request id — so the bytes go to that reader's library whatever the global
switcher says, and the queue closes the request when they land.

**Fix review stays out of this row.** The pending-fix merge in
`use-upload-queue.ts` is rooted on the *global* switcher, so a book uploaded
into bob's library while the switcher points at alice has no row to merge.
Rather than make that query per-item, the row shows progress, errors, EPUB
validation failures, and on success a link to the new book plus
"N suggestions — review in Upload". The count reads `TransportItem.proposals`,
which the transport already stores from the XHR response, so the row needs no
extra query.

- [ ] **Step 1: Add the decline document**

Append to `app/client/src/graphql/book-request.ts`:

```ts
export const BookRequestDeclineDocument = graphql(`
  mutation BookRequestDecline($id: ID!, $reason: String) {
    bookRequestDecline(id: $id, reason: $reason) {
      __typename
      ... on BookRequestDeclinePayload {
        bookRequest {
          id
          ...BookRequestRowFragment
        }
      }
      ... on BookRequestNotPendingError {
        message
        status
      }
    }
  }
`);
```

- [ ] **Step 2: Write the failing tests**

Append to `app/client/src/component/book-request-row/index.test.tsx`:

```tsx
describe('BookRequestRow resolve actions', () => {
  it('queues an upload against this reader library and this request', async () => {
    const { user, addFilesCalls } = renderRow(
      { id: 'QmVxOjE=', status: 'PENDING' },
      { canResolve: true, libraryId: 'TGliOmJvYg==', username: 'bob' }
    );

    await user.upload(screen.getByLabelText(/upload epub/i), epubFile('dune.epub'));

    expect(addFilesCalls()).toHaveLength(1);
    expect(addFilesCalls()[0].options).toEqual({
      target: { libraryId: 'TGliOmJvYg==', username: 'bob' },
      fulfillsRequestId: 'QmVxOjE=',
    });
  });

  it('shows the suggestion count and points at Upload, with no fix review here', async () => {
    renderRow(
      { id: 'QmVxOjE=', status: 'PENDING' },
      {
        canResolve: true,
        queueItem: { status: 'done', bookGlobalId: 'Qm9vazox', proposals: [{}, {}, {}] },
      }
    );

    expect(await screen.findByText(/3 suggestions/i)).toBeInTheDocument();
    expect(screen.getByText(/review in upload/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument();
  });

  it('says the upload landed but the request did not close', async () => {
    renderRow(
      { id: 'QmVxOjE=', status: 'PENDING' },
      { canResolve: true, queueItem: { status: 'done', bookGlobalId: 'Qm9vazox' }, fulfillFailed: true }
    );

    expect(await screen.findByText(/didn't close/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /link existing book/i })).toBeInTheDocument();
  });

  it('fulfils from the picker', async () => {
    const { user, fulfillCalls } = renderRow(
      { id: 'QmVxOjE=', status: 'PENDING' },
      { canResolve: true, libraryId: 'TGliOmJvYg==' }
    );

    await user.click(screen.getByRole('button', { name: /link existing book/i }));
    await user.click(await screen.findByRole('button', { name: /Dune/ }));

    await waitFor(() => expect(fulfillCalls()).toHaveLength(1));
    expect(fulfillCalls()[0]).toEqual({ id: 'QmVxOjE=', bookId: 'Qm9vazox' });
  });

  it('declines with a reason', async () => {
    const { user, declineCalls } = renderRow(
      { id: 'QmVxOjE=', status: 'PENDING' },
      { canResolve: true }
    );

    await user.click(screen.getByRole('button', { name: /decline/i }));
    await user.type(screen.getByLabelText(/reason/i), "Couldn't find a copy");
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(declineCalls()).toHaveLength(1));
    expect(declineCalls()[0]).toEqual({ id: 'QmVxOjE=', reason: "Couldn't find a copy" });
  });

  it('shows an upload error on the row', async () => {
    renderRow(
      { id: 'QmVxOjE=', status: 'PENDING' },
      { canResolve: true, queueItem: { status: 'error', errorMessage: 'Not an EPUB' } }
    );
    expect(await screen.findByText('Not an EPUB')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run src/component/book-request-row --root app/client`
Expected: FAIL — the row renders no actions.

- [ ] **Step 4: Write `LinkExistingBookModal`**

Create `app/client/src/control/link-existing-book-modal/index.tsx`, modelled on
`control/link-progress-modal` — which already picks a book from a **named**
library rather than from `useCurrentLibraryId()`, and is the closest existing
precedent. It takes the target reader's `libraryId`, lists that library's
entries with a search box, and calls `onPick(bookGlobalId)`. Export it from
`app/client/src/control/index.ts`.

- [ ] **Step 5: Extend `BookRequestRow`**

Widen the props:

```tsx
interface BookRequestRowProps {
  request: FragmentType<typeof BookRequestRowFragment>;
  canResolve: boolean;
  onDelete: (id: string) => void;
  /**
   * The owning reader's Library global id and username. Required whenever
   * `canResolve` is true — both halves are what `addFiles` captures on the
   * item so the bytes reach THIS reader's library whatever the global
   * library-switcher says.
   */
  target?: { libraryId: string; username: string };
}
```

When `canResolve` and the request is `PENDING`, render three controls:

- **Upload EPUB** — a file input calling
  `addFiles(files, { target, fulfillsRequestId: request.id })`. That is the whole
  of Approach B: the target and the request binding are both captured on the
  item at add time, and the queue fires `bookRequestFulfill` when it lands.
- **Link existing book** — opens `LinkExistingBookModal` rooted at
  `target.libraryId` and runs `BookRequestFulfillDocument` with the picked
  `bookGlobalId`. This is also the recovery path when auto-fulfil failed.
- **Decline** — a small reason prompt, then `BookRequestDeclineDocument`.

Find this row's live queue item by `fulfillsRequestId === request.id` from the
upload context, and render from it:

- `uploading`: a progress indicator.
- `error`: `errorMessage`, or the EPUB `validation` failure when there is one.
- `done`: a link to `bookGlobalId`, plus, when `proposals.length > 0`,
  "{n} suggestions — review in Upload". **No fix review controls here** — see
  this task's preamble.
- `done` with the request still `PENDING` after the fulfil attempt:
  "Uploaded, but the request didn't close." beside the **Link existing book**
  button.

Pass `target` down from `UserRequestList`, which has the target user's
`library.id` on its own document — add `library { id }` to
`UserRequestListDocument`'s `user` selection, exactly as `UserRowContent`
already reads `data?.user?.library?.id` for `LinkProgressModal`.

- [ ] **Step 6: Run everything**

Run: `npx vitest run src --root app/client`
Then: `npm run lint && npm test && npm run test:cost -w app/server`
Expected: exit 0 for all three.

- [ ] **Step 7: Manual check against the running app**

Use the `run` skill to start the app, then, as an admin with two readers:

1. Sign in as a reader, expand **Book requests**, request a book. Confirm the cap message after ten, and the duplicate message on an identical title/author.
2. As the admin on `/users`, confirm the badge, expand the reader's card, and confirm the request is listed.
3. **Point the global library switcher at the OTHER reader**, then upload an EPUB from the request row. Confirm the book lands in the *requesting* reader's library, not the switcher's, and that the request closes itself.
4. Confirm proposals show as "N suggestions — review in Upload" and that `/upload` still offers the full review.
5. Decline a second request with a reason; confirm the reader sees it.
6. Withdraw a pending request as the reader; confirm it disappears.

Step 3 is the one that proves Approach B — it is exactly the case the old global
targeting got wrong.

- [ ] **Step 8: Commit**

```bash
git add app/client/src
git commit -m "feat(client): upload, link and decline from the request row

The row's upload calls addFiles with both the target library and the request id,
so the bytes reach the requesting reader whatever the global switcher says and
the queue closes the request when they land — Approach B, end to end.

Fix review stays on /upload: the pending-fix merge is rooted on the global
switcher, so a book uploaded into another library has no row to merge here. The
row shows the suggestion count off TransportItem.proposals, which the transport
already stores, and links out.

Link existing book is the recovery path when auto-fulfil fails, and the route
for an admin who uploaded the book before opening the request."
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task:

| Spec | Task |
| --- | --- |
| §3 Prisma model, migration | 1 |
| §3 service, cap, dedupe, transaction | 2, 3 |
| §3 `BookRequest` prismaNode, compound id, node guard | 4 |
| §3 one `User.bookRequests`, keyset, `CONNECTION_LIMITS` | 5 |
| §3 `pendingBookRequestCount` | 6 |
| §3 four mutations and their error members | 7, 8, 9 |
| §4 reader card on `/user` | 12 |
| §4 admin list in `user-row-content`, badge | 13 |
| §4 `addFiles` options, `targetUsername`, `onUploaded(libraryId)` | 10 |
| §4 `fulfillsRequestId`, fire-once | 11 |
| §4 fix review stays out; suggestion count from `proposals` | 14 |
| §4 "link an existing book" recovery | 14 |
| §4 no live updates | 12, 13 (no subscription anywhere) |
| §5 migration test, server tests, client tests | 1–14, each task's own |
| §5 SDL regenerated deliberately | 4, 5, 6, 7, 8, 9 |
| §5 literal page sizes, cost budgets | 12, 13 |
| §5 rollout: additive, no flag, no config option | 1, 2 |

Two spec items are deliberately *not* separate tasks: `MAX_OPEN_BOOK_REQUESTS`
staying a constant is realised in Task 2, and "no live updates" is realised by
the absence of any subscription — there is nothing to implement.

**Placeholder scan.** No "TBD", no "add appropriate error handling", no "similar
to Task N", no "write tests for the above". Two "confirm before writing" notes
that an earlier draft carried were **resolved into the plan rather than left for
the executor**, because both were wrong as drafted:

- There is no `loggedIn` auth scope. The scopes are `authenticated`,
  `passwordChangeAllowed`, `admin` and `ownerOf` (`schema/builder.ts:104`), and
  `builder.mutationType({ authScopes: { authenticated: true } })` already gates
  every mutation at the type level, with Pothos ANDing type and field scopes. So
  `bookRequestCreate` and `bookRequestDelete` carry **no** field-level scope,
  and only the two admin mutations declare one.
- This project is on **zod 4**, whose `$ZodIssue` carries more than
  `{ code, path, message }`. Task 8 no longer hand-builds a `ZodError`; Task 7
  Step 1b adds an `invalidInputIssue(path, message)` factory instead, and Task 8
  uses it at both call sites.

**One carry-forward note, flagged inline where it bites:**

- **Task 4 Step 4 depends on Task 5.** The `seedNodeFor('BookRequest')` branch reads through `User.bookRequests`, which Task 5 adds. Run the two together if you want a green tree at every commit; hand-encoding the global id instead is what every other branch's comment warns against.

**Type consistency, checked across tasks:** `CreateBookRequestOutcome`'s three
kinds are exhausted by Task 7's switch; `FulfillOutcome`'s four and
`ResolveOutcome`'s three by Task 8's; `requestKeyset` is defined in Task 5 Step 4
and consumed in Step 5; `AddFileOptions` is defined in Task 10 and consumed in
Task 14; `BookRequestRowFragment` is defined in Task 12 and consumed in Tasks 13
and 14; `BookRequestRow`'s props gain `target` in Task 14 as an explicit
widening of the Task 12 shape.
