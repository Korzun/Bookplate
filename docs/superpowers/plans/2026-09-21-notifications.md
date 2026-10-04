# Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email the admin when a reader requests a book, and email the reader when that request is fulfilled or declined, behind a per-(user, event, channel) preference matrix and a durable outbox.

**Architecture:** Two new SQLite tables — `notification_preferences` (absent row means enabled) and `notification_outbox`. The three book-request service functions write an outbox row **inside the transaction that changes the request's state**, so an enqueue can never be lost. A background `NotificationQueue` drains due rows, hands each to a per-channel driver, and retries on transient failures. The outbox payload is channel-neutral event data rendered at drain time, which is what makes web push additive later.

**Tech Stack:** TypeScript, Prisma + better-sqlite3, Pothos GraphQL (relay + prisma + scope-auth plugins), Vitest, React + Apollo Client, oxlint/oxfmt.

**Spec:** `docs/superpowers/specs/2026-09-21-notifications-design.md` — read it before Task 1. The plan argues from it; where the plan refines it, it says so explicitly.

## Global Constraints

- **Never run `prisma migrate dev`.** Every migration in this repo is hand-written SQL applied by `db/migrate.ts`'s own runner. The spec's trap 1 and `Progress.book`'s doc comment both explain why generating DDL here fails against real data.
- **New tables are created by a data migration that runs after `data_v10_user_surrogate_id`**, with the generated Prisma DDL migration file made a commented no-op. Copy the shape of `data_v18_book_requests` exactly.
- **`runDataMigration` records its name only after the body resolves**, so a body that fails halfway re-runs on the next boot. Every statement must be `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`.
- **Every root GraphQL field must be auth-gated.** `graphql/root-auth.test.ts` walks every root field and fails on an ungated one.
- **Enum drift protection:** every string-union-backed GraphQL enum `satisfies`-checks its values against the TypeScript union, as `book-request-status/model.ts` does.
- Constants, exact values: backoff `[60_000, 300_000, 1_500_000, 7_200_000, 36_000_000]` ms (1m, 5m, 25m, 2h, 10h); `MAX_ATTEMPTS = 5`; drain tick `60_000` ms; outbox retention `30 * 24 * 60 * 60 * 1000` ms.
- Deep link for all three mails: `${publicUrl}/add/request`, omitted entirely when `publicUrl` is `null`. Never synthesise a URL from a request header.
- Terminal `SendFailure` reasons (no retry): `invalid_destination`, `misconfigured`. Retryable: `throttled`, `transient`.
- Commands: `npm test -w app/server`, `npm test -w app/client`, `npm run lint -w app/server`, `npm run lint -w app/client`, `npm run graphql:schema -w app/server`.
- **If `node_modules` is missing, run `npm ci` at the repo root.** This is a git worktree; symlinking another worktree's `node_modules` breaks Vite's subpath resolution.

---

## File Structure

**Server — new files**

| File | Responsibility |
| --- | --- |
| `app/server/services/notification.ts` | Event registry (event → audience), the string unions, `enqueueNotification`, preference read/write, audience filtering. No I/O beyond Prisma. |
| `app/server/services/notification.test.ts` | Tests for the above against a real temp SQLite database. |
| `app/server/services/notification-channel-email.ts` | The email `ChannelDriver`: renders a payload into a `MailMessage` and sends it. The only file that knows notifications are email. |
| `app/server/services/notification-channel-email.test.ts` | Driver tests, including the unverified-address refusal. |
| `app/server/services/notification-queue.ts` | `NotificationQueue`: the drain loop, backoff, terminal classification, pruning. Names no channel. |
| `app/server/services/notification-queue.test.ts` | Drain tests with a stub driver. |
| `app/server/graphql/schema/notification-event/model.ts` | `NotificationEvent` enum. |
| `app/server/graphql/schema/notification-channel/model.ts` | `NotificationChannel` enum. |
| `app/server/graphql/schema/notification-preference/model.ts` | `NotificationPreference` object type over a plain shape (not a Prisma row — the catalogue includes rows that do not exist). |
| `app/server/graphql/schema/viewer/mutation/set-notification-preference.ts` | `viewerSetNotificationPreference`. |
| `app/server/graphql/schema/viewer/notification-fields.test.ts` | Tests for `Viewer.notificationPreferences`. |
| `app/server/prisma/migrations/20260921000000_add_notifications/migration.sql` | Commented no-op. |

**Server — modified**

| File | Change |
| --- | --- |
| `app/server/prisma/schema.prisma` | Two models, two `User` relations. |
| `app/server/db/migrate.ts` | `data_v20_notifications`. |
| `app/server/services/mailer.ts` | `bad_address` → `invalid_destination`. |
| `app/server/services/mailer-cloudflare.ts` | Same rename. |
| `app/server/services/email.ts` | Comment mentioning the old name. |
| `app/server/services/mail-template.ts` | `notice()` renderer plus three notification messages. |
| `app/server/services/book-request.ts` | Three enqueue sites; `declineBookRequest` gains a transaction. |
| `app/server/graphql/schema/viewer/model.ts` | `notificationPreferences` field. |
| `app/server/graphql/schema/viewer/index.ts` | Import the new mutation module. |
| `app/server/graphql/context.ts` | `notifications: NotificationPoker`. |
| `app/server/graphql/test-util.ts` | Supply a recording poker to the harness. |
| `app/server/graphql/schema/book-request/mutation/{create,fulfill,decline}.ts` | `context.notifications.poke()` after a successful outcome. |
| `app/server/index.ts` | Construct and start the queue; pass the poker into the GraphQL handler. |
| `app/server/graphql/schema.generated.graphql` | Regenerated. |

**Client**

| File | Change |
| --- | --- |
| `app/client/src/graphql/notification.ts` | Create: the query fragment and the mutation document. |
| `app/client/src/component/notification-settings/{index.tsx,style.ts,index.test.tsx}` | Create: the settings card. |
| `app/client/src/component/index.ts` | Export `NotificationSettings`. |
| `app/client/src/page/user/index.tsx` | Mount the card below `EmailSetting`. |
| `app/client/src/graphql/viewer-bootstrap.ts` | Select the new field. |
| `app/client/src/gql/*` | Regenerated by codegen. |

---

### Task 1: Rename `SendFailure`'s `bad_address` to `invalid_destination`

Isolated churn, done first so no later task has to reconcile two names. Five references across four files.

**Files:**
- Modify: `app/server/services/mailer.ts:24-30`
- Modify: `app/server/services/mailer-cloudflare.ts:139`
- Modify: `app/server/services/email.ts:22`
- Test: `app/server/services/mailer-cloudflare.test.ts:74`

**Interfaces:**
- Consumes: nothing.
- Produces: `export type SendFailure = 'invalid_destination' | 'throttled' | 'misconfigured' | 'transient'` from `services/mailer.ts`. Every later task uses `'invalid_destination'` and never `'bad_address'`.

- [ ] **Step 1: Update the test to the new name**

In `app/server/services/mailer-cloudflare.test.ts`, change the expectation:

```ts
      reason: 'invalid_destination',
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w app/server -- services/mailer-cloudflare`
Expected: FAIL — received `'bad_address'`, expected `'invalid_destination'`.

- [ ] **Step 3: Rename in `mailer.ts`**

Replace the union and its doc paragraph:

```ts
/**
 * `invalid_destination` is a delivery verdict about the recipient, not a fault:
 * for email it arrives inside a `200` as a permanent bounce, and the caller
 * should tell the user their address is wrong. The name is channel-neutral
 * deliberately — this union is the contract EVERY channel implements (spec 1),
 * and a web-push `410 Gone` lands in exactly this slot. The other three are
 * faults, distinguished because each wants different handling —
 * `misconfigured` is the operator's problem, `throttled` and `transient` are
 * worth retrying.
 */
export type SendFailure = 'invalid_destination' | 'throttled' | 'misconfigured' | 'transient';
```

- [ ] **Step 4: Rename in `mailer-cloudflare.ts`**

```ts
        return { ok: false, reason: 'invalid_destination' };
```

- [ ] **Step 5: Update the stale comment in `email.ts`**

```ts
 * ultimately decides whether an address exists, and an `invalid_destination`
 * send result reports that back. The length cap keeps an absurd value out of
```

- [ ] **Step 6: Verify nothing references the old name**

Run: `grep -rn "bad_address" app --include="*.ts" --include="*.tsx" | grep -v node_modules`
Expected: no output.

- [ ] **Step 7: Run the server suite and lint**

Run: `npm test -w app/server && npm run lint -w app/server`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add app/server/services/mailer.ts app/server/services/mailer-cloudflare.ts \
        app/server/services/mailer-cloudflare.test.ts app/server/services/email.ts
git commit -m "refactor(server): rename SendFailure's bad_address to invalid_destination"
```

---

### Task 2: The two tables

**Files:**
- Modify: `app/server/prisma/schema.prisma`
- Create: `app/server/prisma/migrations/20260921000000_add_notifications/migration.sql`
- Modify: `app/server/db/migrate.ts` (append after `data_v19_user_email`)
- Test: `app/server/db/migrate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma models `NotificationPreference` (`prisma.notificationPreference`, composite key `userId_event_channel`) and `NotificationOutbox` (`prisma.notificationOutbox`, `id` primary key). Every later task's Prisma calls use these names.

**Refinement of the spec:** the spec's outbox index is `@@index([sentAt, nextAttemptAt])`. The drain's query also filters `failedAt: null`, so the index is `@@index([sentAt, failedAt, nextAttemptAt])` — the same intent, matched to the query that actually runs.

- [ ] **Step 1: Write the failing migration test**

Append to `app/server/db/migrate.test.ts`, inside the existing top-level `describe`:

```ts
  it('creates the notification tables and is idempotent', async () => {
    await runMigrations(prisma, booksDir);
    await runMigrations(prisma, booksDir);

    const tables = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('notification_preferences', 'notification_outbox')
      ORDER BY name
    `;
    expect(tables.map((t) => t.name)).toEqual(['notification_outbox', 'notification_preferences']);
  });

  it('cascades notification rows when their user is deleted', async () => {
    await runMigrations(prisma, booksDir);
    await prisma.user.create({ data: { id: 'u1', username: 'u1' } });
    await prisma.notificationPreference.create({
      data: { userId: 'u1', event: 'book_request.created', channel: 'email', enabled: false },
    });
    await prisma.notificationOutbox.create({
      data: {
        id: 'o1',
        userId: 'u1',
        event: 'book_request.created',
        channel: 'email',
        payload: '{}',
        nextAttemptAt: 0,
        createdAt: 0,
      },
    });

    await prisma.user.delete({ where: { id: 'u1' } });

    expect(await prisma.notificationPreference.count()).toBe(0);
    expect(await prisma.notificationOutbox.count()).toBe(0);
  });
```

If `booksDir` / `prisma` are named differently in that file's setup, use its existing names — do not add a second harness.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w app/server -- db/migrate`
Expected: FAIL — `prisma.notificationPreference` is undefined, and the table query returns `[]`.

- [ ] **Step 3: Add the Prisma models**

Append to `app/server/prisma/schema.prisma`:

```prisma
// The preference matrix promised by the email-identity spec. AN ABSENT ROW
// MEANS ENABLED: rows record opt-outs, so the admin is notified of the first
// book request without visiting settings and no existing account needs a
// backfill. A row with `enabled: true` and no row at all are the same thing by
// definition, which is what lets the mutation be a plain upsert with no delete
// path.
//
// The composite primary key IS the identity. `channel` is in it although only
// 'email' exists today — adding web push is then rows plus a driver, with no
// migration of this model (see the spec's "What web push inherits").
model NotificationPreference {
  userId  String  @map("user_id")
  event   String
  channel String
  enabled Boolean
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@id([userId, event, channel])
  @@map("notification_preferences")
}

// The durable queue. `userId` is the RECIPIENT, not the actor.
//
// There is deliberately NO `email` column: the address is read from the user
// row at send time, so a row cannot outlive the address it names and a user who
// fixes a typo before the drain runs still gets the mail at the corrected
// address. It is also where the spec's rule — nothing is ever sent to an
// unverified address — is actually checked.
//
// `payload` is JSON and is a SELF-CONTAINED SNAPSHOT that deliberately does not
// reference the `BookRequest` row. Deleting a request is a first-class action on
// both surfaces (the reader withdraws a pending one, either party clears a
// resolved one), so the row may well be gone before the drain runs, and a mail
// that re-read it would fail exactly when it mattered. It must never hold a
// RENDERED message either — rendering happens per channel at drain time, which
// is the invariant that keeps web push additive rather than a migration of
// every queued row.
//
// `sentAt` and `failedAt` are mutually exclusive: null/null is pending, `sentAt`
// is delivered, `failedAt` is permanently given up. Both are pruned 30 days
// after they are set.
model NotificationOutbox {
  id            String  @id
  userId        String  @map("user_id")
  event         String
  channel       String
  payload       String
  attempts      Int     @default(0)
  nextAttemptAt Float   @map("next_attempt_at")
  createdAt     Float   @map("created_at")
  sentAt        Float?  @map("sent_at")
  failedAt      Float?  @map("failed_at")
  lastError     String? @map("last_error")
  user          User    @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  // Covers the drain's only query: pending rows (`sent_at` and `failed_at` both
  // null) whose `next_attempt_at` has passed.
  @@index([sentAt, failedAt, nextAttemptAt])
  @@map("notification_outbox")
}
```

