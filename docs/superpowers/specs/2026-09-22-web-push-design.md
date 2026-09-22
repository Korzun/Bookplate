# Web push — design

Date: 2026-09-22
Status: approved design, not yet planned

## Context

`2026-09-21-notifications-design.md` shipped the channel-blind half of
notifications — an event registry, a `(userId, event, channel)` preference
matrix, a durable outbox, and a drain that "names no channel" — with email as
its only driver. Its closing section, "What web push inherits", listed what it
deliberately built for this spec and did not use:

- The preference matrix is already channel-keyed, so push is rows, not a
  migration.
- `NotificationOutbox.payload` holds channel-neutral event data and is rendered
  **at drain time**, so a second channel does not have to migrate queued rows.
- `NotificationQueue` takes a `channel → driver` map, one entry today.
- `ChannelDriver` is shaped around a `NotificationRecipient` rather than an
  address, explicitly because "web push resolves a user to N subscription
  endpoints and has no notion of a verified address at all".
- `SendFailure.bad_address` was renamed `invalid_destination` in that spec for
  the sole purpose of letting a push `410 Gone` reuse the slot.

This spec consumes all five. Nothing in `services/notification.ts`,
`services/notification-queue.ts` or `services/notification-channel-email.ts`
changes shape; the queue gains exactly one new branch, for the reason recorded
under "The `no_destination` addition" below.

The same three events ship on the new channel, with no fourth event:

| Event | Recipient |
| --- | --- |
| `book_request.created` | the admin |
| `book_request.fulfilled` | the requester |
| `book_request.declined` | the requester |

### The constraint that shapes the client half

Web Push requires a **secure context**. Browsers expose neither
`ServiceWorker` nor `PushManager` on a page served over plain HTTP, so a
Bookplate reached at `http://homeassistant.local:3000` cannot subscribe at all
— not because of anything this spec does, and not fixable by anything it could
do. On iOS the bar is higher still: push is only permitted from a PWA added to
the Home Screen. `site.webmanifest` already declares `display: standalone` with
maskable icons, so that install path works today; what is missing is a service
worker, which is the other thing push requires.

Notably, push does **not** need `public_url`. The service worker is same-origin
and its click target is a relative path, so unlike the three notification mails
— which omit their link entirely when `public_url` is unset — a push
notification is fully useful on an install that never configured one.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Availability | Feature-detected client-side; no operator config | Works for anyone reaching Bookplate over HTTPS by any route (Nabu Casa, a reverse proxy, Tailscale), including routes the operator never told Bookplate about. Gating on `public_url` would hide push from exactly those users. |
| VAPID keys | Generated on first boot, stored in `settings` | `getOrCreateJwtSecret` is the precedent, down to the upsert that makes concurrent first boots converge. No `config.yaml` option, no README row, no key for an operator to lose. |
| Service worker | Push handlers only; no `fetch` handler | A worker that never intercepts requests cannot serve a stale bundle, needs no cache-versioning story, and cannot break a release. Offline precaching is named as a follow-up, not smuggled in here. |
| Push crypto | The `web-push` package | Crypto is the worst place to carry a bug findable only on a real device. RFC 8291 encryption and RFC 8292 signing behind one focused dependency, whose HTTP status maps cleanly onto the existing `SendFailure` union. |
| Per-device vs per-event | A device switch **and** an account-wide push column | Subscribing a browser and muting an event are different questions. Collapsing them would abandon the `(userId, event, channel)` matrix for push and have to be migrated back the first time someone wants declines muted on push but not email. |
| Device visibility | A list of subscribed browsers, with remove | Lets a lost or retired device be revoked without visiting it. The driver's `410` pruning only reaps endpoints the push service already considers dead. |
| Unreachable recipient | A new `SendFailure` member, `no_destination`, discarded by the drain | Push is enabled-by-default under the absent-row rule, so a user who never subscribed would otherwise bank a permanently-failed outbox row per notification. See below. |
| Subscription re-sync | On app load, not via `pushsubscriptionchange` | The worker holds no access token and could not authenticate the mutation. Load-time re-sync covers the same ground without inventing an unauthenticated endpoint. |

Rejected, so they are not revisited by accident:

- **Gating push on `public_url` being `https://`.** One switch an operator
  controls, but `public_url` is optional and names only one of the routes a
  user may arrive by. A reader on Nabu Casa would be told push is unavailable
  while their browser was perfectly capable of it.
