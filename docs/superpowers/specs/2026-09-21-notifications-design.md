# Notification preferences and triggers — design

## Context

This is **Spec 2** of the two named in
`2026-09-19-email-identity-design.md`. Spec 1 built an addressable, verified
identity — an address on every account, verification, login by email,
forgot/reset, the `Mailer` transport seam, and a `users` row for the config
admin — and explicitly deferred "the per-action opt-in matrix and the events
that fire it" to this spec.

Spec 1 also promised two seams for this one to consume. `Mailer` exists and is
in use. **`notify()` does not exist** — nothing in `app/server` references it —
so this spec builds it rather than inheriting it.

Three notifications ship:

| Event | Recipient | Trigger |
| --- | --- | --- |
| `book_request.created` | the admin | a reader asks for a book |
| `book_request.fulfilled` | the requester | the admin links a book to the request |
| `book_request.declined` | the requester | the admin turns the request down |

Email is the only channel. Web push is out of scope and the design is audited
against it below, because "does this survive a second channel?" is the question
that decides most of the shape here.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Preference model | A `(userId, event, channel)` matrix, built now | The shape Spec 1 promised. A second channel is rows plus a driver, with no migration of the preference model. |
| Default state | Absent row means **enabled**; rows record opt-outs | The admin is notified of the first request without visiting settings, and no existing account needs a backfill. |
| Delivery | A durable outbox table drained by a background worker | A request that exists but whose notification was never queued is the failure this buys out. Survives restarts and retries properly. |
| Enqueue | A row written **inside the triggering transaction** | The only way the durability above is worth paying for. An enqueue that can be lost between the status change and the queue defeats the whole table. |
| Event granularity | Three events, not two | The reader can mute a decline while keeping the good news, and the three mails we would write anyway each get their own toggle. |
| Recipient address | Resolved at **send** time, not frozen at enqueue | Spec 1's rule — nothing goes to an unverified address — can only be true where it is checked, and a user who fixes a typo before the drain runs should get the mail. |
| Payload | Channel-neutral event data, rendered per channel at drain time | The invariant that makes web push additive. See "What web push inherits". |
| Mail unconfigured | The row is still written; the drain discards it | "The outbox records, the drain decides" is one rule. The alternative threads `isMailConfigured(config)` into three service signatures that hold no config today. |

Rejected, so they are not revisited by accident:

- **An in-memory queue.** Cheaper and it mirrors `ThumbnailQueue`, but mail
  queued at the moment of a restart is silently lost, and the admin never
  learns a request arrived.
- **A single global per-user on/off boolean.** One migration and one checkbox,
  but it is not the shape Spec 1 promised and would be migrated away the moment
  a fourth event exists.
- **Off-by-default opt-ins.** The quietest option, and the one where the feature
  looks broken: the admin misses every request until they happen to find the
  settings card.
- **One outbox row per destination.** Discussed under fan-out granularity below.
- **Digests or batching.** Ten requests means ten mails. Spec 1 already placed
  scheduling out of scope and nothing here changes that.

## Data model

Two new tables. Both are created by a **data migration that runs after
`data_v10_user_surrogate_id`**, with the generated Prisma DDL migration made a
no-op and commented — the pattern `data_v18_book_requests` and
`data_v19_user_email` already follow, for the reason recorded in trap 1 below.

```prisma
model NotificationPreference {
  userId  String  @map("user_id")
  event   String
  channel String
  enabled Boolean
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@id([userId, event, channel])
  @@map("notification_preferences")
}
```

The composite primary key IS the identity, so the mutation is a plain upsert.
An absent row and a row with `enabled: true` mean the same thing by
definition — re-enabling a toggle writes `true` rather than deleting the row,
which keeps the write idempotent and needs no delete path.

```prisma
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

  @@index([sentAt, nextAttemptAt])
  @@map("notification_outbox")
}
```

`userId` is the **recipient**, not the actor. There is no `email` column: the
address is read from the user row at send time (see the decision table), so a
row cannot outlive the address it names.

`payload` is JSON and is a **self-contained snapshot** — requester username,
title, author, note, decline reason. It deliberately does not reference the
`BookRequest` row. Deleting a request is a first-class action on both surfaces
(the reader withdraws a pending one, either party clears a resolved one), so the
row may well be gone before the drain runs, and a mail that re-read it would
fail exactly when it mattered.

`sentAt` and `failedAt` are both nullable and mutually exclusive: null/null is
pending, `sentAt` is delivered, `failedAt` is permanently given up. The index
covers the drain's only query — pending rows whose `nextAttemptAt` has passed.

## The `notify()` seam

```
enqueueNotification(tx, { event, subjectUserId, payload })
```

Takes a transaction client, because every caller has one and the whole point is
that the enqueue commits with the state change. It resolves three things:

**The recipient**, from an event registry that declares each event's audience as
`'admin' | 'subject'`. `book_request.created` is `'admin'` and resolves through
the `isConfigAdmin` row; the other two are `'subject'`, the requester. Keeping
this in the registry is why `services/book-request.ts` never learns that a
config admin exists.