And add the two back-relations to `model User`, beside `bookRequests`:

```prisma
  notificationPreferences NotificationPreference[]
  notificationOutbox      NotificationOutbox[]
```

- [ ] **Step 4: Add the no-op DDL migration**

Create `app/server/prisma/migrations/20260921000000_add_notifications/migration.sql`:

```sql
-- NO-OP BY DESIGN. Both tables are created by the `data_v20_notifications`
-- data migration in `db/migrate.ts`, not here.
--
-- `data_v10_user_surrogate_id` rebuilds "users" from an explicit column list,
-- and both of these tables carry a foreign key to "users" — a table created in
-- this DDL pass would therefore be created BEFORE the table it references is
-- rebuilt. `20260830000000_add_book_requests` and `20260919000000_add_user_email`
-- are no-ops for the same reason; see their comments and the data migrations
-- that do the real work.
--
-- This file exists so `_prisma_migrations` stays in step with the schema.
SELECT 1;
```

- [ ] **Step 5: Add the data migration**

In `app/server/db/migrate.ts`, immediately after the `data_v19_user_email` block:

```ts
  // Data migration: the notification preference matrix and the outbox. Runs
  // after data_v10_user_surrogate_id, which rebuilds "users" from an explicit
  // column list — both tables carry a foreign key to it. The Prisma DDL
  // migration (20260921000000_add_notifications) is a no-op; see its comment.
  await runDataMigration(prisma, 'data_v20_notifications', async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "notification_preferences" (
        "user_id" TEXT NOT NULL,
        "event" TEXT NOT NULL,
        "channel" TEXT NOT NULL,
        "enabled" BOOLEAN NOT NULL,
        PRIMARY KEY ("user_id", "event", "channel"),
        CONSTRAINT "notification_preferences_user_fkey" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "notification_outbox" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "user_id" TEXT NOT NULL,
        "event" TEXT NOT NULL,
        "channel" TEXT NOT NULL,
        "payload" TEXT NOT NULL,
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "next_attempt_at" REAL NOT NULL,
        "created_at" REAL NOT NULL,
        "sent_at" REAL,
        "failed_at" REAL,
        "last_error" TEXT,
        CONSTRAINT "notification_outbox_user_fkey" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "notification_outbox_sent_at_failed_at_next_attempt_at_idx"
         ON "notification_outbox" ("sent_at", "failed_at", "next_attempt_at")`
    );
  });
```

- [ ] **Step 6: Regenerate the Prisma client and run the tests**

Run: `npm run prisma:generate -w app/server && npm test -w app/server -- db/migrate`
Expected: PASS, both new tests included.

- [ ] **Step 7: Run the full server suite and lint**

Run: `npm test -w app/server && npm run lint -w app/server`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add app/server/prisma/schema.prisma app/server/prisma/migrations app/server/db/migrate.ts \
        app/server/db/migrate.test.ts app/server/graphql/generated/pothos-types.ts
git commit -m "feat(server): add notification preference and outbox tables"
```

---

### Task 3: The notification service — registry, preferences, enqueue

**Files:**
- Create: `app/server/services/notification.ts`
- Test: `app/server/services/notification.test.ts`

**Interfaces:**
- Consumes: Task 2's Prisma models.
- Produces, all from `services/notification.ts`:
  - `type NotificationEvent = 'book_request.created' | 'book_request.fulfilled' | 'book_request.declined'`
  - `type NotificationChannel = 'email'`
  - `type NotificationAudience = 'admin' | 'subject'`
  - `type NotificationPayload = { requesterUsername: string; title: string; author: string; note: string; declineReason: string }`
  - `const NOTIFICATION_EVENTS: Record<NotificationEvent, { audience: NotificationAudience }>`
  - `const NOTIFICATION_EVENT_LIST: readonly NotificationEvent[]`
  - `const NOTIFICATION_CHANNELS: readonly NotificationChannel[]`
  - `type NotificationDb = PrismaClient | Prisma.TransactionClient`
  - `enqueueNotification(db: NotificationDb, args: { event: NotificationEvent; subjectUserId: string; payload: NotificationPayload; now?: number }): Promise<void>`
  - `isNotificationEnabled(db: NotificationDb, args: { userId: string; event: NotificationEvent; channel: NotificationChannel }): Promise<boolean>`
  - `setNotificationPreference(db: NotificationDb, args: { userId: string; event: NotificationEvent; channel: NotificationChannel; enabled: boolean }): Promise<void>`
  - `eventsForRole(role: 'admin' | 'reader'): NotificationEvent[]`
  - `listNotificationPreferences(db: NotificationDb, args: { userId: string; role: 'admin' | 'reader'; channels: readonly NotificationChannel[] }): Promise<Array<{ event: NotificationEvent; channel: NotificationChannel; enabled: boolean }>>`
  - `parsePayload(json: string): NotificationPayload`

- [ ] **Step 1: Write the failing tests**

Create `app/server/services/notification.test.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from '../db/client';
import { runMigrations } from '../db/migrate';
import {
  enqueueNotification,
  eventsForRole,
  isNotificationEnabled,
  listNotificationPreferences,
  NOTIFICATION_CHANNELS,
  parsePayload,
  setNotificationPreference,
  type NotificationPayload,
} from './notification';

vi.mock('../logger');

let tmpDir: string;
let prisma: PrismaClient;
const ALICE = 'user-alice';
const ADMIN = 'user-admin';

const payload = (overrides: Partial<NotificationPayload> = {}): NotificationPayload => ({
  requesterUsername: 'alice',
  title: 'Dune',
  author: 'Frank Herbert',
  note: '',
  declineReason: '',
  ...overrides,
});

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notification-'));
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

const makeAdmin = () =>
  prisma.user.create({ data: { id: ADMIN, username: 'admin', isConfigAdmin: true } });

describe('isNotificationEnabled', () => {
  it('treats an absent row as enabled', async () => {
    const enabled = await isNotificationEnabled(prisma, {
      userId: ALICE,
      event: 'book_request.fulfilled',
      channel: 'email',
    });
    expect(enabled).toBe(true);
  });

  it('honours a stored opt-out', async () => {
    await setNotificationPreference(prisma, {
      userId: ALICE,
      event: 'book_request.fulfilled',
      channel: 'email',
      enabled: false,
    });
    const enabled = await isNotificationEnabled(prisma, {
      userId: ALICE,
      event: 'book_request.fulfilled',
      channel: 'email',
    });
    expect(enabled).toBe(false);
  });

  it('scopes a stored row to its own event', async () => {
    await setNotificationPreference(prisma, {
      userId: ALICE,
      event: 'book_request.fulfilled',
      channel: 'email',
      enabled: false,
    });
    const other = await isNotificationEnabled(prisma, {
      userId: ALICE,
      event: 'book_request.declined',
      channel: 'email',
    });
    expect(other).toBe(true);
  });
});

describe('setNotificationPreference', () => {
  it('upserts rather than duplicating, so re-enabling is idempotent', async () => {
    const args = { userId: ALICE, event: 'book_request.declined' as const, channel: 'email' as const };
    await setNotificationPreference(prisma, { ...args, enabled: false });
    await setNotificationPreference(prisma, { ...args, enabled: true });
    await setNotificationPreference(prisma, { ...args, enabled: true });

    expect(await prisma.notificationPreference.count()).toBe(1);
    expect(await isNotificationEnabled(prisma, args)).toBe(true);
  });
});

describe('eventsForRole', () => {
  it('gives the admin only the created event', () => {
    expect(eventsForRole('admin')).toEqual(['book_request.created']);
  });

  it('gives a reader only the two outcome events', () => {
    expect(eventsForRole('reader')).toEqual([
      'book_request.fulfilled',
      'book_request.declined',
    ]);
  });
});

describe('listNotificationPreferences', () => {
  it('returns the role’s whole catalogue with defaults merged over stored rows', async () => {
    await setNotificationPreference(prisma, {
      userId: ALICE,
      event: 'book_request.declined',
      channel: 'email',
      enabled: false,
    });

    const rows = await listNotificationPreferences(prisma, {
      userId: ALICE,
      role: 'reader',
      channels: NOTIFICATION_CHANNELS,
    });

    expect(rows).toEqual([
      { event: 'book_request.fulfilled', channel: 'email', enabled: true },
      { event: 'book_request.declined', channel: 'email', enabled: false },
    ]);
  });

  it('returns nothing when no channel is configured', async () => {
    const rows = await listNotificationPreferences(prisma, {
      userId: ALICE,
      role: 'reader',
      channels: [],
    });
    expect(rows).toEqual([]);
  });
});

describe('enqueueNotification', () => {
  it('routes a subject-audience event to the subject', async () => {
    await enqueueNotification(prisma, {
      event: 'book_request.fulfilled',
      subjectUserId: ALICE,
      payload: payload(),
      now: 1000,
    });

    const rows = await prisma.notificationOutbox.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: ALICE,
      event: 'book_request.fulfilled',
      channel: 'email',
      attempts: 0,
      nextAttemptAt: 1000,
      createdAt: 1000,
      sentAt: null,
      failedAt: null,
    });
    expect(parsePayload(rows[0].payload)).toEqual(payload());
  });

  it('routes an admin-audience event to the config admin, not the subject', async () => {
    await makeAdmin();

    await enqueueNotification(prisma, {
      event: 'book_request.created',
      subjectUserId: ALICE,
      payload: payload(),
    });

    const rows = await prisma.notificationOutbox.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(ADMIN);
  });

  it('enqueues nothing when there is no admin row', async () => {
    await enqueueNotification(prisma, {
      event: 'book_request.created',
      subjectUserId: ALICE,
      payload: payload(),
    });
    expect(await prisma.notificationOutbox.count()).toBe(0);
  });

  it('enqueues nothing for a muted event', async () => {
    await setNotificationPreference(prisma, {
      userId: ALICE,
      event: 'book_request.fulfilled',
      channel: 'email',
      enabled: false,
    });

    await enqueueNotification(prisma, {
      event: 'book_request.fulfilled',
      subjectUserId: ALICE,
      payload: payload(),
    });
    expect(await prisma.notificationOutbox.count()).toBe(0);
  });

  it('is rolled back with the transaction that wrote it', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await enqueueNotification(tx, {
          event: 'book_request.fulfilled',
          subjectUserId: ALICE,
          payload: payload(),
        });
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(await prisma.notificationOutbox.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w app/server -- services/notification.test`
Expected: FAIL — cannot resolve `./notification`.

- [ ] **Step 3: Write the service**

Create `app/server/services/notification.ts`:

```ts
/**
 * The channel-blind half of notifications: what events exist, who each one is
 * for, whether a given recipient wants it, and the outbox row that records it.
 *
 * Nothing here knows that a channel is email. `services/notification-channel-
 * email.ts` is the only file that does, which is what makes web push a driver
 * plus rows rather than a change to this file (see the spec's "What web push
 * inherits").
 *
 * `now` is injected (defaulting to `Date.now`) so the queue's backoff tests
 * need no fake timers — the same shape `issueEmailToken` and
 * `ReplaceStagingDeps.now` use.
 */
import { randomUUID } from 'crypto';

import type { Prisma, PrismaClient } from '@prisma/client';

import { logger } from '../logger';

const log = logger('Notification');

/**
 * Stored lowercase and dotted; exposed through the `NotificationEvent` GraphQL
 * enum, whose SCREAMING_CASE members map back onto these exact strings. The
 * enum is `satisfies`-checked against this union so the two cannot drift —
 * the convention `BookRequestStatus` already follows.
 */
export type NotificationEvent =
  | 'book_request.created'
  | 'book_request.fulfilled'
  | 'book_request.declined';

/** Web push adds a member here, a driver, and nothing else. */
export type NotificationChannel = 'email';

/**
 * `'admin'` resolves to the `isConfigAdmin` row; `'subject'` to the user the
 * event is about. Declaring it here rather than at the trigger site is the
 * reason `services/book-request.ts` never learns that a config admin exists.
 */
export type NotificationAudience = 'admin' | 'subject';

export const NOTIFICATION_EVENTS: Record<NotificationEvent, { audience: NotificationAudience }> = {
  'book_request.created': { audience: 'admin' },
  'book_request.fulfilled': { audience: 'subject' },
  'book_request.declined': { audience: 'subject' },
};

export const NOTIFICATION_EVENT_LIST: readonly NotificationEvent[] = Object.keys(
  NOTIFICATION_EVENTS
) as NotificationEvent[];

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ['email'];

/**
 * Everything the three mails need, and nothing that has to be looked up again.
 * A snapshot because the `BookRequest` row may be deleted before the drain
 * runs — see `NotificationOutbox.payload`'s doc comment. It must never hold a
 * rendered message.
 */
export type NotificationPayload = {
  requesterUsername: string;
  title: string;
  author: string;
  note: string;
  declineReason: string;
};

/**
 * Accepts a transaction client as readily as the root one, because the whole
 * point of the enqueue is that it commits with the state change that caused it.
 */
export type NotificationDb = PrismaClient | Prisma.TransactionClient;

export function parsePayload(json: string): NotificationPayload {
  const raw = JSON.parse(json) as Partial<NotificationPayload>;
  return {
    requesterUsername: raw.requesterUsername ?? '',
    title: raw.title ?? '',
    author: raw.author ?? '',
    note: raw.note ?? '',
    declineReason: raw.declineReason ?? '',
  };
}

export async function isNotificationEnabled(
  db: NotificationDb,
  args: { userId: string; event: NotificationEvent; channel: NotificationChannel }
): Promise<boolean> {
  const row = await db.notificationPreference.findUnique({
    where: {
      userId_event_channel: { userId: args.userId, event: args.event, channel: args.channel },
    },
    select: { enabled: true },
  });
  // An absent row means enabled — see the model's doc comment.
  return row?.enabled ?? true;
}

export async function setNotificationPreference(
  db: NotificationDb,
  args: {
    userId: string;
    event: NotificationEvent;
    channel: NotificationChannel;
    enabled: boolean;
  }
): Promise<void> {
  const key = { userId: args.userId, event: args.event, channel: args.channel };
  await db.notificationPreference.upsert({
    where: { userId_event_channel: key },
    create: { ...key, enabled: args.enabled },
    update: { enabled: args.enabled },
  });
}

/**
 * Which events a viewer is ever a recipient of. The config admin only ever
 * receives `'admin'`-audience events and a reader only ever `'subject'` ones,
 * so the audience IS the role filter and there is no second table of rules.
 */
export function eventsForRole(role: 'admin' | 'reader'): NotificationEvent[] {
  const audience: NotificationAudience = role === 'admin' ? 'admin' : 'subject';
  return NOTIFICATION_EVENT_LIST.filter((event) => NOTIFICATION_EVENTS[event].audience === audience);
}

/**
 * The role's whole catalogue with effective state, not just the stored rows —
 * the settings card renders what it is handed, and a client that reconstructed
 * the defaults itself would be a second place for them to drift.
 *
 * `channels` is passed in rather than read from `NOTIFICATION_CHANNELS` so the
 * caller can omit a channel this install has not configured; an empty list
 * yields an empty catalogue and the card renders nothing.
 */
export async function listNotificationPreferences(
  db: NotificationDb,
  args: { userId: string; role: 'admin' | 'reader'; channels: readonly NotificationChannel[] }
): Promise<Array<{ event: NotificationEvent; channel: NotificationChannel; enabled: boolean }>> {
  const events = eventsForRole(args.role);
  if (events.length === 0 || args.channels.length === 0) return [];

  const stored = await db.notificationPreference.findMany({
    where: { userId: args.userId, event: { in: events }, channel: { in: [...args.channels] } },
    select: { event: true, channel: true, enabled: true },
  });
  const byKey = new Map(stored.map((row) => [`${row.event}\u0000${row.channel}`, row.enabled]));

  return events.flatMap((event) =>
    args.channels.map((channel) => ({
      event,
      channel,
      enabled: byKey.get(`${event}\u0000${channel}`) ?? true,
    }))
  );
}

/**
 * Records that something happened, for every channel the recipient has not
 * muted.
 *
 * WRITES NOTHING AND THROWS NOTHING when there is no recipient row: the
 * `isConfigAdmin` row is absent on an install where `ensureAdminUser` refused
 * to act on a username collision (see that function), and a book request must
 * still succeed there.
 *
 * The preference is read HERE, at enqueue, so the outbox stays a record of
 * messages somebody actually wants. A user who mutes after the enqueue and
 * before the drain still gets that one message, which is the correct reading
 * of a queue that has already accepted it.
 *
 * `config.mail` is deliberately NOT consulted: this function holds no config,
 * and a row destined for an install with no driver is discarded by the drain.
 * "The outbox records, the drain decides" is one rule rather than two.
 */
export async function enqueueNotification(
  db: NotificationDb,
  args: {
    event: NotificationEvent;
    subjectUserId: string;
    payload: NotificationPayload;
    now?: number;
  }
): Promise<void> {
  const now = args.now ?? Date.now();
  const { audience } = NOTIFICATION_EVENTS[args.event];

  let recipientId: string | null = args.subjectUserId;
  if (audience === 'admin') {
    const admin = await db.user.findFirst({
      where: { isConfigAdmin: true },
      select: { id: true },
    });
    recipientId = admin?.id ?? null;
  }
  if (recipientId === null) {
    log.debug(`No recipient for ${args.event}; nothing enqueued`);
    return;
  }

  const payload = JSON.stringify(args.payload);
  for (const channel of NOTIFICATION_CHANNELS) {
    if (!(await isNotificationEnabled(db, { userId: recipientId, event: args.event, channel }))) {
      continue;
    }
    await db.notificationOutbox.create({
      data: {
        id: randomUUID(),
        userId: recipientId,
        event: args.event,
        channel,
        payload,
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
      },
    });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w app/server -- services/notification.test`
Expected: PASS, all cases.

- [ ] **Step 5: Lint**

Run: `npm run lint -w app/server`
Expected: clean. If `logger` has no `debug` level, use the level that file exposes.

- [ ] **Step 6: Commit**

```bash
git add app/server/services/notification.ts app/server/services/notification.test.ts
git commit -m "feat(server): add the notification event registry, preferences and enqueue"
```

---

### Task 4: The three mail templates

**Files:**
- Modify: `app/server/services/mail-template.ts`
- Test: `app/server/services/mail-template.test.ts`

**Interfaces:**
- Consumes: `NotificationPayload` from Task 3.
- Produces, from `services/mail-template.ts`:
  - `type NoticeArgs = { to: string; libraryName: string; publicUrl: string | null; payload: NotificationPayload }`
  - `bookRequestedMessage(args: NoticeArgs): MailMessage`
  - `requestFulfilledMessage(args: NoticeArgs): MailMessage`
  - `requestDeclinedMessage(args: NoticeArgs): MailMessage`

- [ ] **Step 1: Write the failing tests**

Append to `app/server/services/mail-template.test.ts`:

```ts
describe('notification messages', () => {
  const base = {
    to: 'admin@example.com',
    libraryName: 'Bookplate',
    publicUrl: 'https://books.example.com',
    payload: {
      requesterUsername: 'alice',
      title: 'Dune',
      author: 'Frank Herbert',
      note: 'the 1965 edition if you can',
      declineReason: '',
    },
  };

  it('tells the admin who asked for what, and links to the queue', () => {
    const message = bookRequestedMessage(base);

    expect(message.to).toBe('admin@example.com');
    expect(message.subject).toBe('alice requested a book on Bookplate');
    expect(message.text).toContain('Dune');
    expect(message.text).toContain('Frank Herbert');
    expect(message.text).toContain('the 1965 edition if you can');
    expect(message.text).toContain('https://books.example.com/add/request');
    expect(message.html).toContain('href="https://books.example.com/add/request"');
  });

  it('omits the link entirely when publicUrl is null', () => {
    const message = bookRequestedMessage({ ...base, publicUrl: null });

    expect(message.text).not.toContain('http');
    expect(message.html).not.toContain('<a ');
  });

  it('omits the note line when there is no note', () => {
    const message = bookRequestedMessage({
      ...base,
      payload: { ...base.payload, note: '' },
    });
    expect(message.text).not.toContain('Note');
  });

  it('tells the reader their book arrived', () => {
    const message = requestFulfilledMessage({ ...base, to: 'alice@example.com' });

    expect(message.subject).toBe('Dune has been added to your library');
    expect(message.text).toContain('Frank Herbert');
  });

  it('tells the reader their request was declined, with the reason', () => {
    const message = requestDeclinedMessage({
      ...base,
      to: 'alice@example.com',
      payload: { ...base.payload, declineReason: 'already on the shelf' },
    });

    expect(message.subject).toBe('Your request for Dune was declined');
    expect(message.text).toContain('already on the shelf');
  });

  it('omits the reason line when a decline carries none', () => {
    const message = requestDeclinedMessage({ ...base, to: 'alice@example.com' });
    expect(message.text).not.toContain('Reason');
  });

  it('escapes operator- and user-supplied values in html', () => {
    const message = requestDeclinedMessage({
      ...base,
      to: 'alice@example.com',
      libraryName: '<script>',
      payload: { ...base.payload, title: '<b>x</b>', declineReason: '"quoted"' },
    });

    expect(message.html).not.toContain('<script>');
    expect(message.html).not.toContain('<b>x</b>');
    expect(message.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(message.html).toContain('&quot;quoted&quot;');
  });
});
```

Extend that file's existing import to include the three new functions.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w app/server -- services/mail-template`
Expected: FAIL — `bookRequestedMessage` is not exported.

- [ ] **Step 3: Add the `notice` renderer and the three messages**

Append to `app/server/services/mail-template.ts`:

```ts
/**
 * The second renderer. `render` above is built around a CODE and a
 * code-bearing link, which a notification has neither of — it has a short lead
 * and a few labelled lines. Shares `escapeHtml` and the same inline-styled,
 * deliberately plain html, for the reason recorded at the top of this file.
 *
 * `lines` entries are dropped when their value is empty, so an absent note or
 * decline reason leaves no orphaned label.
 */
function notice(args: {
  to: string;
  subject: string;
  lead: string;
  lines: Array<{ label: string; value: string }>;
  href: string | null;
  linkLabel: string;
  closing: string;
}): MailMessage {
  const present = args.lines.filter((line) => line.value.trim() !== '');

  const textLines = [args.lead, ''];
  for (const line of present) textLines.push(`${line.label}: ${line.value}`);
  textLines.push('');
  if (args.href !== null) textLines.push(`${args.linkLabel}: ${args.href}`, '');
  textLines.push(args.closing);

  const htmlParts = [`<p>${escapeHtml(args.lead)}</p>`];
  if (present.length > 0) {
    htmlParts.push(
      '<ul style="padding-left:18px">' +
        present
          .map(
            (line) =>
              `<li><strong>${escapeHtml(line.label)}:</strong> ${escapeHtml(line.value)}</li>`
          )
          .join('') +
        '</ul>'
    );
  }
  if (args.href !== null) {
    htmlParts.push(`<p><a href="${escapeHtml(args.href)}">${escapeHtml(args.linkLabel)}</a></p>`);
  }
  htmlParts.push(`<p style="color:#666;font-size:13px">${escapeHtml(args.closing)}</p>`);

  return {
    to: args.to,
    subject: args.subject,
    text: textLines.join('\n'),
    html: htmlParts.join('\n'),
  };
}

export type NoticeArgs = {
  to: string;
  libraryName: string;
  publicUrl: string | null;
  payload: NotificationPayload;
};

/**
 * All three notifications deep-link to the SAME surface, which serves the
 * reader's own request list and the admin's queue alike (`/add/request`).
 * `null` when `public_url` is unset, exactly as the code mails' link is — a
 * LAN-only install gets a fully useful message with no link, and no URL is
 * ever synthesised from a request header.
 */
function requestsLink(publicUrl: string | null): string | null {
  return publicUrl === null ? null : `${publicUrl}/add/request`;
}

export function bookRequestedMessage(args: NoticeArgs): MailMessage {
  return notice({
    to: args.to,
    subject: `${args.payload.requesterUsername} requested a book on ${args.libraryName}`,
    lead: `${args.payload.requesterUsername} asked for a book that isn't in ${args.libraryName} yet.`,
    lines: [
      { label: 'Title', value: args.payload.title },
      { label: 'Author', value: args.payload.author },
      { label: 'Note', value: args.payload.note },
    ],
    href: requestsLink(args.publicUrl),
    linkLabel: 'Review the request',
    closing: `You're receiving this because you're the ${args.libraryName} admin. You can turn these off on your account page.`,
  });
}