- **Hand-rolling RFC 8291 with `node:crypto`.** In character with
  `mailer-cloudflare.ts`, which is a hand-rolled REST call rather than an SDK,
  and genuinely testable against the RFC's published vectors. Rejected because
  a REST call fails loudly and ECDH/HKDF/AES-GCM fails as a notification that
  silently never arrives on one browser family.
- **A caching service worker in this spec.** Offline reading is a real feature
  and would dominate this one — a `fetch` handler sits in front of every
  request including EPUB downloads, and brings its own stale-bundle and
  cache-invalidation failure modes.
- **One outbox row per subscription.** Already rejected by the previous spec,
  under "Fan-out granularity — the accepted cost", and nothing here changes
  the reasoning: endpoint lifecycle is not a retry counter.
- **Handling `pushsubscriptionchange` in the worker.** Patchy support, and the
  worker cannot authenticate. It would need a new endpoint that accepts a
  subscription swap without a session, which is a worse trade than a stale row
  that the next app load fixes.
- **User-editable device labels.** A text field, a mutation and a validation
  rule for something nobody renames.

## Data model

One new table, created by a **data migration that runs after
`data_v10_user_surrogate_id`** with the generated Prisma DDL migration made a
commented no-op — the treatment `data_v18`, `data_v19` and `data_v20` already
document, for the reason in trap 1 below.

```prisma
model PushSubscription {
  id            String  @id
  userId        String  @map("user_id")
  endpoint      String  @unique
  p256dh        String
  auth          String
  label         String
  createdAt     Float   @map("created_at")
  lastSuccessAt Float?  @map("last_success_at")
  user          User    @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@index([userId])
  @@map("push_subscriptions")
}
```

`endpoint` is unique **globally, not per user**, and that is the point: a
browser has one push subscription for the origin, so the same endpoint
arriving under a second account means the browser changed hands. The upsert
re-binds `userId` rather than creating a second row, which is what stops a
shared browser from receiving two accounts' notifications.

`p256dh` and `auth` are the subscription's own public key and shared secret,
stored as the browser produced them (base64url). They are what the payload is
encrypted to; without them the endpoint is useless, and with them no server
other than this one can send to it.

`lastSuccessAt` is nullable and is written only on a confirmed delivery, so
"never worked" and "worked once and has been quiet since" are distinguishable
in the device list.

### VAPID keys

`services/push-keys.ts` exposes `getOrCreateVapidKeys(prisma)`, storing
`vapid_public_key` and `vapid_private_key` in the existing `settings` table.
It mirrors `getOrCreateJwtSecret` exactly, including the
`upsert({ create, update: {} })` whose empty update makes two concurrent first
boots converge on the first writer's pair rather than each minting one.

Nothing rotates them. Rotating VAPID keys invalidates every existing
subscription on every device at once, which is a support incident, not a
maintenance task; if it is ever needed it is an explicit operator action with
its own design, not a timer.

## The channel

`NotificationChannel` gains `'push'` and `NOTIFICATION_CHANNELS` becomes
`['email', 'push']`. `enqueueNotification`'s existing per-channel loop then
writes up to two rows per event **with no change to that function** — which is
the whole return on the previous spec having built the matrix channel-keyed.

`services/notification-channel-push.ts` becomes the second file that knows what
a channel is, and `services/push-template.ts` its renderer, turning the
channel-neutral `NotificationPayload` into:

```
type PushMessage = { title: string; body: string; url: string; tag: string }
```

Pure functions of their arguments, like `mail-template.ts`'s five, so the tests
read them directly.

### Payload size

Web Push caps the **encrypted** payload at roughly 4KB, and
`BookRequest.note` plus a long title can approach it. `push-template.ts`
truncates `body` to a fixed character budget with an ellipsis. The full detail
is one tap away behind the click-through, which is where a phone notification
wants it regardless.

This is a hard limit imposed by the push services, not a style choice: a payload
over the cap is rejected outright, so the truncation is load-bearing.

### `tag`, and the duplicate it absorbs

`NotificationQueue`'s header states plainly that delivery is **at-least-once**:
a crash between a successful `deliver()` and the `sentAt` write that records it
leaves the row pending, and it is sent again. For email that produces a
duplicate message in an inbox, accepted as the price of never losing one.