**The channels**, currently the one-member list `['email']`. It does **not**
consult `config.mail` — the enqueue holds no config, by the decision above, and
a row destined for an install with no mailer is discarded by the drain. Whether
a channel is *configured* is asked in two other places, both of which have the
config to hand: the drain, which discards, and
`Viewer.notificationPreferences`, which omits an unconfigured channel from the
catalogue so the settings card never offers a toggle that cannot work.

**The preference**, per channel, at enqueue: a muted event is not queued at all,
so the outbox stays a record of things somebody actually wants. A user who mutes
*after* the enqueue and before the drain still gets that one mail, which is the
correct reading of a queue that has already accepted the message.

`NotificationEvent` and `NotificationChannel` are string unions
`satisfies`-checked against the GraphQL enums, exactly as
`BookRequestStatus` already is, so the two cannot drift.

## Delivery

A `NotificationQueue` class started from `index.ts`, shaped like
`ThumbnailQueue`: poked on enqueue, plus a 60-second timer wakeup so a
backed-off row is retried without needing a fresh enqueue to poke it, and
exposing `awaitIdle()` so tests drain deterministically instead of racing a
sleep.

It holds a **channel-to-driver map**, not a bare `Mailer`, from the first
commit — one entry today. For each due row it:

1. Reads the recipient's `email` and `emailVerifiedAt`. An unset or unverified
   address is **terminal**: `failedAt` is set with a reason, and nothing is
   retried, because no amount of retrying makes an unverified address sendable.
2. Renders the payload through that channel's renderer.
3. Sends, and classifies on the `SendFailure` union the mailer already returns.
   `invalid_destination` and `misconfigured` are terminal. `throttled` and
   `transient` increment `attempts` and set `nextAttemptAt` with exponential
   backoff — 1m, 5m, 25m, 2h, 10h — to a cap of **6 attempts** (one more than
   the five waits, since N attempts have only N-1 gaps between them), after
   which the row is terminal — a give-up horizon of roughly 12h31m of backoff.
   The schedule is deliberately long-tailed: the failures that reach it are a
   throttled API or an install whose network came back, and neither is fixed
   by retrying in seconds.
4. Prunes settled rows — `sentAt` or `failedAt` — older than 30 days.

A missing driver (mail unconfigured) discards the row at a debug log level
rather than recording a failure, so a LAN-only install generates no error noise
and the table stays bounded.

### `SendFailure` rename

`bad_address` becomes `invalid_destination`. Spec 1 declared `SendFailure` as
the contract every channel implements, and this member's semantic slot — "this
destination is permanently invalid, do not retry" — is exactly what a push
`410 Gone` needs; only the name was email-flavoured. Five references across
four files (`mailer.ts`, `mailer-cloudflare.ts`, a comment in `email.ts`, and
`mailer-cloudflare.test.ts`), so it is a mechanical rename done once rather
than a second name to reconcile later.

## Triggers

All three live **inside the services**, not in the GraphQL resolvers, so the
enqueue shares the transaction that commits the state change.

- **`createBookRequest`** enqueues inside its existing `$transaction`, on the
  `created` outcome only. A duplicate or a limit rejection is not an event.
- **`fulfillBookRequest`** enqueues inside its existing `$transaction`.
- **`declineBookRequest`** has no transaction today, and its doc comment
  specifically argues that the guarded `updateMany` is atomic *without* one. It
  gains a transaction wrapping that same guarded update plus the enqueue, and
  **the comment is rewritten** to record why the reason changed — a comment left
  arguing the opposite would be worse than no comment.

No self-notification case exists to suppress: the config admin cannot create a
request (`bookRequestCreate`'s `authScopes` refuses a viewer with no `sub`), and
fulfil and decline are always an admin acting on a reader's request.

## Templates

`mail-template.ts`'s `render()` is built around a code and a link, and a
notification has neither. It gains a sibling `notice()` renderer sharing
`escapeHtml`, and three messages:

| Event | Subject |
| --- | --- |
| `book_request.created` | `<username> requested a book on <library>` |
| `book_request.fulfilled` | `<title> has been added to your library` |
| `book_request.declined` | `Your request for <title> was declined` |

All three deep-link to `${publicUrl}/add/request` — the surface that serves both
the reader's own request list and the admin's queue — when `public_url` is
configured, and omit the link otherwise. Same convention as the two existing
mails, and for the same reason: no URL is ever synthesised from a request
header.

Pure functions of their arguments, like the existing two, so the tests read
them directly.

## GraphQL surface

Two enums, `NotificationEvent` (`BOOK_REQUEST_CREATED`,
`BOOK_REQUEST_FULFILLED`, `BOOK_REQUEST_DECLINED`) and
`NotificationChannel` (`EMAIL`), whose SCREAMING_CASE members map onto the
stored lowercase strings.

`Viewer.notificationPreferences` returns the **(event x configured-channel)
cross-product with effective state merged over stored rows**, filtered to the
viewer's audience — the admin sees only `BOOK_REQUEST_CREATED`, a reader sees
only the two outcome events. Audience rules live on the server and the client
renders what it is handed; a client that knew the rules would be a second place
for them to drift.

`viewerSetNotificationPreference(event, channel, enabled)` upserts on the
composite key and returns the updated preference list. Authenticated, and it
resolves the viewer's own id through `resolveViewerUserId` (which handles the
admin row), so there is no path to writing another account's preferences.