export function requestFulfilledMessage(args: NoticeArgs): MailMessage {
  return notice({
    to: args.to,
    subject: `${args.payload.title} has been added to your library`,
    lead: `Good news — the book you asked for is now in ${args.libraryName}.`,
    lines: [
      { label: 'Title', value: args.payload.title },
      { label: 'Author', value: args.payload.author },
    ],
    href: requestsLink(args.publicUrl),
    linkLabel: 'Open your library',
    closing: 'You can turn these emails off on your account page.',
  });
}

export function requestDeclinedMessage(args: NoticeArgs): MailMessage {
  return notice({
    to: args.to,
    subject: `Your request for ${args.payload.title} was declined`,
    lead: `The ${args.libraryName} admin turned down one of your book requests.`,
    lines: [
      { label: 'Title', value: args.payload.title },
      { label: 'Author', value: args.payload.author },
      { label: 'Reason', value: args.payload.declineReason },
    ],
    href: requestsLink(args.publicUrl),
    linkLabel: 'See your requests',
    closing: 'You can turn these emails off on your account page.',
  });
}
```

Add the payload type import at the top of the file:

```ts
import type { NotificationPayload } from './notification';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w app/server -- services/mail-template`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

Run: `npm run lint -w app/server`

```bash
git add app/server/services/mail-template.ts app/server/services/mail-template.test.ts
git commit -m "feat(server): add the three notification mail templates"
```

---

### Task 5: The email channel driver

**Files:**
- Create: `app/server/services/notification-channel-email.ts`
- Test: `app/server/services/notification-channel-email.test.ts`

**Interfaces:**
- Consumes: `Mailer`/`SendResult` (Task 1), `NotificationEvent`/`NotificationPayload` (Task 3), the three templates (Task 4).
- Produces, from `services/notification-channel-email.ts`:
  - `type NotificationRecipient = { userId: string; email: string | null; emailVerifiedAt: number | null }`
  - `type ChannelDriver = { deliver(args: { recipient: NotificationRecipient; event: NotificationEvent; payload: NotificationPayload }): Promise<SendResult> }`
  - `createEmailChannelDriver(deps: { mailer: Mailer; libraryName: string; publicUrl: string | null }): ChannelDriver`

**Refinement of the spec:** the spec puts the "unverified address is terminal" check in the drain. It lives in the driver instead, which reaches the same outcome — terminal, no send attempt — without teaching the queue what an email address is. Web push has no verification concept, and a queue that checked one would have to grow a branch for that.

- [ ] **Step 1: Write the failing tests**

Create `app/server/services/notification-channel-email.test.ts`:

```ts
import { createFakeMailer, type FakeMailer } from '../test-support/mail';
import { createEmailChannelDriver, type NotificationRecipient } from './notification-channel-email';
import type { NotificationPayload } from './notification';

vi.mock('../logger');

let mailer: FakeMailer;

const payload: NotificationPayload = {
  requesterUsername: 'alice',
  title: 'Dune',
  author: 'Frank Herbert',
  note: '',
  declineReason: '',
};

const verified: NotificationRecipient = {
  userId: 'u1',
  email: 'alice@example.com',
  emailVerifiedAt: 1000,
};

const driver = () =>
  createEmailChannelDriver({
    mailer,
    libraryName: 'Bookplate',
    publicUrl: 'https://books.example.com',
  });

beforeEach(() => {
  mailer = createFakeMailer();
});