Push has a lever email does not. Setting `tag` from the event plus the request
title means a re-delivered duplicate **replaces** the visible notification
rather than stacking beside it, so the outbox's accepted cost is invisible on
this channel. The tag is deliberately not the outbox row id, which would be
unique per delivery and collapse nothing.

### Fan-out rules

The driver loads the recipient's subscriptions and posts to each, classifying
per endpoint:

| Push service response | Per-endpoint handling |
| --- | --- |
| `201` / `200` | success; write `lastSuccessAt` |
| `404` / `410 Gone` | **delete that subscription row**; not a failure of the send |
| `429` | `throttled` |
| `5xx`, network error | `transient` |
| `400` / `401` / `403` / `413` | `misconfigured`; **keep the subscription row** |

A dead endpoint is subscription lifecycle, not a retry — the previous spec's
reasoning for keeping endpoint state out of the outbox's retry counter — so
pruning it is a write to `push_subscriptions` and contributes nothing to the
outbox row's verdict.

The last row is the one that is easy to get wrong. `400`, `401` and `403` mean
the *sender* is wrong — a malformed request, or VAPID credentials the push
service rejected — and `413` means the payload exceeded the cap. None of them
says anything about the subscription, so deleting the row on a `4xx` would let
one server-side mistake silently destroy every valid subscription on the
install, which is unrecoverable: the user would have to re-enable push on each
device. Only `404` and `410`, the two codes that mean "this endpoint is gone",
delete anything.

It then aggregates to the one `SendResult` the outbox row needs, in this order:

1. **Any endpoint `transient` or `throttled`** → return that reason, so the row
   retries on the existing backoff. Devices that already succeeded will be
   pushed again on that retry, and the `tag` above means the user sees a
   replacement rather than a second notification. This is the trade the
   previous spec named and accepted; not losing the third device's
   notification is worth re-sending to the two that worked.
2. **Otherwise, at least one success** → `{ ok: true }`.
3. **Otherwise, any `misconfigured`** → `{ ok: false, reason: 'misconfigured' }`,
   which the queue's existing `TERMINAL` list already buries with the reason
   recorded. It sits below success rather than above it because the causes are
   install-wide by construction — the same VAPID keys and the same payload go
   to every endpoint — so a `401` alongside a success cannot happen, and
   ordering it here means a partial success is never buried. Each one is logged
   per endpoint regardless, so an operator sees it.
4. **Otherwise** (no subscriptions at all, or every one pruned) →
   `{ ok: false, reason: 'no_destination' }`.

### The `no_destination` addition

The one change to a contract that already exists, and it earns itself.

Push is enabled-by-default under the absent-row rule — the previous spec called
this "self-limiting for push", because a user with no subscription receives
nothing. That is true of delivery and false of the table: every notification for
such a user would write a push outbox row, fail permanently, and sit with
`failedAt` set until the 30-day prune. An admin who never enables push would
accumulate one buried row per book request, and a log line for each.

`SendFailure` gains `no_destination`, and `NotificationQueue` treats it exactly
as it already treats a missing driver — delete the row, log at debug — rather
than recording a failure. The queue's existing `TERMINAL` list is untouched;
this is a third branch beside the missing-driver and missing-recipient ones it
already has, all three of which mean "this row can never be delivered and that
is not an error".

The email driver never returns it: an address that is unset or unverified is
`invalid_destination`, which is a *refusal* worth recording, not an absence.

## GraphQL surface

`NotificationChannel` gains `PUSH`, mapping onto the stored `'push'` exactly as
`EMAIL` does.

`Viewer.notificationPreferences` changes its `channels` argument. Today:

```ts
channels: isMailConfigured(context.config) ? NOTIFICATION_CHANNELS : [],
```

Push requires no server configuration, so it is always offered and email is
conditional:

```ts
channels: [...(isMailConfigured(context.config) ? (['email'] as const) : []), 'push'],
```

Whether the *browser* can act on it is a client-side question, per the
availability decision — the server has no way to know how a given user reached
it, and guessing from a request header is the same mistake `public_url` exists
to avoid.

New fields and mutations:

- `Viewer.pushPublicKey: String!` — the VAPID public key, base64url. Not a
  secret; the browser cannot subscribe without it.
- `Viewer.pushSubscriptions: [PushSubscription!]!` — `id`, `label`,
  `createdAt`, `lastSuccessAt`.