## Client

A `component/notification-settings/` card on `/user`, below `EmailSetting`,
rendering **from the server's returned list grouped by event** rather than
hardcoding three toggles — so a second channel becomes a column instead of a
rewrite. Three states:

- Mail unconfigured: the card does not render at all, matching how the rest of
  the email UI disappears on a LAN-only install.
- Address unset or unverified: toggles render **disabled**, with a line
  pointing at the email card above. An unverified address receives nothing, so
  live toggles would be a lie.
- Verified: toggles live, optimistic, reverting on error.

## Testing

- **Services**: the enqueue lands in the same transaction — a rolled-back
  create leaves no outbox row, which is the regression the durable option
  exists to prevent; preference resolution across absent, `true` and `false`
  rows; audience resolution, including the admin row being absent (the
  `ensureAdminUser` collision case) degrading to no notification rather than
  throwing.
- **Drain**: `invalid_destination` and `misconfigured` terminal; `transient`
  retried with backoff to the cap and then terminal; an unverified recipient
  terminal without a send attempt; pruning at 30 days; a missing driver
  discarding quietly.
- **Templates**: three pure-function tests, plus the `publicUrl`-absent arm.
- **GraphQL**: the audience filter (an admin viewer and a reader viewer see
  disjoint catalogues), the mutation's upsert and its authz, and
  `root-auth.test.ts` staying green on the new root field.
- **Migration**: `migrate.test.ts` — `data_v20` is idempotent, runs after
  `data_v10`, and the tables still exist on a database that starts pre-v10.
- **Client**: the card's three states, and that a mail-disabled install renders
  no card.
- **Schema**: `npm run graphql:schema` regenerated, `graphql:schema:check`
  clean, client codegen re-run.

## What web push inherits

- **The preference matrix** is already channel-keyed. Push is rows plus a
  driver — no migration.
- **The payload is channel-neutral event data, rendered at drain time.** This is
  the load-bearing invariant. The tempting shortcut — rendering a `MailMessage`
  at enqueue and storing that — is cheaper today and would make push a
  migration of every queued row. Push adds a `push-template.ts` producing a
  `PushMessage`, and the drain's message type becomes a per-driver generic.
- **The channel-to-driver map** exists from the first commit, so adding a driver
  is an entry rather than a refactor of the drain.
- **`SendFailure`** is channel-neutral after the rename above; a push
  `410 Gone` is `invalid_destination`.
- **Defaults**: a newly added channel is enabled-by-default under the
  absent-row rule, which is self-limiting for push — a user with no
  subscription receives nothing, and subscribing a browser is itself the opt-in.

### Fan-out granularity — the accepted cost

Email is one address per user; push is N subscriptions per user. An outbox row
is per `(user, event, channel)`, so a driver sending to three subscriptions
where one fails transiently can only retry the whole row, re-pushing to the two
that succeeded.

One row per destination was rejected. Push subscription lifecycle needs its own
state regardless — a `410 Gone` means prune that endpoint permanently, which is
not a retry and does not belong in a retry counter — so it belongs in the
subscription table, and the outbox stays "notify this user by this channel".
Duplicate suppression is then the driver's problem, where it holds the
subscription rows to solve it with.

## Out of scope

Web push itself (drivers, VAPID config, a subscription table, a service
worker); digests, batching or scheduling; an admin-visible delivery log or any
UI over the outbox; notifications for any event outside book requests,
including a reader withdrawing a pending request; and any change to the
existing in-app nav badge, which keeps working exactly as it does today.

## Known traps

1. `data_v10_user_surrogate_id` rebuilds `users` from an explicit column list,
   so anything the DDL pass adds to that table is dropped on its way in. Both
   new tables carry a foreign key to `users`, so `data_v20_notifications` must
   run after it and the generated Prisma DDL migration
   (`20260921000000_add_notifications`) must be a commented no-op — the same
   treatment `data_v18` and `data_v19` document.
2. `runDataMigration` records the migration name only **after** its body
   resolves, so a body that fails halfway runs again on the next boot. Every
   statement in `data_v20` is `CREATE TABLE IF NOT EXISTS` /
   `CREATE INDEX IF NOT EXISTS` for that reason.
3. `declineBookRequest`'s doc comment currently argues that it is atomic
   *without* a transaction. Adding one and leaving that comment is worse than
   leaving no comment.
4. The outbox's `payload` must never hold a rendered message. See "What web
   push inherits".
5. `bookRequestCreate` refuses the config admin through `authScopes`, so the
   admin is never a requester. Any future code that notifies "the requester"
   should not defend against the admin being one; it should rely on that scope.