describe('createEmailChannelDriver', () => {
  it('sends the matching template for each event', async () => {
    const d = driver();

    await d.deliver({ recipient: verified, event: 'book_request.created', payload });
    await d.deliver({ recipient: verified, event: 'book_request.fulfilled', payload });
    await d.deliver({ recipient: verified, event: 'book_request.declined', payload });

    expect(mailer.sent.map((m) => m.subject)).toEqual([
      'alice requested a book on Bookplate',
      'Dune has been added to your library',
      'Your request for Dune was declined',
    ]);
    expect(mailer.sent.every((m) => m.to === 'alice@example.com')).toBe(true);
  });

  it('refuses an unverified address as invalid_destination without sending', async () => {
    const result = await driver().deliver({
      recipient: { ...verified, emailVerifiedAt: null },
      event: 'book_request.fulfilled',
      payload,
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_destination' });
    expect(mailer.sent).toHaveLength(0);
  });

  it('refuses an absent address as invalid_destination without sending', async () => {
    const result = await driver().deliver({
      recipient: { ...verified, email: null },
      event: 'book_request.fulfilled',
      payload,
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_destination' });
    expect(mailer.sent).toHaveLength(0);
  });

  it('passes a mailer failure through unchanged', async () => {
    mailer.nextResult = { ok: false, reason: 'throttled' };

    const result = await driver().deliver({
      recipient: verified,
      event: 'book_request.fulfilled',
      payload,
    });

    expect(result).toEqual({ ok: false, reason: 'throttled' });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w app/server -- services/notification-channel-email`
Expected: FAIL — cannot resolve `./notification-channel-email`.

- [ ] **Step 3: Write the driver**

Create `app/server/services/notification-channel-email.ts`:

```ts
/**
 * The ONLY file that knows a notification can be an email.
 *
 * `ChannelDriver` is deliberately shaped around a RECIPIENT rather than an
 * address: web push resolves a user to N subscription endpoints and has no
 * notion of a verified address at all, so "is this recipient addressable on
 * this channel?" has to be the driver's question. That is also why the
 * unverified-address refusal lives here and not in the queue — it comes back as
 * `invalid_destination`, which the queue already treats as terminal, so the
 * queue needs no branch for it.
 */
import type { Mailer, SendResult } from './mailer';
import {
  bookRequestedMessage,
  requestDeclinedMessage,
  requestFulfilledMessage,
  type NoticeArgs,
} from './mail-template';
import type { NotificationEvent, NotificationPayload } from './notification';

export type NotificationRecipient = {
  userId: string;
  email: string | null;
  emailVerifiedAt: number | null;
};

export type ChannelDriver = {
  deliver(args: {
    recipient: NotificationRecipient;
    event: NotificationEvent;
    payload: NotificationPayload;
  }): Promise<SendResult>;
};

const TEMPLATES: Record<NotificationEvent, (args: NoticeArgs) => ReturnType<typeof notice>> = {
  'book_request.created': bookRequestedMessage,
  'book_request.fulfilled': requestFulfilledMessage,
  'book_request.declined': requestDeclinedMessage,
};

export function createEmailChannelDriver(deps: {
  mailer: Mailer;
  libraryName: string;
  publicUrl: string | null;
}): ChannelDriver {
  return {
    async deliver(args): Promise<SendResult> {
      const { email, emailVerifiedAt } = args.recipient;
      // Spec 1's rule: nothing is ever emailed to an unverified address except
      // its own verification code. Permanent rather than retryable — no amount
      // of retrying makes an unconfirmed address sendable.
      if (email === null || emailVerifiedAt === null) {
        return { ok: false, reason: 'invalid_destination' };
      }

      const message = TEMPLATES[args.event]({
        to: email,
        libraryName: deps.libraryName,
        publicUrl: deps.publicUrl,
        payload: args.payload,
      });
      return deps.mailer.send(message);
    },
  };
}
```

Replace the `ReturnType<typeof notice>` in the `TEMPLATES` annotation with `MailMessage` and import that type from `./mailer` — `notice` is module-private in `mail-template.ts` and not in scope here:

```ts
import type { Mailer, MailMessage, SendResult } from './mailer';

const TEMPLATES: Record<NotificationEvent, (args: NoticeArgs) => MailMessage> = {
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w app/server -- services/notification-channel-email`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

Run: `npm run lint -w app/server`

```bash
git add app/server/services/notification-channel-email.ts \
        app/server/services/notification-channel-email.test.ts
git commit -m "feat(server): add the email notification channel driver"
```

---

### Task 6: The drain

**Files:**
- Create: `app/server/services/notification-queue.ts`
- Test: `app/server/services/notification-queue.test.ts`

**Interfaces:**
- Consumes: `ChannelDriver`/`NotificationRecipient` (Task 5), `NotificationChannel`/`parsePayload` (Task 3), Task 2's tables.
- Produces, from `services/notification-queue.ts`:
  - `const BACKOFF_MS: readonly number[]`, `const MAX_ATTEMPTS: number`, `const TICK_MS: number`, `const RETENTION_MS: number`
  - `type NotificationQueueDeps = { prisma: PrismaClient; drivers: Partial<Record<NotificationChannel, ChannelDriver>>; now?: () => number }`
  - `class NotificationQueue { constructor(deps: NotificationQueueDeps); start(): void; stop(): void; poke(): void; awaitIdle(): Promise<void>; drainOnce(): Promise<void> }`
  - `type NotificationPoker = { poke(): void }`

- [ ] **Step 1: Write the failing tests**

Create `app/server/services/notification-queue.test.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from '../db/client';
import { runMigrations } from '../db/migrate';
import type { SendResult } from './mailer';
import { enqueueNotification, type NotificationPayload } from './notification';
import type { ChannelDriver } from './notification-channel-email';
import {
  BACKOFF_MS,
  MAX_ATTEMPTS,
  NotificationQueue,
  RETENTION_MS,
} from './notification-queue';

vi.mock('../logger');

let tmpDir: string;
let prisma: PrismaClient;
const ALICE = 'user-alice';
const NOW = 1_000_000;

const payload: NotificationPayload = {
  requesterUsername: 'alice',
  title: 'Dune',
  author: 'Frank Herbert',
  note: '',
  declineReason: '',
};

type StubDriver = ChannelDriver & { calls: number; nextResult: SendResult };

const stubDriver = (): StubDriver => ({
  calls: 0,
  nextResult: { ok: true },
  async deliver(): Promise<SendResult> {
    this.calls += 1;
    return this.nextResult;
  },
});

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notification-queue-'));
  const booksDir = path.join(tmpDir, 'books');
  fs.mkdirSync(booksDir, { recursive: true });
  prisma = createPrismaClient(`file:${path.join(tmpDir, 'db.sqlite')}`);
  await runMigrations(prisma, booksDir);
  await prisma.user.create({
    data: { id: ALICE, username: 'alice', email: 'alice@example.com', emailVerifiedAt: 1 },
  });
});

afterEach(async () => {
  await prisma.$disconnect();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const enqueue = () =>
  enqueueNotification(prisma, {
    event: 'book_request.fulfilled',
    subjectUserId: ALICE,
    payload,
    now: NOW,
  });

const queueWith = (driver: ChannelDriver | undefined, now = NOW) =>
  new NotificationQueue({
    prisma,
    drivers: driver === undefined ? {} : { email: driver },
    now: () => now,
  });

const onlyRow = async () => {
  const rows = await prisma.notificationOutbox.findMany();
  expect(rows).toHaveLength(1);
  return rows[0];
};

describe('NotificationQueue.drainOnce', () => {
  it('delivers a due row and marks it sent', async () => {
    await enqueue();
    const driver = stubDriver();

    await queueWith(driver).drainOnce();

    expect(driver.calls).toBe(1);
    expect((await onlyRow()).sentAt).toBe(NOW);
  });

  it('hands the driver the recipient row, not just an id', async () => {
    await enqueue();
    const seen: unknown[] = [];
    const driver: ChannelDriver = {
      async deliver(args) {
        seen.push(args.recipient);
        return { ok: true };
      },
    };

    await queueWith(driver).drainOnce();

    expect(seen).toEqual([
      { userId: ALICE, email: 'alice@example.com', emailVerifiedAt: 1 },
    ]);
  });

  it('leaves a row whose nextAttemptAt is in the future alone', async () => {
    await enqueue();
    await prisma.notificationOutbox.updateMany({ data: { nextAttemptAt: NOW + 1 } });
    const driver = stubDriver();

    await queueWith(driver).drainOnce();

    expect(driver.calls).toBe(0);
    expect((await onlyRow()).sentAt).toBeNull();
  });

  it('gives up permanently on invalid_destination', async () => {
    await enqueue();
    const driver = stubDriver();
    driver.nextResult = { ok: false, reason: 'invalid_destination' };

    await queueWith(driver).drainOnce();

    const row = await onlyRow();
    expect(row.failedAt).toBe(NOW);
    expect(row.attempts).toBe(0);
    expect(row.lastError).toContain('invalid_destination');
  });

  it('gives up permanently on misconfigured', async () => {
    await enqueue();
    const driver = stubDriver();
    driver.nextResult = { ok: false, reason: 'misconfigured' };

    await queueWith(driver).drainOnce();

    expect((await onlyRow()).failedAt).toBe(NOW);
  });

  it('backs off a transient failure on the published schedule', async () => {
    await enqueue();
    const driver = stubDriver();
    driver.nextResult = { ok: false, reason: 'transient' };

    await queueWith(driver).drainOnce();

    const row = await onlyRow();
    expect(row.attempts).toBe(1);
    expect(row.failedAt).toBeNull();
    expect(row.nextAttemptAt).toBe(NOW + BACKOFF_MS[0]);
  });

  it('gives up after MAX_ATTEMPTS transient failures', async () => {
    await enqueue();
    await prisma.notificationOutbox.updateMany({ data: { attempts: MAX_ATTEMPTS - 1 } });
    const driver = stubDriver();
    driver.nextResult = { ok: false, reason: 'throttled' };

    await queueWith(driver).drainOnce();

    const row = await onlyRow();
    expect(row.attempts).toBe(MAX_ATTEMPTS);
    expect(row.failedAt).toBe(NOW);
  });

  it('discards a row whose channel has no driver', async () => {
    await enqueue();

    await queueWith(undefined).drainOnce();

    expect(await prisma.notificationOutbox.count()).toBe(0);
  });

  it('discards a row whose recipient no longer exists', async () => {
    await enqueue();
    await prisma.notificationOutbox.updateMany({ data: { userId: ALICE } });
    await prisma.user.update({ where: { id: ALICE }, data: { username: 'alice' } });
    // Simulate a vanished recipient without tripping the cascade.
    await prisma.$executeRawUnsafe(
      `UPDATE "notification_outbox" SET "user_id" = 'ghost' WHERE 1 = 1`
    );
    const driver = stubDriver();

    await queueWith(driver).drainOnce();

    expect(driver.calls).toBe(0);
    expect(await prisma.notificationOutbox.count()).toBe(0);
  });

  it('prunes settled rows older than the retention window and keeps fresh ones', async () => {
    await enqueue();
    await prisma.notificationOutbox.updateMany({ data: { sentAt: NOW - RETENTION_MS - 1 } });
    await prisma.notificationOutbox.create({
      data: {
        id: 'fresh',
        userId: ALICE,
        event: 'book_request.declined',
        channel: 'email',
        payload: JSON.stringify(payload),
        nextAttemptAt: NOW,
        createdAt: NOW,
        failedAt: NOW,
      },
    });

    await queueWith(stubDriver()).drainOnce();

    const ids = (await prisma.notificationOutbox.findMany({ select: { id: true } })).map(
      (r) => r.id
    );
    expect(ids).toEqual(['fresh']);
  });
});

describe('NotificationQueue lifecycle', () => {
  it('drains on poke and settles awaitIdle', async () => {
    await enqueue();
    const driver = stubDriver();
    const queue = queueWith(driver);

    queue.poke();
    await queue.awaitIdle();

    expect(driver.calls).toBe(1);
    expect((await onlyRow()).sentAt).toBe(NOW);
  });

  it('awaitIdle resolves immediately when nothing is running', async () => {
    await expect(queueWith(stubDriver()).awaitIdle()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w app/server -- services/notification-queue`
Expected: FAIL — cannot resolve `./notification-queue`.

- [ ] **Step 3: Write the queue**

Create `app/server/services/notification-queue.ts`:

```ts
/**
 * The drain. Shaped like `ThumbnailQueue` — started once from `index.ts`, poked
 * when work arrives, with a timer so a backed-off row is retried without
 * needing a fresh enqueue to poke it, and exposing `awaitIdle()` so tests
 * settle deterministically instead of racing a sleep.
 *
 * IT NAMES NO CHANNEL. Drivers arrive in a map, one entry today; adding web
 * push is an entry rather than a change to this file. The payload it reads is
 * channel-neutral event data and is rendered by the driver, which is the
 * invariant that keeps a second channel from becoming a migration of every
 * queued row.
 *
 * `now` is injected so the backoff arithmetic is asserted directly rather than
 * through fake timers.
 */
import type { PrismaClient } from '@prisma/client';

import { logger } from '../logger';
import type { SendFailure } from './mailer';
import { parsePayload, type NotificationChannel } from './notification';
import type { ChannelDriver, NotificationRecipient } from './notification-channel-email';

const log = logger('NotificationQueue');

/**
 * Deliberately long-tailed. The failures that reach a retry are a throttled
 * API or an install whose network came back, and neither is fixed by retrying
 * in seconds. Indexed by the attempt that just failed, so a row that has failed
 * `n` times waits `BACKOFF_MS[n - 1]`.
 */
export const BACKOFF_MS: readonly number[] = [60_000, 300_000, 1_500_000, 7_200_000, 36_000_000];
export const MAX_ATTEMPTS = 5;
export const TICK_MS = 60_000;
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** How many rows one pass will move, so a large backlog cannot monopolise a tick. */
const BATCH_SIZE = 20;

/** No amount of retrying fixes either of these. */
const TERMINAL: readonly SendFailure[] = ['invalid_destination', 'misconfigured'];

export type NotificationQueueDeps = {
  prisma: PrismaClient;
  drivers: Partial<Record<NotificationChannel, ChannelDriver>>;
  now?: () => number;
};

/**
 * The hint the GraphQL layer holds. A poke is best-effort: it is sent AFTER the
 * transaction that enqueued commits (poking inside it would let this drain read
 * uncommitted state and find nothing), and if it is lost the timer picks the row
 * up within `TICK_MS`.
 */
export type NotificationPoker = { poke(): void };

export class NotificationQueue implements NotificationPoker {
  private readonly prisma: PrismaClient;
  private readonly drivers: Partial<Record<NotificationChannel, ChannelDriver>>;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private pending = false;
  private current: Promise<void> = Promise.resolve();

  constructor(deps: NotificationQueueDeps) {
    this.prisma = deps.prisma;
    this.drivers = deps.drivers;
    this.now = deps.now ?? Date.now;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.poke(), TICK_MS);
    // Never hold the process open on this timer alone.
    this.timer.unref?.();
    this.poke();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Runs a pass, or notes that another one is owed if a pass is already running. */
  poke(): void {
    if (this.running) {
      this.pending = true;
      return;
    }
    this.running = true;
    this.current = (async () => {
      try {
        do {
          this.pending = false;
          await this.drainOnce();
        } while (this.pending);
      } catch (e) {
        log.warn(`Notification drain failed: ${String(e)}`);
      } finally {
        this.running = false;
      }
    })();
  }

  /** Resolves when the pass in flight (if any) has finished. */
  async awaitIdle(): Promise<void> {
    await this.current;
  }

  /** One pass. Exported behaviour rather than private so tests drive it directly. */
  async drainOnce(): Promise<void> {
    const now = this.now();
    await this.prune(now);

    const due = await this.prisma.notificationOutbox.findMany({
      where: { sentAt: null, failedAt: null, nextAttemptAt: { lte: now } },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    for (const row of due) {
      const driver = this.drivers[row.channel as NotificationChannel];
      if (driver === undefined) {
        // An install that never configured this channel. Discarded rather than
        // recorded as a failure, so a LAN-only install generates no error noise
        // and the table stays bounded.
        log.debug(`No driver for channel ${row.channel}; discarding ${row.id}`);
        await this.prisma.notificationOutbox.delete({ where: { id: row.id } });
        continue;
      }

      const recipient = await this.loadRecipient(row.userId);
      if (recipient === null) {
        log.debug(`Recipient ${row.userId} is gone; discarding ${row.id}`);
        await this.prisma.notificationOutbox.delete({ where: { id: row.id } });
        continue;
      }

      const result = await driver.deliver({
        recipient,
        event: row.event as Parameters<ChannelDriver['deliver']>[0]['event'],
        payload: parsePayload(row.payload),
      });

      if (result.ok) {
        await this.prisma.notificationOutbox.update({
          where: { id: row.id },
          data: { sentAt: now, lastError: null },
        });
        continue;
      }

      if (TERMINAL.includes(result.reason)) {
        await this.prisma.notificationOutbox.update({
          where: { id: row.id },
          data: { failedAt: now, lastError: `terminal: ${result.reason}` },
        });
        continue;
      }

      const attempts = row.attempts + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      await this.prisma.notificationOutbox.update({
        where: { id: row.id },
        data: {
          attempts,
          lastError: `${result.reason} (attempt ${attempts})`,
          failedAt: exhausted ? now : null,
          nextAttemptAt: exhausted
            ? row.nextAttemptAt
            : now + (BACKOFF_MS[attempts - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]),
        },
      });
    }
  }

  private async loadRecipient(userId: string): Promise<NotificationRecipient | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, emailVerifiedAt: true },
    });
    return row === null
      ? null
      : { userId: row.id, email: row.email, emailVerifiedAt: row.emailVerifiedAt };
  }

  /** Settled rows are kept for a window so an operator can see what happened. */
  private async prune(now: number): Promise<void> {
    const cutoff = now - RETENTION_MS;
    await this.prisma.notificationOutbox.deleteMany({
      where: { OR: [{ sentAt: { lt: cutoff } }, { failedAt: { lt: cutoff } }] },
    });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w app/server -- services/notification-queue`
Expected: PASS. If the "recipient no longer exists" case trips the foreign key instead, drop the raw `UPDATE` and assert the discard by deleting the user with `prisma.user.delete` and re-inserting an orphan row via `$executeRawUnsafe` with `PRAGMA foreign_keys = OFF` — the behaviour under test is the discard, not SQLite's enforcement.

- [ ] **Step 5: Lint and commit**

Run: `npm run lint -w app/server`

```bash
git add app/server/services/notification-queue.ts app/server/services/notification-queue.test.ts
git commit -m "feat(server): add the notification outbox drain"
```

---

### Task 7: Enqueue from the three book-request triggers

**Files:**
- Modify: `app/server/services/book-request.ts`
- Test: `app/server/services/book-request.test.ts`

**Interfaces:**
- Consumes: `enqueueNotification` (Task 3).
- Produces: no signature changes. `createBookRequest`, `fulfillBookRequest` and `declineBookRequest` keep their exact parameters and outcome unions; `declineBookRequest` now runs inside a transaction.

- [ ] **Step 1: Write the failing tests**

Append to `app/server/services/book-request.test.ts`. Add `import { parsePayload } from './notification';` to its imports, and a verified admin row where noted:

```ts
describe('notification enqueue', () => {
  const ADMIN = 'user-admin';

  const makeAdmin = () =>
    prisma.user.create({ data: { id: ADMIN, username: 'admin', isConfigAdmin: true } });

  const outbox = () => prisma.notificationOutbox.findMany({ orderBy: { createdAt: 'asc' } });

  it('enqueues book_request.created to the admin, with the requester and the book', async () => {
    await makeAdmin();

    await createBookRequest(prisma, input({ note: 'the 1965 edition' }));

    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(ADMIN);
    expect(rows[0].event).toBe('book_request.created');
    expect(parsePayload(rows[0].payload)).toEqual({
      requesterUsername: 'alice',
      title: 'Dune',
      author: 'Frank Herbert',
      note: 'the 1965 edition',
      declineReason: '',
    });
  });

  it('enqueues nothing for a duplicate', async () => {
    await makeAdmin();
    await createBookRequest(prisma, input());
    await prisma.notificationOutbox.deleteMany();

    const outcome = await createBookRequest(prisma, input());

    expect(outcome.kind).toBe('duplicate');
    expect(await prisma.notificationOutbox.count()).toBe(0);
  });

  it('enqueues nothing when the request is refused by the open-request cap', async () => {
    await makeAdmin();
    for (let i = 0; i < MAX_OPEN_BOOK_REQUESTS; i++) {
      await createBookRequest(prisma, input({ title: `Book ${i}` }));
    }
    await prisma.notificationOutbox.deleteMany();

    const outcome = await createBookRequest(prisma, input({ title: 'One too many' }));

    expect(outcome.kind).toBe('limit');
    expect(await prisma.notificationOutbox.count()).toBe(0);
  });

  it('enqueues book_request.fulfilled to the requester', async () => {
    const created = await createBookRequest(prisma, input());
    expect(created.kind).toBe('created');
    await prisma.notificationOutbox.deleteMany();
    // A book on alice's shelf to fulfil with.
    await prisma.book.create({
      data: { userId: ALICE, id: 'book-1', title: 'Dune', size: 1, mtime: 0, addedAt: 0 },
    });

    const outcome = await fulfillBookRequest(prisma, {
      userId: ALICE,
      id: created.kind === 'created' ? created.id : '',
      bookUserId: ALICE,
      bookId: 'book-1',
    });

    expect(outcome.kind).toBe('resolved');
    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: ALICE, event: 'book_request.fulfilled' });
    expect(parsePayload(rows[0].payload).title).toBe('Dune');
  });

  it('enqueues book_request.declined to the requester, carrying the reason', async () => {
    const created = await createBookRequest(prisma, input());
    expect(created.kind).toBe('created');
    await prisma.notificationOutbox.deleteMany();

    const outcome = await declineBookRequest(prisma, {
      userId: ALICE,
      id: created.kind === 'created' ? created.id : '',
      reason: '  already on the shelf  ',
    });

    expect(outcome.kind).toBe('resolved');
    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: ALICE, event: 'book_request.declined' });
    expect(parsePayload(rows[0].payload).declineReason).toBe('already on the shelf');
  });

  it('enqueues nothing when a decline finds no pending request', async () => {
    const created = await createBookRequest(prisma, input());
    expect(created.kind).toBe('created');
    const id = created.kind === 'created' ? created.id : '';
    await declineBookRequest(prisma, { userId: ALICE, id, reason: '' });
    await prisma.notificationOutbox.deleteMany();

    const outcome = await declineBookRequest(prisma, { userId: ALICE, id, reason: '' });

    expect(outcome.kind).toBe('notPending');
    expect(await prisma.notificationOutbox.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w app/server -- services/book-request`
Expected: FAIL — the outbox is empty in every enqueue case.

- [ ] **Step 3: Enqueue from `createBookRequest`**

In `app/server/services/book-request.ts`, add the import:

```ts
import { enqueueNotification } from './notification';
```

Then inside `createBookRequest`'s transaction, replace the tail after `tx.bookRequest.create(...)`:

```ts
    const created = await tx.bookRequest.create({
      data: {
        userId: input.userId,
        id: randomUUID(),
        title: input.title.trim(),
        author: input.author.trim(),
        note: input.note.trim(),
        dedupeKey: key,
      },
      select: { id: true, title: true, author: true, note: true },
    });

    // IN THE TRANSACTION, deliberately: an outbox row that could be lost
    // between this insert and the queue would defeat the durable outbox the
    // spec is paying for. Only on the `created` path — a duplicate or a
    // rejected cap is not an event.
    const requester = await tx.user.findUnique({
      where: { id: input.userId },
      select: { username: true },
    });
    await enqueueNotification(tx, {
      event: 'book_request.created',
      subjectUserId: input.userId,
      payload: {
        requesterUsername: requester?.username ?? '',
        title: created.title,
        author: created.author,
        note: created.note,
        declineReason: '',
      },
    });

    return { kind: 'created', id: created.id };
```

- [ ] **Step 4: Enqueue from `fulfillBookRequest`**

Widen the existing lookup and add the enqueue before the transaction returns:

```ts
    const request = await tx.bookRequest.findUnique({
      where: { userId_id: { userId: args.userId, id: args.id } },
      select: {
        status: true,
        title: true,
        author: true,
        note: true,
        user: { select: { username: true } },
      },
    });
```

and after the `tx.bookRequest.update(...)` call:

```ts
    await enqueueNotification(tx, {
      event: 'book_request.fulfilled',
      subjectUserId: args.userId,
      payload: {
        requesterUsername: request.user.username,
        title: request.title,
        author: request.author,
        note: request.note,
        declineReason: '',
      },
    });
    return { kind: 'resolved' };
```

- [ ] **Step 5: Give `declineBookRequest` a transaction and enqueue**

Replace the whole function, doc comment included:

```ts
/**
 * Closes a pending request as declined, with an optional reason.
 *
 * IN A TRANSACTION — and it did not used to be. The `status: 'pending'` term in
 * the `where` is still what makes the guard and the write one statement, so two
 * concurrent resolves cannot both see `pending`; that reasoning is unchanged and
 * is why this is an `updateMany` rather than a read-then-write. What the
 * transaction adds is the OUTBOX ROW: a notification that could be lost between
 * the status change and the queue would defeat the durable outbox (see
 * `NotificationOutbox`), so the enqueue has to commit with the update that
 * caused it. The follow-up read still only runs when nothing was updated, to
 * tell "no such row" from "already resolved".
 */
export async function declineBookRequest(
  prisma: PrismaClient,
  args: { userId: string; id: string; reason: string }
): Promise<ResolveOutcome> {
  const reason = args.reason.trim();

  return prisma.$transaction(async (tx) => {
    const updated = await tx.bookRequest.updateMany({
      where: { userId: args.userId, id: args.id, status: 'pending' },
      data: { status: 'declined', declineReason: reason, resolvedAt: Date.now() },
    });

    if (updated.count !== 1) {
      const existing = await tx.bookRequest.findUnique({
        where: { userId_id: { userId: args.userId, id: args.id } },
        select: { status: true },
      });
      return existing === null
        ? { kind: 'missing' }
        : { kind: 'notPending', status: existing.status as BookRequestStatus };
    }

    const declined = await tx.bookRequest.findUniqueOrThrow({
      where: { userId_id: { userId: args.userId, id: args.id } },
      select: { title: true, author: true, note: true, user: { select: { username: true } } },
    });
    await enqueueNotification(tx, {
      event: 'book_request.declined',
      subjectUserId: args.userId,
      payload: {
        requesterUsername: declined.user.username,
        title: declined.title,
        author: declined.author,
        note: declined.note,
        declineReason: reason,
      },
    });
    return { kind: 'resolved' };
  });
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -w app/server -- services/book-request`
Expected: PASS, including every pre-existing case in that file.

- [ ] **Step 7: Run the full server suite and lint**

Run: `npm test -w app/server && npm run lint -w app/server`
Expected: PASS, clean. The GraphQL book-request mutation tests must still pass — they exercise these service functions.

- [ ] **Step 8: Commit**

```bash
git add app/server/services/book-request.ts app/server/services/book-request.test.ts
git commit -m "feat(server): enqueue notifications from the book-request triggers"
```

---

### Task 8: Wire the queue into the server and poke it from the resolvers

**Files:**
- Modify: `app/server/index.ts`
- Modify: `app/server/graphql/context.ts`
- Modify: `app/server/graphql/test-util.ts`
- Modify: `app/server/graphql/schema/book-request/mutation/create.ts`
- Modify: `app/server/graphql/schema/book-request/mutation/fulfill.ts`
- Modify: `app/server/graphql/schema/book-request/mutation/decline.ts`
- Test: `app/server/graphql/schema/book-request/mutation/create.test.ts`

**Interfaces:**
- Consumes: `NotificationQueue`, `NotificationPoker` (Task 6), `createEmailChannelDriver` (Task 5).
- Produces: `Context.notifications: NotificationPoker`; `Harness.pokes: number` on the GraphQL test harness.

- [ ] **Step 1: Write the failing test**

Append to `app/server/graphql/schema/book-request/mutation/create.test.ts`:

```ts
  it('pokes the notification queue after a successful create', async () => {
    const result = await harness.execute(
      `mutation {
         bookRequestCreate(input: { title: "Dune", author: "Frank Herbert" }) {
           __typename
         }
       }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(harness.pokes).toBe(1);
  });

  it('does not poke when the input is rejected', async () => {
    const result = await harness.execute(
      `mutation {
         bookRequestCreate(input: { title: "   ", author: "Frank Herbert" }) {
           __typename
         }
       }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(harness.pokes).toBe(0);
  });
```

Use whatever that file's existing tests call the alice viewer — do not introduce a second name for it.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w app/server -- book-request/mutation/create`
Expected: FAIL — `harness.pokes` is undefined.

- [ ] **Step 3: Add the poker to `Context`**

In `app/server/graphql/context.ts`, add to both the `Context` type and the deps type, beside `mailer`:

```ts
  /**
   * A HINT, not a delivery path. The outbox row is already committed by the
   * time a resolver pokes (`services/book-request.ts` writes it inside the
   * mutation's own transaction), so a lost poke costs at most one drain tick —
   * see `NotificationPoker`. Poking from the resolver rather than the service
   * is deliberate: a poke inside the transaction would let the drain read
   * uncommitted state and find nothing.
   */
  notifications: NotificationPoker;
```

with `import type { NotificationPoker } from '../services/notification-queue';`, and pass it through wherever `mailer: deps.mailer` is passed.

- [ ] **Step 4: Poke from the three resolvers**

In `create.ts`, in the `'created'` arm:

```ts
        case 'created':
          context.notifications.poke();
          return { __typename: 'BookRequestCreatePayload' as const, userId, requestId: outcome.id };
```

In `decline.ts`, in the `'resolved'` arm:

```ts
        case 'resolved':
          context.notifications.poke();
          return { __typename: 'BookRequestDeclinePayload' as const, userId, requestId };
```

In `fulfill.ts`, add the same `context.notifications.poke();` line immediately before that mutation's `'resolved'` arm returns its payload.

- [ ] **Step 5: Give the test harness a recording poker**

In `app/server/graphql/test-util.ts`, add a counter beside the `mailer` wiring, expose it on `Harness`, and pass it into the context deps:

```ts
  // A recording poker, so a test can assert the resolver hinted the drain
  // without constructing a real queue. Counting rather than spying keeps the
  // assertion readable — see `book-request/mutation/create.test.ts`.
  let pokes = 0;
  const notifications: NotificationPoker = { poke: () => { pokes += 1; } };
```

Add to the `Harness` type:

```ts
  /** How many times a resolver has poked the notification drain. */
  readonly pokes: number;
```

Because `pokes` is reassigned, expose it as a getter on the returned object so the harness reports the live count:

```ts
    get pokes() {
      return pokes;
    },
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -w app/server -- book-request/mutation/create`
Expected: PASS.

- [ ] **Step 7: Start the queue in `index.ts`**

In `app/server/index.ts`, after the `mailer` is constructed:

```ts
  // One queue, started once. The email driver exists only when mail is
  // configured; with no driver the drain discards the rows it finds, which is
  // how a LAN-only install stays bounded without the services needing to know
  // whether mail exists (see `enqueueNotification`).
  const notificationQueue = new NotificationQueue({
    prisma,
    drivers:
      mailer === null
        ? {}
        : {
            email: createEmailChannelDriver({
              mailer,
              libraryName: config.libraryName,
              publicUrl: config.publicUrl ?? null,
            }),
          },
  });
  notificationQueue.start();
```

Pass `notifications: notificationQueue` into `createGraphqlHandler({ ... })`. Add the two imports. If `config` exposes the library name under a different key, use that key — check `types.ts` for the field the existing mail templates are given.

- [ ] **Step 8: Run the full server suite and lint**

Run: `npm test -w app/server && npm run lint -w app/server`
Expected: PASS, clean.

- [ ] **Step 9: Commit**

```bash
git add app/server/index.ts app/server/graphql/context.ts app/server/graphql/test-util.ts \
        app/server/graphql/schema/book-request/mutation
git commit -m "feat(server): start the notification drain and poke it from the request mutations"
```

---

### Task 9: The GraphQL surface

**Files:**
- Create: `app/server/graphql/schema/notification-event/model.ts`
- Create: `app/server/graphql/schema/notification-channel/model.ts`
- Create: `app/server/graphql/schema/notification-preference/model.ts`
- Create: `app/server/graphql/schema/viewer/mutation/set-notification-preference.ts`
- Modify: `app/server/graphql/schema/viewer/model.ts`
- Modify: `app/server/graphql/schema/viewer/index.ts`
- Modify: `app/server/graphql/schema.generated.graphql` (regenerated)
- Test: `app/server/graphql/schema/viewer/notification-fields.test.ts`

**Interfaces:**
- Consumes: Task 3's service functions; `resolveViewerUserId` from `viewer/mutation/resolve-user-id`.
- Produces: `Viewer.notificationPreferences: [NotificationPreference!]!` and the root mutation `viewerSetNotificationPreference(event: NotificationEvent!, channel: NotificationChannel!, enabled: Boolean!): ViewerSetNotificationPreferencePayload`.

- [ ] **Step 1: Write the failing tests**

Create `app/server/graphql/schema/viewer/notification-fields.test.ts`:

```ts
import { MAIL_CONFIG } from '../../../test-support/mail';
import { setNotificationPreference } from '../../../services/notification';
import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

const QUERY = '{ viewer { notificationPreferences { event channel enabled } } }';

afterEach(async () => {
  await harness.cleanup();
});

describe('Viewer.notificationPreferences', () => {
  it('gives a reader the two outcome events, enabled by default', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });

    const result = await harness.execute(QUERY);

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      viewer: {
        notificationPreferences: [
          { event: 'BOOK_REQUEST_FULFILLED', channel: 'EMAIL', enabled: true },
          { event: 'BOOK_REQUEST_DECLINED', channel: 'EMAIL', enabled: true },
        ],
      },
    });
  });

  it('reflects a stored opt-out', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });
    await setNotificationPreference(harness.prisma, {
      userId: harness.aliceOwner.userId,
      event: 'book_request.declined',
      channel: 'email',
      enabled: false,
    });

    const result = await harness.execute(QUERY);

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      viewer: {
        notificationPreferences: [
          { event: 'BOOK_REQUEST_FULFILLED', channel: 'EMAIL', enabled: true },
          { event: 'BOOK_REQUEST_DECLINED', channel: 'EMAIL', enabled: false },
        ],
      },
    });
  });

  it('gives the config admin only the created event', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });

    const result = await harness.execute(QUERY, { viewer: harness.adminViewer });

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      viewer: {
        notificationPreferences: [
          { event: 'BOOK_REQUEST_CREATED', channel: 'EMAIL', enabled: true },
        ],
      },
    });
  });

  it('is empty on an install with no mail configured', async () => {
    harness = await createHarness();

    const result = await harness.execute(QUERY);

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ viewer: { notificationPreferences: [] } });
  });
});

describe('viewerSetNotificationPreference', () => {
  const MUTATION = `
    mutation Set($enabled: Boolean!) {
      viewerSetNotificationPreference(
        event: BOOK_REQUEST_DECLINED
        channel: EMAIL
        enabled: $enabled
      ) {
        notificationPreferences { event enabled }
      }
    }
  `;

  it('stores an opt-out and returns the updated catalogue', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });

    const result = await harness.execute(MUTATION, { variables: { enabled: false } });

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      viewerSetNotificationPreference: {
        notificationPreferences: [
          { event: 'BOOK_REQUEST_FULFILLED', enabled: true },
          { event: 'BOOK_REQUEST_DECLINED', enabled: false },
        ],
      },
    });
  });

  it('is idempotent when re-enabling', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });

    await harness.execute(MUTATION, { variables: { enabled: false } });
    await harness.execute(MUTATION, { variables: { enabled: true } });
    await harness.execute(MUTATION, { variables: { enabled: true } });

    expect(await harness.prisma.notificationPreference.count()).toBe(1);
  });

  it('writes the config admin’s own row, not a reader’s', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });

    const result = await harness.execute(
      `mutation {
         viewerSetNotificationPreference(
           event: BOOK_REQUEST_CREATED
           channel: EMAIL
           enabled: false
         ) {
           notificationPreferences { event enabled }
         }
       }`,
      { viewer: harness.adminViewer }
    );

    expect(result.errors).toBeUndefined();
    const rows = await harness.prisma.notificationPreference.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).not.toBe(harness.aliceOwner.userId);
    expect(rows[0].event).toBe('book_request.created');
  });
});
```

Check `test-util.ts` for the exact `execute` signature — if it takes variables differently from `{ variables }`, follow the existing shape used elsewhere in the repo.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w app/server -- viewer/notification-fields`
Expected: FAIL — `Cannot query field "notificationPreferences"`.

- [ ] **Step 3: Add the two enums**

Create `app/server/graphql/schema/notification-event/model.ts`:

```ts
import type { NotificationEvent } from '../../../services/notification';
import { builder } from '../builder';

const values = {
  BOOK_REQUEST_CREATED: { value: 'book_request.created' },
  BOOK_REQUEST_FULFILLED: { value: 'book_request.fulfilled' },
  BOOK_REQUEST_DECLINED: { value: 'book_request.declined' },
} as const satisfies Record<string, { value: NotificationEvent }>;

/**
 * Mirrors `NotificationEvent` in `services/notification.ts`. The `satisfies`
 * above rejects a member whose value is not an event; `_Complete` below
 * rejects an event with no member — the stored strings are dotted, so
 * `Record<Uppercase<...>>` (the trick `BookRequestStatus` uses) cannot express
 * the mapping and exhaustiveness has to be asserted separately.
 */
type Declared = (typeof values)[keyof typeof values]['value'];
type Assert<T extends never> = T;
export type _Complete = Assert<Exclude<NotificationEvent, Declared>>;

export const model = builder.enumType('NotificationEvent', { values });
```

Create `app/server/graphql/schema/notification-channel/model.ts`:

```ts
import type { NotificationChannel } from '../../../services/notification';
import { builder } from '../builder';

const values = {
  EMAIL: { value: 'email' },
} as const satisfies Record<string, { value: NotificationChannel }>;

/** Web push adds a member here and nothing else. See `notification-event/model.ts`. */
type Declared = (typeof values)[keyof typeof values]['value'];
type Assert<T extends never> = T;
export type _Complete = Assert<Exclude<NotificationChannel, Declared>>;

export const model = builder.enumType('NotificationChannel', { values });
```

- [ ] **Step 4: Add the object type**

Create `app/server/graphql/schema/notification-preference/model.ts`:

```ts
import type { NotificationChannel, NotificationEvent } from '../../../services/notification';
import { builder } from '../builder';
import { model as notificationChannelModel } from '../notification-channel/model';
import { model as notificationEventModel } from '../notification-event/model';

/**
 * An `objectRef` over a plain shape, NOT a `prismaObject`: the catalogue this
 * type is returned in includes preferences that have no row at all (an absent
 * row means enabled — see the Prisma model), so there is no row to hand a
 * `prismaObject` field.
 */
export type NotificationPreferenceShape = {
  readonly event: NotificationEvent;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
};

export const model = builder
  .objectRef<NotificationPreferenceShape>('NotificationPreference')
  .implement({
    description: 'Whether one notification event reaches this account on one channel.',
    fields: (t) => ({
      event: t.field({ type: notificationEventModel, resolve: (p) => p.event }),
      channel: t.field({ type: notificationChannelModel, resolve: (p) => p.channel }),
      enabled: t.boolean({ resolve: (p) => p.enabled }),
    }),
  });
```

- [ ] **Step 5: Add the `Viewer` field**

In `app/server/graphql/schema/viewer/model.ts`, beside `email`/`emailVerifiedAt`:

```ts
    /**
     * The viewer's own catalogue, with defaults merged over stored rows and
     * filtered to the events this viewer is ever a recipient of — the admin
     * sees only `BOOK_REQUEST_CREATED`, a reader only the two outcomes. The
     * audience rules live in `services/notification.ts`; a client that
     * reconstructed them would be a second place for them to drift.
     *
     * Empty when no channel is configured, which is how the settings card knows
     * not to render on a LAN-only install rather than testing the mail config
     * a second time.
     */
    notificationPreferences: t.field({
      type: [notificationPreferenceModel],
      resolve: async (_v, _args, context) => {
        const userId = await resolveViewerUserId(context);
        if (userId === null) return [];
        return listNotificationPreferences(context.prisma, {
          userId,
          role: context.viewer?.userId == null ? 'admin' : 'reader',
          channels: isMailConfigured(context.config) ? NOTIFICATION_CHANNELS : [],
        });
      },
    }),
```

with imports for `listNotificationPreferences`, `NOTIFICATION_CHANNELS`, `isMailConfigured`, `notificationPreferenceModel` and `resolveViewerUserId`.

The role test is `context.viewer?.userId == null`: the config admin's token deliberately carries no `sub`, which is the same discriminator `bookRequestCreate`'s `authScopes` uses.

- [ ] **Step 6: Add the mutation**

Create `app/server/graphql/schema/viewer/mutation/set-notification-preference.ts`:

```ts
import {
  listNotificationPreferences,
  NOTIFICATION_CHANNELS,
  setNotificationPreference,
  type NotificationChannel,
  type NotificationEvent,
} from '../../../../services/notification';
import { isMailConfigured } from '../../../../services/mailer';
import { builder } from '../../builder';
import { model as notificationChannelModel } from '../../notification-channel/model';
import { model as notificationEventModel } from '../../notification-event/model';
import {
  model as notificationPreferenceModel,
  type NotificationPreferenceShape,
} from '../../notification-preference/model';
import { resolveViewerUserId } from './resolve-user-id';

type PayloadShape = {
  readonly __typename: 'ViewerSetNotificationPreferencePayload';
  readonly preferences: readonly NotificationPreferenceShape[];
};

const payload = builder
  .objectRef<PayloadShape>('ViewerSetNotificationPreferencePayload')
  .implement({
    fields: (t) => ({
      notificationPreferences: t.field({
        type: [notificationPreferenceModel],
        resolve: (parent) => [...parent.preferences],
      }),
    }),
  });

/**
 * Turns one notification on or off for the viewer's own account.
 *
 * `null` rather than an error union: there is no failure to report. An upsert
 * on the composite key cannot conflict, and an unknown event or channel is
 * rejected by the enums before a resolver runs. `null` covers the one real
 * case — no account row to key the preference to, which is the
 * `ensureAdminUser` collision an install can be left in.
 *
 * Returns the whole catalogue rather than the one row so a client re-renders
 * from a single authoritative list, exactly as `Viewer.notificationPreferences`
 * serves it.
 */
builder.mutationField('viewerSetNotificationPreference', (t) =>
  t.field({
    type: payload,
    nullable: true,
    description: "Turns one notification on or off for the viewer's own account.",
    args: {
      event: t.arg({ type: notificationEventModel, required: true }),
      channel: t.arg({ type: notificationChannelModel, required: true }),
      enabled: t.arg.boolean({ required: true }),
    },
    resolve: async (_root, args, context) => {
      const userId = await resolveViewerUserId(context);
      if (userId === null) return null;

      await setNotificationPreference(context.prisma, {
        userId,
        event: args.event as NotificationEvent,
        channel: args.channel as NotificationChannel,
        enabled: args.enabled,
      });

      const preferences = await listNotificationPreferences(context.prisma, {
        userId,
        role: context.viewer?.userId == null ? 'admin' : 'reader',
        channels: isMailConfigured(context.config) ? NOTIFICATION_CHANNELS : [],
      });
      return { __typename: 'ViewerSetNotificationPreferencePayload' as const, preferences };
    },
  })
);
```

Register it in `app/server/graphql/schema/viewer/index.ts`:

```ts
import './mutation/set-notification-preference';
```

keeping that file's imports alphabetically ordered.

- [ ] **Step 7: Run the tests, the root-auth walk and the cost budgets**

Run: `npm test -w app/server -- viewer/notification-fields`
Expected: PASS.

Run: `npm test -w app/server -- root-auth`
Expected: PASS. The type-level `{ authenticated: true }` on `builder.mutationType` covers the new mutation; if the walk demands a field-level scope, add `authScopes: (_p, _a, context) => context.viewer != null` and say so in the commit body.

Run: `npm run test:cost -w app/server`
Expected: PASS.

- [ ] **Step 8: Regenerate the schema and lint**

Run: `npm run graphql:schema -w app/server && npm run lint -w app/server`
Expected: the generated SDL gains the two enums, `NotificationPreference`, the `Viewer` field and the mutation; lint clean (it runs `graphql:schema:check`).

- [ ] **Step 9: Run the full server suite**

Run: `npm test -w app/server`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add app/server/graphql
git commit -m "feat(server): expose notification preferences on Viewer with a set mutation"
```

---

### Task 10: The settings card

**Files:**
- Create: `app/client/src/graphql/notification.ts`
- Create: `app/client/src/component/notification-settings/index.tsx`
- Create: `app/client/src/component/notification-settings/style.ts`
- Create: `app/client/src/component/notification-settings/index.test.tsx`
- Modify: `app/client/src/component/index.ts`
- Modify: `app/client/src/graphql/viewer-bootstrap.ts`
- Modify: `app/client/src/page/user/index.tsx`

**Interfaces:**
- Consumes: Task 9's `Viewer.notificationPreferences` and `viewerSetNotificationPreference`.
- Produces: `<NotificationSettings preferences={...} emailVerified={boolean} />`, exported from `~/component`.

- [ ] **Step 1: Add the GraphQL documents**

Create `app/client/src/graphql/notification.ts`:

```ts
import { graphql } from '~/gql';

/**
 * The catalogue is served by `Viewer.notificationPreferences` and already
 * carries effective state and the viewer's audience filter — the card renders
 * what it is handed and encodes no defaults of its own.
 */
export const NotificationPreferenceFragment = graphql(`
  fragment NotificationPreference on NotificationPreference {
    event
    channel
    enabled
  }
`);

export const ViewerSetNotificationPreferenceDocument = graphql(`
  mutation ViewerSetNotificationPreference(
    $event: NotificationEvent!
    $channel: NotificationChannel!
    $enabled: Boolean!
  ) {
    viewerSetNotificationPreference(event: $event, channel: $channel, enabled: $enabled) {
      notificationPreferences {
        ...NotificationPreference
      }
    }
  }
`);
```

- [ ] **Step 2: Select the field in the bootstrap query**

In `app/client/src/graphql/viewer-bootstrap.ts`, add to the `viewer` selection:

```graphql
    notificationPreferences {
      ...NotificationPreference
    }
```

- [ ] **Step 3: Run codegen**

Run: `npm run codegen -w app/client`
Expected: `src/gql/graphql.ts` gains `NotificationEvent`, `NotificationChannel` and the new documents. If the script has another name, read `app/client/package.json` and use that one.

- [ ] **Step 4: Write the failing component test**

Create `app/client/src/component/notification-settings/index.test.tsx`:

```tsx
import { MockedProvider } from '@apollo/client/testing/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NotificationSettings } from '.';
import { ViewerSetNotificationPreferenceDocument } from '~/graphql/notification';

const preferences = [
  { __typename: 'NotificationPreference' as const, event: 'BOOK_REQUEST_FULFILLED' as const, channel: 'EMAIL' as const, enabled: true },
  { __typename: 'NotificationPreference' as const, event: 'BOOK_REQUEST_DECLINED' as const, channel: 'EMAIL' as const, enabled: false },
];

const renderCard = (props: Partial<Parameters<typeof NotificationSettings>[0]> = {}, mocks = []) =>
  render(
    <MockedProvider mocks={mocks}>
      <NotificationSettings preferences={preferences} emailVerified {...props} />
    </MockedProvider>
  );

describe('NotificationSettings', () => {
  it('renders nothing when the catalogue is empty', () => {
    const { container } = renderCard({ preferences: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one labelled control per preference, reflecting its state', () => {
    renderCard();

    const fulfilled = screen.getByRole('checkbox', { name: /added to my library/i });
    const declined = screen.getByRole('checkbox', { name: /declined/i });
    expect(fulfilled).toBeChecked();
    expect(declined).not.toBeChecked();
  });

  it('disables every control and explains why when the address is unverified', () => {
    renderCard({ emailVerified: false });

    expect(screen.getByRole('checkbox', { name: /added to my library/i })).toBeDisabled();
    expect(screen.getByText(/confirm your email address/i)).toBeInTheDocument();
  });

  it('sends the mutation when a toggle is flipped', async () => {
    const mocks = [
      {
        request: {
          query: ViewerSetNotificationPreferenceDocument,
          variables: { event: 'BOOK_REQUEST_FULFILLED', channel: 'EMAIL', enabled: false },
        },
        result: {
          data: {
            viewerSetNotificationPreference: {
              __typename: 'ViewerSetNotificationPreferencePayload',
              notificationPreferences: [
                { __typename: 'NotificationPreference', event: 'BOOK_REQUEST_FULFILLED', channel: 'EMAIL', enabled: false },
                { __typename: 'NotificationPreference', event: 'BOOK_REQUEST_DECLINED', channel: 'EMAIL', enabled: false },
              ],
            },
          },
        },
      },
    ];
    renderCard({}, mocks);

    await userEvent.click(screen.getByRole('checkbox', { name: /added to my library/i }));

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /added to my library/i })).not.toBeChecked();
    });
  });
});
```

Match this file's imports and `MockedProvider` usage to a sibling component test in this repo — `component/sync-password/index.test.tsx` is the closest analogue. Do not introduce a second testing idiom.

- [ ] **Step 5: Run it to verify it fails**

Run: `npm test -w app/client -- notification-settings`
Expected: FAIL — cannot resolve `.`.

- [ ] **Step 6: Write the card**

Create `app/client/src/component/notification-settings/index.tsx`:

```tsx
import { useMutation } from '@apollo/client/react';
import { useCallback } from 'react';

import { Card } from '~/component';
import type { NotificationChannel, NotificationEvent } from '~/gql/graphql';
import { ViewerSetNotificationPreferenceDocument } from '~/graphql/notification';
import { useToast } from '~/provider/toast';

import { useStyle } from './style';

export type NotificationPreferenceRow = {
  event: NotificationEvent;
  channel: NotificationChannel;
  enabled: boolean;
};

export type NotificationSettingsProps = {
  /**
   * The server's catalogue, already carrying effective state and this viewer's
   * audience filter. An empty list means this install has no channel
   * configured, and the card renders nothing rather than testing the mail
   * config a second time.
   */
  preferences: readonly NotificationPreferenceRow[];
  emailVerified: boolean;
};

/**
 * One row per (event, channel), GROUPED BY EVENT rather than one hardcoded
 * toggle per known event — so a second channel becomes a column here instead
 * of a rewrite. See the spec's "What web push inherits".
 */
const EVENT_LABELS: Record<NotificationEvent, string> = {
  BOOK_REQUEST_CREATED: 'A reader requests a book',
  BOOK_REQUEST_FULFILLED: 'A book I requested is added to my library',
  BOOK_REQUEST_DECLINED: 'A book I requested is declined',
};

export const NotificationSettings = ({
  preferences,
  emailVerified,
}: NotificationSettingsProps): React.ReactElement | null => {
  const style = useStyle();
  const toast = useToast();
  const [setPreference] = useMutation(ViewerSetNotificationPreferenceDocument);

  const onToggle = useCallback(
    async (row: NotificationPreferenceRow, enabled: boolean) => {
      try {
        await setPreference({ variables: { event: row.event, channel: row.channel, enabled } });
      } catch {
        toast.error('Could not save that preference');
      }
    },
    [setPreference, toast]
  );

  if (preferences.length === 0) return null;

  return (
    <Card title="Notifications">
      {!emailVerified && (
        <p className={style.hint}>
          Confirm your email address above to start receiving these.
        </p>
      )}
      <ul className={style.list}>
        {preferences.map((row) => (
          <li key={`${row.event}:${row.channel}`} className={style.row}>
            <label className={style.label}>
              <input
                type="checkbox"
                checked={row.enabled}
                disabled={!emailVerified}
                onChange={(e) => void onToggle(row, e.target.checked)}
              />
              {EVENT_LABELS[row.event]}
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
};
```

Create `app/client/src/component/notification-settings/style.ts` following the exact idiom of `component/email-setting/style.ts` (same styling library, same `useStyle` export shape), with `hint`, `list`, `row` and `label` rules. Read that file first and mirror it — do not introduce a second styling approach.

If `Card` does not take a `title` prop, use the same heading structure `EmailSetting` uses. If `useToast` exposes something other than `.error`, use what that provider actually exports.

- [ ] **Step 7: Export and mount it**

Add to `app/client/src/component/index.ts`, in alphabetical position:

```ts
export { NotificationSettings } from './notification-settings';
```

`app/client/src/page/user/index.tsx` has TWO render branches — an admin one and a reader one — sharing a single `emailSection` variable mounted in both. Follow that exact pattern rather than inlining the card once, or the admin (who is the only recipient of `BOOK_REQUEST_CREATED`) gets no card at all.

Beside the existing `emailSection`, add:

```tsx
  // Mounted in BOTH branches below, like `emailSection`: the admin is the only
  // recipient of `BOOK_REQUEST_CREATED`, so a card added to the reader branch
  // alone would hide the one toggle the admin has.
  const notificationSection = (
    <NotificationSettings
      preferences={viewerData?.viewer.notificationPreferences ?? []}
      emailVerified={viewerData?.viewer.emailVerifiedAt != null}
    />
  );
```

Then add `{notificationSection}` immediately after `{emailSection}` in **both** the `if (isAdmin)` return and the final return.

Note that `ViewerBootstrapDocument` — not `UserPageDocument` — is the query to extend in Step 2: it is the one that is unconditionally active for the admin too (`UserPageDocument` is fetched with `skip: isAdmin`), and that file's own comment records why.

- [ ] **Step 8: Run the client tests**

Run: `npm test -w app/client -- notification-settings`
Expected: PASS.

- [ ] **Step 9: Run the whole client suite, lint, and the cost budgets**

Run: `npm test -w app/client && npm run lint -w app/client`
Expected: PASS, clean. `page/user/index.test.tsx` may need the new field added to its mocked viewer.

Run: `npm run test:cost -w app/server`
Expected: PASS — this measures the client's shipped operations from `src/gql/persisted-documents.json`, so the enlarged bootstrap query is checked against the real budgets here.

- [ ] **Step 10: Commit**

```bash
git add app/client/src app/server/graphql/schema.generated.graphql
git commit -m "feat(client): add the notification preferences card to the account page"
```

---

### Task 11: End-to-end verification

No new behaviour — this is the gate that the whole feature works together before the branch is offered for review.

**Files:** none modified unless a failure is found.

- [ ] **Step 1: Full suite, both workspaces**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Full lint, both workspaces**

Run: `npm run lint`
Expected: clean, including `graphql:schema:check`.

- [ ] **Step 3: Confirm the schema is committed in step with the code**

Run: `git status --porcelain`
Expected: empty. A dirty `schema.generated.graphql` means a regeneration was never committed.

- [ ] **Step 4: Prove delivery end to end against a real database**

Write a throwaway script under the scratchpad directory (not the repo) that: migrates a temp database; creates a verified reader and a verified `isConfigAdmin` row; calls `createBookRequest`; then drains with a `NotificationQueue` wired to `createEmailChannelDriver` over `createFakeMailer()`; and asserts the admin received the "requested a book" message. Then `declineBookRequest` and assert the reader receives the decline, reason included.

Run it with `npx tsx <path>` from `app/server`.
Expected: both messages present, addressed correctly.

This is the one check no unit test makes: that the registry, the enqueue, the driver map, the templates and the address resolution agree on the same event strings. Delete the script afterwards.

- [ ] **Step 5: Confirm the feature is inert on a mail-less install**

In the same style, migrate a temp database, create a reader with **no** email, call `createBookRequest`, and drain a queue constructed with `drivers: {}`.
Expected: the outbox row is created and then discarded, the table ends empty, and nothing throws.

- [ ] **Step 6: Report**

Summarise: tests run and their results, the two probe outcomes, and anything the plan specified that turned out to be wrong. Do not claim any step passed without its output.

---

## Self-Review

**Spec coverage** — every section of `2026-09-21-notifications-design.md` maps to a task:

| Spec section | Task |
| --- | --- |
| Data model — both tables, migration pattern | 2 |
| `notify()` seam — registry, audience, channels, preference-at-enqueue | 3 |
| Delivery — driver map, terminal vs retryable, backoff, pruning | 6 |
| Delivery — unverified recipient is terminal | 5 (refinement noted) |
| `SendFailure` rename | 1 |
| Triggers — three sites, decline's new transaction, comment rewrite | 7 |
| Templates — `notice()`, three messages, deep link | 4 |
| GraphQL — enums, cross-product catalogue, audience filter, mutation | 9 |
| Client — card, three states, grouped-by-event rendering | 10 |
| Testing — services, drain, templates, GraphQL, migration, client, schema | in each task, plus 11 |
| Web push inheritance — channel-neutral payload, driver map, enum headroom | invariants stated in 2, 3, 5, 6, 10 |
| Known traps 1–5 | 2 (traps 1, 2), 7 (trap 3), 2/3 (trap 4), 3 (trap 5) |

**Two deliberate refinements of the spec**, both noted at their task:
- The unverified-address check lives in the driver, not the drain (Task 5) — same outcome, no email semantics in the queue.
- The outbox index is `(sentAt, failedAt, nextAttemptAt)`, matching the drain's actual `where` (Task 2).

**Type consistency** — checked across tasks: `NotificationEvent`, `NotificationChannel`, `NotificationPayload`, `NotificationDb`, `NotificationRecipient`, `ChannelDriver`, `NotificationPoker`, `NotificationPreferenceShape` are each defined in exactly one task and referenced by the same name afterwards. `enqueueNotification` takes `subjectUserId` in Tasks 3 and 7 alike. `parsePayload` is used in Tasks 3, 6 and 7 under that name. The service calls `listNotificationPreferences(db, { userId, role, channels })` identically in Task 9's two call sites.

**Known soft spots the implementer must check rather than assume** — each is flagged inline at its step: `logger`'s available levels (Task 3), `config`'s library-name key (Task 8), the harness `execute` signature (Task 9), `Card`'s props and `useToast`'s shape (Task 10), and whether `root-auth.test.ts` demands a field-level scope on the new mutation (Task 9).