- `viewerAddPushSubscription(endpoint, p256dh, auth, label)` — upserts on
  `endpoint`, binding it to the viewer's own id through `resolveViewerUserId`
  (which handles the admin row), and returns the row.
- `viewerRemovePushSubscription(id)` — deletes only a row owned by the viewer.

**`PushSubscription` never exposes `endpoint`.** A push endpoint is a bearer
capability URL: anyone holding it plus the keys can send to that device, and
anyone holding it alone can send empty pings. It is written by the client, read
by the driver, and returned to nobody. The add mutation returns the row's `id`,
which the client stores locally to mark which entry in the device list is the
browser being looked at — the reason `removePushSubscription` takes an `id`
rather than an endpoint.

## Client

### The service worker

`app/client/public/sw.js`, plain JavaScript copied verbatim by Vite's `public/`
handling — in the build and by the dev server, so `localhost` development is a
secure context and push works end to end without a tunnel.

Two handlers:

- `push` — parse the JSON payload, `showNotification(title, { body, tag, data: { url } })`.
- `notificationclick` — focus an already-open Bookplate client if there is one,
  otherwise `openWindow(url)`.

No `fetch` handler. A header comment records that offline precaching is the
deferred follow-up and that adding it means adding a handler here, so the file
is found rather than reinvented.

**No server routing change is needed, and this was checked rather than
assumed.** `routes/ui.ts` mounts `express.static(CLIENT_DIST_DIR, { index: false })`
— explicitly unauthenticated, explicitly ahead of the `router.get('*', serveSpa)`
catch-all — and Vite copies `public/` into the build root, which is already how
`site.webmanifest` and `favicon.ico` are served. `/sw.js` lands in the same
place and is served the same way.

What this buys is worth naming, because the failure it avoids is invisible: a
service worker served as `index.html` registers *successfully* and then never
fires, presenting as push being silently broken with no error anywhere. The
implementation's job here is to **verify** that `/sw.js` returns JavaScript,
not to add a route.

### Registration and lifecycle

`lib/push.ts` owns everything the rest of the client should not know:

- **Support**, as `'serviceWorker' in navigator && 'PushManager' in window && window.isSecureContext`.
- **Subscribe** — request permission, register the worker, `pushManager.subscribe`
  with `applicationServerKey` from `Viewer.pushPublicKey`, then the add
  mutation. Permission is requested **only** from an explicit switch click.
  Prompting on load is penalised by browsers and a `denied` result is not
  programmatically recoverable, so the one chance to ask is spent on a click
  that asked for it.
- **Unsubscribe** — `subscription.unsubscribe()` then the remove mutation.
- **Re-sync on load** — if permission is `granted` and `getSubscription()`
  returns one, re-run the add mutation. It upserts, so this is idempotent.
  Endpoints rotate, and a subscription whose server row was pruned by a `410`
  race would otherwise be a browser that believes it is subscribed and a server
  that has never heard of it.
- **Unsubscribe on logout** — otherwise a shared browser keeps delivering the
  previous account's book-request notifications to whoever signs in next.

### The settings card

`component/notification-settings/` gains three pieces around the existing
matrix, which is already rendered grouped-by-event from the server's list and
therefore needs no structural change to grow a column.

1. **"Enable push on this device"**, above the matrix, with honest disabled
   states: *"Push needs an HTTPS connection"* where the APIs are absent, and
   *"Notifications are blocked for this site in your browser settings"* on
   `denied`, since nothing the app does can undo that.
2. **A `PUSH` column** in the matrix — data, not layout.
3. **The device list**, below: label, last used, remove; the entry whose `id`
   matches the locally-stored one marked as this device.

Two existing behaviours change to make room, both of which are email
assumptions that stopped being true the moment a second channel existed:

- The card currently does not render at all when mail is unconfigured. It
  becomes "render when the server returns a non-empty catalogue" — a LAN-only
  install with no mail can still do push over a tunnel.
- The `emailVerified` prop currently disables **every** toggle. That gating
  becomes per-channel: an unverified address says nothing about whether push
  works, and disabling a live push toggle because of it would be the same
  category of lie the unverified-email disabling exists to prevent.

**Labels** are derived client-side from the user agent — "Chrome on macOS" —
and sent with the add mutation.

## Privacy

Worth stating plainly in a self-hosted app rather than leaving to be
discovered. The payload is encrypted to the subscription's own keys, so the
push service — Google, Mozilla or Apple, depending on the browser — relays a
blob it cannot read. It does see that a message was sent to that endpoint and
when, which is metadata this project cannot eliminate while using Web Push at
all; it is inherent to the standard, not to this implementation.

