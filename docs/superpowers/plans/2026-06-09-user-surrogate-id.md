# User Surrogate ID Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a NanoID surrogate primary key to the `users` table and migrate `progress` foreign keys from `username` to `user_id`, enabling future username renames with no FK cascades.

**Architecture:** A new Prisma migration recreates `users` (id PK, username UNIQUE) and `progress` (user_id FK). `UserStore.authenticate` and `validateUser` return `string | false` (the user ID) instead of `boolean`. The ID flows into `express-session` at login and into `req.kosyncUserId` via `kosyncAuth` middleware, so progress methods take `userId` directly with no extra lookups.

**Tech Stack:** Prisma 7 (SQLite/better-sqlite3), nanoid v3 (customAlphabet, CJS-compatible), Express session, TypeScript strict mode.

---

## File Map

| Action | Path | Change |
|--------|------|--------|
| Modify | `app/server/package.json` | add `nanoid@3` dependency |
| Create | `app/server/prisma/migrations/0004_add_user_id/migration.sql` | DDL migration |
| Modify | `app/server/prisma/schema.prisma` | User id PK, username @unique; Progress userId FK |
| Modify | `app/server/services/user-store.ts` | authenticate/validateUser return type; createUser generates ID; progress methods accept userId; add getUserIdByUsername; simplify deleteUser |
| Modify | `app/server/global.d.ts` | add `kosyncUserId` to Request; add `userId` to SessionData |
| Modify | `app/server/middleware/auth.ts` | kosyncAuth sets `req.kosyncUserId` |
| Modify | `app/server/routes/ui.ts` | login stores `req.session.userId`; progress routes use `req.session.userId` |
| Modify | `app/server/routes/kosync.ts` | use `req.kosyncUserId!` for saveProgress/getProgress |
| Modify | `app/server/routes/users.ts` | admin progress routes use `getUserIdByUsername` |
| Modify | `app/server/services/book-store.ts` | username→userId in progress conflict resolution |
| Modify | `app/server/services/user-store.test.ts` | authenticate/validateUser return type; progress tests use userId |
| Modify | `app/server/routes/users.test.ts` | saveProgress calls use userId |
| Modify | `app/server/routes/kosync.test.ts` | direct progress SQL uses user_id |
| Modify | `app/server/routes/ui.test.ts` | direct prisma.progress.create uses userId |
| Modify | `app/server/services/book-store.test.ts` | direct prisma.progress.create uses userId; migration test seeds users |

---

## Task 1: Install nanoid v3

nanoid v4+ is ESM-only. v3 is the last CJS-compatible release and works with this project's `module: commonjs` tsconfig.

**Files:**
- Modify: `app/server/package.json`

- [ ] **Step 1: Add nanoid to package.json**

In `app/server/package.json`, add to `"dependencies"`:
```json
"nanoid": "^3.3.8"
```

- [ ] **Step 2: Install**

```bash
cd app/server && npm install
```

Expected: `added 1 package` (or similar), no errors.

- [ ] **Step 3: Verify import works**

```bash
cd app/server && node -e "const { customAlphabet } = require('nanoid'); const gen = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 21); console.log(gen());"
```

Expected: a 21-character alphanumeric string printed to stdout.

- [ ] **Step 4: Commit**

```bash
git add app/server/package.json app/server/package-lock.json
git commit -m "chore: add nanoid v3 dependency"
```

---

## Task 2: Prisma Schema + Migration SQL + Regenerate Client

**Files:**
- Modify: `app/server/prisma/schema.prisma`
- Create: `app/server/prisma/migrations/0004_add_user_id/migration.sql`

- [ ] **Step 1: Update schema.prisma**

Replace the `User` and `Progress` models with:

```prisma
model User {
  id         String     @id
  username   String     @unique
  key        String
  progresses Progress[]

  @@map("users")
}

model Progress {
  userId     String  @map("user_id")
  document   String
  progress   String
  percentage Float
  device     String
  deviceId   String  @map("device_id")
  timestamp  Int
  user       User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, document])
  @@map("progress")
}
```

- [ ] **Step 2: Create migration SQL**

Create file `app/server/prisma/migrations/0004_add_user_id/migration.sql`:

```sql
-- Ensure users table exists before we alter it (defensive guard for legacy test databases)
CREATE TABLE IF NOT EXISTS "users" (
    "username" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL
);

-- Add id column (nullable for now so we can backfill)
ALTER TABLE "users" ADD COLUMN "id" TEXT;

-- Backfill IDs for existing rows using SQLite random bytes
UPDATE "users" SET "id" = lower(hex(randomblob(15))) WHERE "id" IS NULL;

-- Recreate users with id as PK and username as UNIQUE
CREATE TABLE "users_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "key" TEXT NOT NULL
);
INSERT INTO "users_new" ("id", "username", "key")
    SELECT "id", "username", "key" FROM "users";
DROP TABLE "users";
ALTER TABLE "users_new" RENAME TO "users";
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- Recreate progress with user_id FK (inner join: orphaned progress rows are dropped)
CREATE TABLE "progress_new" (
    "user_id" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "progress" TEXT NOT NULL,
    "percentage" REAL NOT NULL,
    "device" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "timestamp" INTEGER NOT NULL,
    PRIMARY KEY ("user_id", "document"),
    CONSTRAINT "progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "progress_new" ("user_id", "document", "progress", "percentage", "device", "device_id", "timestamp")
    SELECT u."id", p."document", p."progress", p."percentage", p."device", p."device_id", p."timestamp"
    FROM "progress" p
    INNER JOIN "users" u ON u."username" = p."username";
DROP TABLE "progress";
ALTER TABLE "progress_new" RENAME TO "progress";
```