An install with no outbound internet is self-limiting rather than noisy: a
browser that cannot reach the push service cannot subscribe in the first
place, so there are no subscription rows, so the driver returns
`no_destination` and the drain discards. No backlog, no retries, no log spam.

Request headers sent with every push: `TTL` of three days, so a phone that was
off for a week does not surface a stale "your book was added"; `Urgency:
normal`.

## Testing

- **`push-keys`**: generated once and reused; two concurrent first calls
  converge on one pair.
- **`push-template`**: pure-function tests per event, plus the truncation arm
  at the size budget.
- **Driver**: per-endpoint classification for `201`, `410`, `429`, `5xx` and
  `401`; that a `410` deletes the subscription row and does not by itself fail
  the send; that a `401` does **not** delete it (the regression that would cost
  every user their subscriptions); `lastSuccessAt` written only on success; and
  the four aggregate rules — a transient among successes returns transient, any
  success with no transient returns ok, a `misconfigured` with no success
  returns misconfigured, no live endpoints returns `no_destination`.
- **Queue**: `no_destination` deletes the row and records no failure, next to
  the existing missing-driver test.
- **Enqueue**: two outbox rows when both channels are enabled, one when push is
  muted, still one when mail is unconfigured (the drain, not the enqueue,
  decides — the existing rule).
- **GraphQL**: `pushSubscriptions` never returns an endpoint; remove refuses
  another user's row; add re-binds an endpoint that arrives under a second
  account rather than duplicating it; `root-auth.test.ts` stays green on the
  new root fields.
- **Migration** (`migrate.test.ts`): `data_v21` is idempotent, runs after
  `data_v10`, and the table exists on a database that starts pre-v10.
- **Client**: `lib/push` support-detection branches; the card's unsupported,
  denied and granted states; the card rendering when mail is unconfigured;
  push toggles staying live with an unverified address; logout unsubscribing.
- **`sw.js`**: loaded with a mocked `self` and its two handlers asserted. It is
  outside the Vite module graph, which is a reason to test it deliberately, not
  a reason to leave the only new runtime file uncovered.
- **Schema**: `npm run graphql:schema` regenerated and `graphql:schema:check`
  clean; client codegen re-run.

## Out of scope

Offline precaching and any `fetch` handler (the named follow-up); any event
beyond the three book-request ones; digests, batching or scheduling; an
admin-visible view of the outbox; user-editable device labels; VAPID key
rotation; push to KOReader or OPDS clients; and the in-app nav badge, which
keeps working exactly as it does today.

## Known traps

1. `data_v10_user_surrogate_id` rebuilds `users` from an explicit column list,
   so `data_v21_push_subscriptions` must run after it and the generated DDL
   migration must be a commented no-op — `push_subscriptions` carries a foreign
   key to `users`.
2. `runDataMigration` records the migration name only **after** its body
   resolves, so every statement must be `CREATE TABLE IF NOT EXISTS` /
   `CREATE INDEX IF NOT EXISTS`.
3. `/sw.js` must be reached by `express.static` and not by `routes/ui.ts`'s
   `router.get('*', serveSpa)` fallback. It already is — `public/` is copied to
   the build root and static is mounted first — so this is a thing to assert in
   a test, not to build. Served as `index.html` a worker registers without
   error and never fires, which is why it is worth an explicit assertion.
4. The service worker's scope is its serving path. At `/sw.js` the scope is
   `/`, which is what the manifest already declares; moving it into a
   subdirectory silently narrows the scope.
5. `endpoint` is globally unique on purpose. A per-user unique key would let one
   browser hold subscriptions for two accounts and deliver both.
6. The 4KB cap is on the **encrypted** payload, which is larger than the JSON
   it came from. The truncation budget must leave headroom, not sit at 4096.
7. `web-push` (3.6.7) goes in `app/server`'s dependencies and therefore into the
   add-on image. It is pure JavaScript with no install or postinstall script,
   so it needs no `allowScripts` entry in the root `package.json` — unlike
   `argon2`, `better-sqlite3` and the Prisma engines, which do.
8. Permission can only be requested from a user gesture, and `denied` is
   permanent until the user clears it in browser settings. Any code path that
   could prompt on load would burn that one chance.