- [ ] **Step 3: Regenerate Prisma client**

```bash
cd app/server && npm run prisma:generate
```

Expected: `Generated Prisma Client` message, no errors. TypeScript types for `User.id` and `Progress.userId` are now available.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd app/server && npx tsc --noEmit
```

Expected: Several errors about `username` still being used in `.ts` files — that's expected since we haven't updated the code yet. There should be NO errors related to the schema types themselves (no "Property 'id' does not exist on type 'User'" errors). If the only errors are `P2002`, `username_document`, etc., that confirms the schema types are correct.

- [ ] **Step 5: Commit**

```bash
git add app/server/prisma/schema.prisma app/server/prisma/migrations/0004_add_user_id/migration.sql
git commit -m "feat: add user surrogate ID schema and migration"
```

---

## Task 3: UserStore — authenticate & validateUser return `string | false` (TDD)

**Files:**
- Modify: `app/server/services/user-store.test.ts`
- Modify: `app/server/services/user-store.ts`

- [ ] **Step 1: Update authenticate tests**

In `user-store.test.ts`, replace the `describe('UserStore.authenticate', ...)` block:

```typescript
describe('UserStore.authenticate', () => {
  beforeEach(async () => {
    await store.createUser('alice', UserStore.hashPassword('secret'));
  });

  it('returns the user ID string with correct MD5 key', async () => {
    const key = UserStore.hashPassword('secret');
    const result = await store.authenticate('alice', key);
    expect(typeof result).toBe('string');
    expect((result as string).length).toBe(21);
  });

  it('returns false with wrong key', async () => {
    expect(await store.authenticate('alice', 'wronghash')).toBe(false);
  });

  it('returns false for unknown user', async () => {
    const key = UserStore.hashPassword('secret');
    expect(await store.authenticate('nobody', key)).toBe(false);
  });
});
```

- [ ] **Step 2: Update validateUser tests**

Replace the `describe('UserStore.validateUser', ...)` block:

```typescript
describe('UserStore.validateUser', () => {
  beforeEach(async () => {
    await store.createUser('alice', UserStore.hashPassword('secret'));
  });

  it('returns the user ID string with correct plaintext password', async () => {
    const result = await store.validateUser('alice', 'secret');
    expect(typeof result).toBe('string');
    expect((result as string).length).toBe(21);
  });

  it('returns false with wrong password', async () => {
    expect(await store.validateUser('alice', 'wrongpass')).toBe(false);
  });

  it('returns false for unknown user', async () => {
    expect(await store.validateUser('nobody', 'secret')).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to confirm failures**

```bash
cd app/server && npx jest services/user-store.test.ts --no-coverage 2>&1 | grep -E "PASS|FAIL|✓|✗|×|●"
```

Expected: `FAIL` — the authenticate/validateUser tests fail because `toBe('string')` doesn't match the current `true` return.

- [ ] **Step 4: Update authenticate in user-store.ts**

Replace the `authenticate` method:

```typescript
async authenticate(username: string, key: string): Promise<string | false> {
  const row = await this.prisma.user.findUnique({
    where: { username },
    select: { id: true, key: true },
  });
  if (!row || row.key !== key) return false;
  return row.id;
}
```

- [ ] **Step 5: Update validateUser in user-store.ts**

Replace the `validateUser` method:

```typescript
async validateUser(username: string, password: string): Promise<string | false> {
  return this.authenticate(username, UserStore.hashPassword(password));
}
```

- [ ] **Step 6: Run tests to confirm pass**

```bash
cd app/server && npx jest services/user-store.test.ts --no-coverage 2>&1 | grep -E "PASS|FAIL|Tests:"
```

Expected: `PASS` with authenticate and validateUser tests green. Other progress tests will still fail (expected — addressed in Task 5).

- [ ] **Step 7: Commit**

```bash
git add app/server/services/user-store.ts app/server/services/user-store.test.ts
git commit -m "feat: authenticate and validateUser return user ID string on success"
```

---

## Task 4: UserStore — createUser generates NanoID (TDD)

**Files:**
- Modify: `app/server/services/user-store.test.ts`
- Modify: `app/server/services/user-store.ts`

- [ ] **Step 1: Add ID format test**

In `user-store.test.ts`, add inside `describe('UserStore.createUser', ...)`:

```typescript
it('assigns a unique 21-char alphanumeric ID to each user', async () => {
  await store.createUser('alice', 'k1');
  await store.createUser('bob', 'k2');
  const alice = await prisma.user.findUnique({ where: { username: 'alice' } });
  const bob = await prisma.user.findUnique({ where: { username: 'bob' } });
  expect(alice!.id).toMatch(/^[A-Za-z0-9]{21}$/);
  expect(bob!.id).toMatch(/^[A-Za-z0-9]{21}$/);
  expect(alice!.id).not.toBe(bob!.id);
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd app/server && npx jest services/user-store.test.ts --no-coverage -t "assigns a unique" 2>&1 | grep -E "PASS|FAIL|●"
```

Expected: `FAIL` — the `id` field is empty/null because `createUser` doesn't supply it yet.

- [ ] **Step 3: Update user-store.ts — add import and generator**

At the top of `user-store.ts`, add after the existing imports:

```typescript
import { customAlphabet } from 'nanoid';

const generateId = customAlphabet(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  21
);
```

- [ ] **Step 4: Update createUser to pass id**

Replace the `createUser` method:

```typescript
async createUser(username: string, key: string): Promise<boolean> {
  try {
    await this.prisma.user.create({ data: { id: generateId(), username, key } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return false;
    }
    throw e;
  }
}
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
cd app/server && npx jest services/user-store.test.ts --no-coverage -t "createUser|assigns" 2>&1 | grep -E "PASS|FAIL|Tests:"
```

Expected: `PASS` for all createUser tests including the new ID format test.

- [ ] **Step 6: Commit**

```bash
git add app/server/services/user-store.ts app/server/services/user-store.test.ts
git commit -m "feat: createUser generates NanoID alphanumeric surrogate key"
```

---

## Task 5: UserStore — progress methods accept userId (TDD)

**Files:**
- Modify: `app/server/services/user-store.test.ts`
- Modify: `app/server/services/user-store.ts`

- [ ] **Step 1: Update saveProgress + getProgress tests**

Replace `describe('UserStore.saveProgress + getProgress', ...)`:

```typescript
describe('UserStore.saveProgress + getProgress', () => {
  let aliceId: string;

  beforeEach(async () => {
    await store.createUser('alice', 'secret');
    aliceId = await store.authenticate('alice', 'secret') as string;
  });

  it('retrieves saved progress', async () => {
    await store.saveProgress(aliceId, {
      document: 'abc123',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
    });
    const p = await store.getProgress(aliceId, 'abc123');
    expect(p).not.toBeNull();
    expect(p!.progress).toBe('/body/DocFragment[5]');
    expect(p!.percentage).toBeCloseTo(0.42);
  });

  it('updates existing progress on conflict', async () => {
    await store.saveProgress(aliceId, {
      document: 'abc123',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
    });
    await store.saveProgress(aliceId, {
      document: 'abc123',
      progress: '/body/DocFragment[10]',
      percentage: 0.8,
      device: 'Kobo',
      device_id: 'dev-1',
    });
    const p = await store.getProgress(aliceId, 'abc123');
    expect(p!.percentage).toBeCloseTo(0.8);
  });

  it('returns null when no progress exists', async () => {
    expect(await store.getProgress(aliceId, 'unknown')).toBeNull();
  });
});
```

- [ ] **Step 2: Update listUsers test (saveProgress call)**

In `describe('UserStore.listUsers', ...)`, update the `'returns users sorted by username with progress count'` test:

```typescript
it('returns users sorted by username with progress count', async () => {
  await store.createUser('zara', 'pass');
  await store.createUser('alice', 'pass');
  const aliceId = await store.authenticate('alice', 'pass') as string;
  await store.saveProgress(aliceId, {
    document: 'doc1',
    progress: '/p[1]',
    percentage: 0.5,
    device: 'Kobo',
    device_id: 'd1',
  });
  await store.saveProgress(aliceId, {
    document: 'doc2',
    progress: '/p[1]',
    percentage: 0.2,
    device: 'Kobo',
    device_id: 'd1',
  });
  const users = await store.listUsers();
  expect(users).toHaveLength(2);
  expect(users[0].username).toBe('alice');
  expect(users[0].progressCount).toBe(2);
  expect(users[1].username).toBe('zara');
  expect(users[1].progressCount).toBe(0);
});
```

- [ ] **Step 3: Update getUserProgress tests**

Replace `describe('UserStore.getUserProgress', ...)`:

```typescript
describe('UserStore.getUserProgress', () => {
  let aliceId: string;
  let bobId: string;

  beforeEach(async () => {
    await store.createUser('alice', 'pass');
    aliceId = await store.authenticate('alice', 'pass') as string;
  });

  it('returns empty array when user has no progress', async () => {
    expect(await store.getUserProgress(aliceId)).toEqual([]);
  });

  it('returns all progress records ordered by timestamp descending', async () => {
    await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.3,
      device: 'Kobo',
      device_id: 'd1',
      timestamp: 100,
    });
    await store.saveProgress(aliceId, {
      document: 'doc2',
      progress: '/p[2]',
      percentage: 0.8,
      device: 'Kobo',
      device_id: 'd1',
      timestamp: 200,
    });
    const records = await store.getUserProgress(aliceId);
    expect(records).toHaveLength(2);
    expect(records[0].document).toBe('doc2');
    expect(records[1].document).toBe('doc1');
  });

  it('only returns records for the specified user', async () => {
    await store.createUser('bob', 'pass');
    bobId = await store.authenticate('bob', 'pass') as string;
    await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    await store.saveProgress(bobId, {
      document: 'doc2',
      progress: '/p[1]',
      percentage: 0.3,
      device: 'Kobo',
      device_id: 'd2',
    });
    const aliceRecords = await store.getUserProgress(aliceId);
    expect(aliceRecords).toHaveLength(1);
    expect(aliceRecords[0].document).toBe('doc1');
  });
});
```

- [ ] **Step 4: Update deleteUser tests**

Replace `describe('UserStore.deleteUser', ...)`:

```typescript
describe('UserStore.deleteUser', () => {
  let aliceId: string;

  beforeEach(async () => {
    await store.createUser('alice', 'pass');
    aliceId = await store.authenticate('alice', 'pass') as string;
    await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
  });

  it('returns false for unknown user', async () => {
    expect(await store.deleteUser('nobody')).toBe(false);
  });

  it('returns true and removes the user', async () => {
    expect(await store.deleteUser('alice')).toBe(true);
    expect(await store.userExists('alice')).toBe(false);
  });

  it('cascades to delete all progress records', async () => {
    await store.deleteUser('alice');
    expect(await store.getUserProgress(aliceId)).toEqual([]);
  });

  it('does not affect other users', async () => {
    await store.createUser('bob', 'pass');
    await store.deleteUser('alice');
    expect(await store.userExists('bob')).toBe(true);
  });
});
```

- [ ] **Step 5: Update clearProgress tests**

Replace `describe('UserStore.clearProgress', ...)`:

```typescript
describe('UserStore.clearProgress', () => {
  let aliceId: string;
  let bobId: string;

  beforeEach(async () => {
    await store.createUser('alice', 'pass');
    await store.createUser('bob', 'pass');
    aliceId = await store.authenticate('alice', 'pass') as string;
    bobId = await store.authenticate('bob', 'pass') as string;
  });

  it('returns false when no record exists', async () => {
    expect(await store.clearProgress(aliceId, 'doc1')).toBe(false);
  });

  it('deletes an existing record and returns true', async () => {
    await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    expect(await store.clearProgress(aliceId, 'doc1')).toBe(true);
    expect(await store.getProgress(aliceId, 'doc1')).toBeNull();
  });

  it("does not affect another user's progress for the same document", async () => {
    await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    await store.saveProgress(bobId, {
      document: 'doc1',
      progress: '/p[2]',
      percentage: 0.7,
      device: 'Kobo',
      device_id: 'd2',
    });
    await store.clearProgress(aliceId, 'doc1');
    expect(await store.getProgress(bobId, 'doc1')).not.toBeNull();
  });
});
```

- [ ] **Step 6: Run tests to confirm failures**

```bash
cd app/server && npx jest services/user-store.test.ts --no-coverage 2>&1 | grep -E "PASS|FAIL|●" | head -20
```

Expected: `FAIL` — progress methods called with `aliceId` (string) don't match `username` parameter type.

- [ ] **Step 7: Update progress method signatures in user-store.ts**

Replace `getProgress`:

```typescript
async getProgress(userId: string, document: string): Promise<Progress | null> {
  const row = await this.prisma.progress.findUnique({
    where: { userId_document: { userId, document } },
  });
  if (!row) return null;
  return {
    document: row.document,
    progress: row.progress,
    percentage: row.percentage,
    device: row.device,
    device_id: row.deviceId,
    timestamp: row.timestamp,
  };
}
```

Replace `saveProgress`:

```typescript
async saveProgress(
  userId: string,
  p: Omit<Progress, 'timestamp'> & { timestamp?: number }
): Promise<Progress> {
  const timestamp = p.timestamp ?? Math.floor(Date.now() / 1000);
  await this.prisma.progress.upsert({
    where: { userId_document: { userId, document: p.document } },
    create: {
      userId,
      document: p.document,
      progress: p.progress,
      percentage: p.percentage,
      device: p.device,
      deviceId: p.device_id,
      timestamp,
    },
    update: {
      progress: p.progress,
      percentage: p.percentage,
      device: p.device,
      deviceId: p.device_id,
      timestamp,
    },
  });
  return { ...p, timestamp };
}
```

Replace `getUserProgress`:

```typescript
async getUserProgress(userId: string): Promise<Progress[]> {
  const rows = await this.prisma.progress.findMany({
    where: { userId },
    orderBy: { timestamp: 'desc' },
  });
  return rows.map((row) => ({
    document: row.document,
    progress: row.progress,
    percentage: row.percentage,
    device: row.device,
    device_id: row.deviceId,
    timestamp: row.timestamp,
  }));
}
```

Replace `clearProgress`:

```typescript
async clearProgress(userId: string, document: string): Promise<boolean> {
  try {
    await this.prisma.progress.delete({
      where: { userId_document: { userId, document } },
    });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return false;
    }
    throw e;
  }
}
```

- [ ] **Step 8: Run tests to confirm pass**

```bash
cd app/server && npx jest services/user-store.test.ts --no-coverage 2>&1 | grep -E "PASS|FAIL|Tests:"
```

Expected: `PASS`, all tests green.

- [ ] **Step 9: Commit**

```bash
git add app/server/services/user-store.ts app/server/services/user-store.test.ts
git commit -m "feat: progress methods accept userId instead of username"
```

---

## Task 6: UserStore — add getUserIdByUsername + simplify deleteUser

**Files:**
- Modify: `app/server/services/user-store.ts`

- [ ] **Step 1: Add getUserIdByUsername method**

After the `userExists` method in `user-store.ts`, add:

```typescript
async getUserIdByUsername(username: string): Promise<string | null> {
  const row = await this.prisma.user.findUnique({
    where: { username },
    select: { id: true },
  });
  return row?.id ?? null;
}
```

- [ ] **Step 2: Simplify deleteUser**

The existing `deleteUser` explicitly deletes progress before deleting the user, with a comment noting FK cascade can't be relied upon. After our migration, `progress.user_id` has `ON DELETE CASCADE`, so we can rely on it. Replace `deleteUser`:

```typescript
async deleteUser(username: string): Promise<boolean> {
  try {
    await this.prisma.user.delete({ where: { username } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return false;
    }
    throw e;
  }
}
```

- [ ] **Step 3: Run user-store tests to confirm still passing**

```bash
cd app/server && npx jest services/user-store.test.ts --no-coverage 2>&1 | grep -E "PASS|FAIL|Tests:"
```

Expected: `PASS` — the deleteUser cascade tests still pass because the FK cascade is now doing the work.

- [ ] **Step 4: Commit**

```bash
git add app/server/services/user-store.ts
git commit -m "feat: add getUserIdByUsername; simplify deleteUser to use FK cascade"
```

---

## Task 7: global.d.ts + auth.ts

**Files:**
- Modify: `app/server/global.d.ts`
- Modify: `app/server/middleware/auth.ts`

- [ ] **Step 1: Update global.d.ts**

Replace the entire file:

```typescript
import 'express-session';

declare module 'express-session' {
  interface SessionData {
    authenticated?: boolean;
    username?: string;
    userId?: string;
    isAdmin?: boolean;
  }
}

declare global {
  namespace Express {
    interface Request {
      kosyncUser?: string;
      kosyncUserId?: string;
    }
  }
}

export {};
```

- [ ] **Step 2: Update kosyncAuth in auth.ts**

Replace the `kosyncAuth` function body (keep the opdsAuth and sessionAuth/adminAuth functions unchanged):

```typescript
export function kosyncAuth(userStore: UserStore) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const username = req.headers['x-auth-user'];
      const key = req.headers['x-auth-key'];
      if (typeof username !== 'string' || typeof key !== 'string') {
        log.warn('KOSync auth failed — missing x-auth-user or x-auth-key headers');
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }
      const userId = await userStore.authenticate(username, key);
      if (!userId) {
        log.warn(`KOSync auth failed for user "${username}"`);
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }
      req.kosyncUser = username;
      req.kosyncUserId = userId;
      next();
    } catch (err) {
      next(err);
    }
  };
}
```

- [ ] **Step 3: Run auth-related tests**

```bash
cd app/server && npx jest routes/kosync.test.ts --no-coverage 2>&1 | grep -E "PASS|FAIL|Tests:"
```

Expected: Tests still pass (kosync routes haven't been updated yet to use `req.kosyncUserId`, but the middleware sets it correctly and `req.kosyncUser` is still set for any tests that check it).

- [ ] **Step 4: Commit**

```bash
git add app/server/global.d.ts app/server/middleware/auth.ts
git commit -m "feat: add kosyncUserId to request; add userId to session; kosyncAuth sets userId"
```

---

## Task 8: kosync.ts — use req.kosyncUserId for progress operations

**Files:**
- Modify: `app/server/routes/kosync.ts`
- Modify: `app/server/routes/kosync.test.ts`

- [ ] **Step 1: Update kosync.ts progress calls**

In `kosync.ts`, replace both `req.kosyncUser!` calls used for progress operations:

In `PUT /kosync/syncs/progress`:
```typescript
const saved = await userStore.saveProgress(req.kosyncUserId!, {
  document: currentId,
  progress,
  percentage,
  device,
  device_id,
});
log.info(
  `Progress saved for "${req.kosyncUser}" — "${document}" at ${(percentage * 100).toFixed(1)}%`
);
```

In `GET /kosync/syncs/progress/:document`:
```typescript
const p = await userStore.getProgress(req.kosyncUserId!, currentId);
if (!p) {
  log.warn(`Progress not found for "${req.kosyncUser}" — "${req.params.document}"`);
  res.status(404).json({ message: 'Not found' });
  return;
}
log.debug(`Progress retrieved for "${req.kosyncUser}" — "${req.params.document}"`);
```

- [ ] **Step 2: Run kosync tests before fixing direct SQL**

```bash
cd app/server && npx jest routes/kosync.test.ts --no-coverage 2>&1 | grep -E "PASS|FAIL|●" | head -20
```

Expected: Most tests pass, but the `'GET with old ID returns progress stored under current ID'` test fails because it does a direct `prisma.$executeRaw` INSERT into `progress` using the old `username` column. Fix in next step.

- [ ] **Step 3: Update direct progress INSERT in kosync.test.ts**

In `kosync.test.ts`, find the test `'GET with old ID returns progress stored under current ID'` (around line 208). Replace the direct Prisma SQL insert with:

```typescript
it('GET with old ID returns progress stored under current ID', async () => {
  const alice = await prisma.user.findUnique({ where: { username: 'alice' }, select: { id: true } });
  await prisma.progress.create({
    data: {
      userId: alice!.id,
      document: 'current-doc-id',
      progress: '/body/DocFragment[7]',
      percentage: 0.7,
      device: 'Kobo',
      deviceId: 'dev-1',
      timestamp: 1700000000,
    },
  });

  const res = await request(app)
    .get('/kosync/syncs/progress/old-doc-id')
    .set(authHeaders('alice', 'secret'));
  expect(res.status).toBe(200);
  expect(res.body.percentage).toBeCloseTo(0.7);
});
```

- [ ] **Step 4: Run kosync tests to confirm all pass**

```bash
cd app/server && npx jest routes/kosync.test.ts --no-coverage 2>&1 | grep -E "PASS|FAIL|Tests:"
```

Expected: `PASS`, all tests green.

- [ ] **Step 5: Commit**

```bash
git add app/server/routes/kosync.ts app/server/routes/kosync.test.ts
git commit -m "feat: kosync routes use req.kosyncUserId for progress DB operations"
```

---

## Task 9: ui.ts — login stores userId; progress routes use userId

**Files:**
- Modify: `app/server/routes/ui.ts`
- Modify: `app/server/routes/ui.test.ts`

- [ ] **Step 1: Update login route in ui.ts**

In the `POST /api/login` handler, replace the regular-user auth block:

```typescript
const userId = await userStore.validateUser(username, password);
if (userId) {
  req.session.authenticated = true;
  req.session.isAdmin = false;
  req.session.username = username;
  req.session.userId = userId;
  log.info(`User "${username}" logged in`);
  res.sendStatus(200);
  return;
}
```

- [ ] **Step 2: Update progress routes in ui.ts**

In `GET /api/my/progress`:
```typescript
const progressList = await userStore.getUserProgress(req.session.userId!);
```

In `DELETE /api/my/progress/:document`:
```typescript
const cleared = await userStore.clearProgress(req.session.userId!, req.params.document);
```

In `PUT /api/my/progress/:document`:
```typescript
await userStore.saveProgress(req.session.userId!, {
```

- [ ] **Step 3: Run ui tests before fixing direct prisma insert**

```bash
cd app/server && npx jest routes/ui.test.ts --no-coverage 2>&1 | grep -E "PASS|FAIL|●" | head -20
```

Expected: Most tests pass. The `'returns 204 and migrates progress on success'` test fails because it does a direct `prisma.progress.create` using the old `username` field.

- [ ] **Step 4: Update direct prisma.progress.create in ui.test.ts**

Find the test `'returns 204 and migrates progress on success'` (around line 614). Replace the progress create and findUnique:

```typescript
it('returns 204 and migrates progress on success', async () => {
  const agent = await adminAgent();
  await bookStore.addBook('route-link-target', stage('route-link-target'), FAKE_META);
  await userStore.createUser('alice-route', 'hashed-pass');
  const aliceRoute = await prisma.user.findUnique({
    where: { username: 'alice-route' },
    select: { id: true },
  });
  await prisma.progress.create({
    data: {
      userId: aliceRoute!.id,
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
    where: { userId_document: { userId: aliceRoute!.id, document: 'route-link-target' } },
  });
  expect(migrated).not.toBeNull();
  expect(migrated!.percentage).toBe(0.42);
});
```

- [ ] **Step 5: Run ui tests to confirm all pass**

```bash
cd app/server && npx jest routes/ui.test.ts --no-coverage 2>&1 | grep -E "PASS|FAIL|Tests:"
```

Expected: `PASS`, all tests green.

- [ ] **Step 6: Commit**

```bash
git add app/server/routes/ui.ts app/server/routes/ui.test.ts
git commit -m "feat: login stores userId in session; UI progress routes use session userId"
```

---

## Task 10: users.ts — admin routes use getUserIdByUsername

**Files:**
- Modify: `app/server/routes/users.ts`
- Modify: `app/server/routes/users.test.ts`

- [ ] **Step 1: Update GET /:username/progress in users.ts**

Replace the handler:

```typescript
router.get('/:username/progress', async (req: Request, res: Response) => {
  const { username } = req.params;
  const userId = await userStore.getUserIdByUsername(username);
  if (!userId) {
    log.warn(`Progress fetch for unknown user "${username}"`);
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const progress = await userStore.getUserProgress(userId);
  log.debug(`Progress fetched for "${username}" (${progress.length} records)`);
  res.json(progress);
});
```

- [ ] **Step 2: Update DELETE /:username/progress/:document in users.ts**

Replace the handler:

```typescript
router.delete('/:username/progress/:document', async (req: Request, res: Response) => {
  const { username, document } = req.params;
  const userId = await userStore.getUserIdByUsername(username);
  if (!userId) {
    log.warn(`Progress clear attempted for unknown user "${username}"`);
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const cleared = await userStore.clearProgress(userId, document);
  if (!cleared) {
    log.warn(`Progress clear: no record for "${username}" document "${document}"`);
    res.status(404).json({ error: 'Progress record not found' });
    return;
  }
  log.info(`Progress cleared for "${username}" document "${document}"`);
  res.status(204).send();
});
```

- [ ] **Step 3: Update users.test.ts — saveProgress calls use userId**

In `users.test.ts`, update the two tests that call `userStore.saveProgress('alice', ...)` directly. Find them in `describe('GET /api/users', ...)` and `describe('GET /api/users/:username/progress', ...)`:

In `'returns users with progress counts'`:
```typescript
it('returns users with progress counts', async () => {
  await userStore.createUser('alice', 'pass');
  const aliceId = await userStore.authenticate('alice', 'pass') as string;
  await userStore.saveProgress(aliceId, {
    document: 'doc1',
    progress: '/p[1]',
    percentage: 0.5,
    device: 'Kobo',
    device_id: 'd1',
  });
  const agent = await adminAgent();
  const res = await agent.get('/api/users');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
  expect(res.body[0].username).toBe('alice');
  expect(res.body[0].progressCount).toBe(1);
});
```

In `'returns progress records for a user'`:
```typescript
it('returns progress records for a user', async () => {
  await userStore.createUser('alice', 'pass');
  const aliceId = await userStore.authenticate('alice', 'pass') as string;
  await userStore.saveProgress(aliceId, {
    document: 'dune.epub',
    progress: '/p[5]',
    percentage: 0.42,
    device: 'Kobo',
    device_id: 'd1',
  });
  const agent = await adminAgent();
```

(Keep the rest of the test unchanged.)

- [ ] **Step 4: Run users tests to confirm all pass**

```bash
cd app/server && npx jest routes/users.test.ts --no-coverage 2>&1 | grep -E "PASS|FAIL|Tests:"
```

Expected: `PASS`, all tests green.

- [ ] **Step 5: Commit**

```bash
git add app/server/routes/users.ts app/server/routes/users.test.ts
git commit -m "feat: admin user progress routes resolve username to userId via getUserIdByUsername"
```

---

## Task 11: book-store.ts — update username→userId in progress operations

**Files:**
- Modify: `app/server/services/book-store.ts`
- Modify: `app/server/services/book-store.test.ts`

- [ ] **Step 1: Update linkDocument in book-store.ts**

In `linkDocument`, replace the progress conflict resolution section (lines ~194–218):

```typescript
const orphanProgresses = await tx.progress.findMany({ where: { document: documentId } });
const targetProgresses = await tx.progress.findMany({ where: { document: bookId } });
const targetByUserId = new Map(targetProgresses.map((p) => [p.userId, p]));

const keptProgresses: typeof orphanProgresses = [];
for (const orphanP of orphanProgresses) {
  const targetP = targetByUserId.get(orphanP.userId);
  if (targetP) {
    if (orphanP.timestamp >= targetP.timestamp) {
      await tx.progress.delete({
        where: { userId_document: { userId: orphanP.userId, document: bookId } },
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
```

- [ ] **Step 2: Update reimportBook in book-store.ts**

In `reimportBook`, replace the progress conflict resolution section (lines ~331–368):

```typescript
const oldProgresses = await tx.progress.findMany({ where: { document: id } });
const newProgresses = await tx.progress.findMany({ where: { document: newId } });
const newProgressByUserId = new Map(newProgresses.map((p) => [p.userId, p]));

const keptOldProgresses: typeof oldProgresses = [];
for (const oldP of oldProgresses) {
  const newP = newProgressByUserId.get(oldP.userId);
  if (newP) {
    if (oldP.timestamp >= newP.timestamp) {
      await tx.progress.delete({
        where: { userId_document: { userId: oldP.userId, document: newId } },
      });
      keptOldProgresses.push(oldP);
    }
  } else {
    keptOldProgresses.push(oldP);
  }
}

await tx.progress.deleteMany({ where: { document: id } });
if (keptOldProgresses.length > 0) {
  await tx.progress.createMany({
    data: keptOldProgresses.map((p) => ({
      userId: p.userId,
      document: newId,
      progress: p.progress,
      percentage: p.percentage,
      device: p.device,
      deviceId: p.deviceId,
      timestamp: p.timestamp,
    })),
  });
}
```

- [ ] **Step 3: Run book-store tests before fixing direct inserts**

```bash
cd app/server && npx jest services/book-store.test.ts --no-coverage 2>&1 | grep -E "PASS|FAIL|●" | head -20
```

Expected: Many failures in the `reimportBook` and `migrations` describe blocks because `prisma.user.create` needs an `id` field and `prisma.progress.create` uses `username`.

- [ ] **Step 4: Update direct prisma inserts in book-store.test.ts**

**4a. Fix `'cascades id change to progress table when partial MD5 shifts'` test (~line 885)**

Replace:
```typescript
await prisma.user.create({ data: { username: 'alice', key: 'k' } });
await prisma.progress.create({
  data: {
    username: 'alice',
    document: oldId,
    progress: '/p[1]',
    percentage: 0.5,
    device: 'Kobo',
    deviceId: 'd1',
    timestamp: 1000,
  },
});
```
With:
```typescript
await prisma.user.create({ data: { id: 'alice', username: 'alice', key: 'k' } });
await prisma.progress.create({
  data: {
    userId: 'alice',
    document: oldId,
    progress: '/p[1]',
    percentage: 0.5,
    device: 'Kobo',
    deviceId: 'd1',
    timestamp: 1000,
  },
});
```

**4b. Fix `'inherits orphaned progress under newId when no book owns that hash'` test (~line 926)**

Replace:
```typescript
await prisma.user.create({ data: { username: 'alice', key: 'k' } });
await prisma.progress.create({
  data: {
    username: 'alice',
    document: newId,
    ...
  },
});
```
With:
```typescript
await prisma.user.create({ data: { id: 'alice', username: 'alice', key: 'k' } });
await prisma.progress.create({
  data: {
    userId: 'alice',
    document: newId,
    progress: '/p[2]',
    percentage: 0.8,
    device: 'Kobo',
    deviceId: 'd1',
    timestamp: 2000,
  },
});
```

Also update the assertion at ~line 969:
```typescript
expect(newRows[0].userId).toBe('alice');
```

**4c. Fix `'keeps newer progress and discards older when both ids have records for the same user'` test (~line 975)**

Replace all `prisma.user.create` and `prisma.progress.create` calls:
```typescript
await prisma.user.create({ data: { id: 'alice', username: 'alice', key: 'k' } });
await prisma.user.create({ data: { id: 'bob', username: 'bob', key: 'k' } });
await prisma.progress.create({
  data: { userId: 'alice', document: oldId, progress: '/p[5]', percentage: 0.9, device: 'Kobo', deviceId: 'd1', timestamp: 3000 },
});
await prisma.progress.create({
  data: { userId: 'alice', document: newId, progress: '/p[2]', percentage: 0.4, device: 'Kobo', deviceId: 'd1', timestamp: 1000 },
});
await prisma.progress.create({
  data: { userId: 'bob', document: oldId, progress: '/p[1]', percentage: 0.2, device: 'Kobo', deviceId: 'd2', timestamp: 2000 },
});
await prisma.progress.create({
  data: { userId: 'bob', document: newId, progress: '/p[9]', percentage: 0.95, device: 'Kobo', deviceId: 'd2', timestamp: 5000 },
});
```

Update the assertions:
```typescript
const aliceRows = await prisma.progress.findMany({
  where: { userId: 'alice', document: newId },
});
// ...
const bobRows = await prisma.progress.findMany({ where: { userId: 'bob', document: newId } });
```

**4d. Fix `'migration v2: also updates matching progress records'` test (~line 660)**

The legacy migration test sets up a database without a `users` table. Our 0004 migration needs a `users` table to migrate progress. Add a users table and user row before running migrations:

```typescript
await migPrisma.$executeRawUnsafe(BOOKS_SCHEMA);
await migPrisma.$executeRawUnsafe(`
  CREATE TABLE users (
    "username" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL
  )
`);
await migPrisma.$executeRawUnsafe(`
  CREATE TABLE progress (
    username TEXT NOT NULL, document TEXT NOT NULL, progress TEXT NOT NULL,
    percentage REAL NOT NULL, device TEXT NOT NULL, device_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL, PRIMARY KEY (username, document)
  )
`);
await migPrisma.$executeRaw`INSERT INTO books (id, filename, path, title, size, mtime, added_at) VALUES (${staleId}, 'migrate-v2-prog.epub', ${filePath}, 'Test', 2048, 0, 0)`;
await migPrisma.$executeRaw`INSERT INTO users (username, key) VALUES ('alice', 'k')`;
await migPrisma.$executeRaw`INSERT INTO progress (username, document, progress, percentage, device, device_id, timestamp) VALUES ('alice', ${staleId}, 'epub://', 0.5, 'Kobo', 'dev1', 1000)`;

await runMigrations(migPrisma, booksDir);
```

- [ ] **Step 5: Run book-store tests to confirm all pass**

```bash
cd app/server && npx jest services/book-store.test.ts --no-coverage 2>&1 | grep -E "PASS|FAIL|Tests:"
```

Expected: `PASS`, all tests green.

- [ ] **Step 6: Commit**

```bash
git add app/server/services/book-store.ts app/server/services/book-store.test.ts
git commit -m "feat: book-store progress operations use userId; update tests for new schema"
```

---

## Task 12: Final verification

- [ ] **Step 1: Run full test suite**

```bash
cd app/server && npm test 2>&1 | tail -10
```

Expected:
```
Test Suites: 12 passed, 12 total
Tests:       NNN passed, 0 failures
```

- [ ] **Step 2: Run lint**

```bash
cd app/server && npm run lint
```

Expected: No errors.

- [ ] **Step 3: Commit if any lint fixes were needed**

Only commit if lint auto-fixed anything:
```bash
git add -p
git commit -m "chore: lint fixes"
```

- [ ] **Step 4: Final summary commit (optional)**

If all tasks were committed individually and lint is clean, no further commit needed. The branch is ready for PR.
