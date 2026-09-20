# Email identity: addresses, verification, email login, password reset

Date: 2026-09-19
Status: approved design, not yet planned

## Context

Bookplate is a self-hosted Home Assistant add-on. It has no notion of email
anywhere today: `User` carries `username`, `passwordHash`, `syncPassword` and
`mustChangePassword`, and nothing else. The eventual goal is user-configurable
notifications (email now, web push later), but that needs an addressable,
verified identity first — which is what this spec builds.

This is the first of two specs landing in the `notifications` worktree:

1. **This spec — email identity.** An address on every account, verification,
   login by email, forgot/reset, the mail transport, and an admin account row.
2. **Next spec — notification preferences and triggers.** The per-action opt-in
   matrix and the events that fire it.

Spec 1 builds two seams that Spec 2 and web push consume, and implements
neither: the `Mailer` channel interface, and a single `notify()` fan-out point.

### The two constraints that shape everything

**The admin is not a database row.** `config.username` / `config.password` come
from the add-on options (`/data/options.json`, `config.ts`), and `/api/login`
compares against them directly before it ever touches Prisma.
`RefreshToken.userId` is explicitly nullable "for the config-based admin", and
`AuthUser.userId` is absent for them. An account with no row has nowhere to hang
an address, a verified flag, or preferences.

**Every install needs its own sending identity.** Cloudflare Email Service
(Email Sending, public beta since 2026-04-16) sends via
`POST https://api.cloudflare.com/client/v4/accounts/{account_id}/email/sending/send`
with a bearer token, and requires an account ID, an API token with
**Email Sending: Edit**, and a *verified sending domain*. There is no central
Bookplate mail infrastructure and this spec does not create one.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Transport | A narrow `Mailer` seam with exactly one driver (Cloudflare REST) | A second driver (SMTP, web push) is additive; the seam is also where the test double lives. |
| Admin identity | A `users` row exists for the config admin; add-on options still own the password | One uniform home for address/verification/preferences, without touching credential precedence. |
| Address required? | Required for every account | Clean invariant for notifications; enforced at the login boundary, not in the schema. |
| Unverified address | Login allowed; verified gates all outbound mail | Nothing is emailed to an unverified address except its own verification. Reset refuses until verified, so a typo'd or someone else's address is never an account-takeover path. |
| Delivery route | Typed code always; link too when `public_url` is set | The code path has to exist for LAN-only installs anyway, so the link is a thin convenience over the same token. No host-header-derived URLs. |
| Credentials | Add-on options plus env-var fallbacks | Matches every other knob in the app; no live API token in the app's SQLite. |
| Backfill | Set-email gate at login, for everyone including the admin | One mechanism, mirroring `mustChangePassword`. No pre-seeded placeholder addresses. |
| Mail unconfigured | The gate does not fire at all | An upgrade is invisible to installs that never configure mail. "Required" holds exactly where it means something. |

Rejected, and why, so they are not revisited by accident:

- **A hosted relay on Bookplate's own Cloudflare account.** Removes all user
  friction, but makes the project an email operator handling other people's
  addresses, with the abuse, deliverability and privacy consequences that
  implies.
- **Links built from the request `Host` header.** Zero-config, and the classic
  host-header injection path: an attacker's request produces a reset link
  pointing at their own server.
- **Reset to an unverified address.** Whoever owns a mistyped inbox could seize
  the account.
- **A skippable set-email screen.** A skippable requirement is not one; it buys
  the branching of optional plus the code of required.

## Data model

### `User` additions

| Column | Type | Purpose |
| --- | --- | --- |
| `email` | `String?` | The address as entered. Display and send target. |
| `emailKey` | `String?` `@unique` | Trimmed + lowercased. **Every lookup goes through this**, so uniqueness is case-insensitive without an expression index Prisma cannot model. Same derived-key convention as `titleSort`, `sortKey`, `dedupeKey`. |
| `emailVerifiedAt` | `Float?` | Ms-epoch, matching every other timestamp in this schema. A timestamp rather than a boolean answers "when" for free. |
| `isConfigAdmin` | `Boolean @default(false)` | Marks the row that mirrors the add-on options admin. Two jobs: user-listing surfaces exclude it, and `ensureAdminUser` uses it to rename the row when `config.username` changes instead of orphaning it. |

The columns are nullable even though an address is required. **"Required" is a
policy enforced at the login boundary**, exactly as `mustChangePassword` is. The
nullable `@unique` on `emailKey` is load-bearing: SQLite permits any number of
`NULL`s in a unique index, which is what lets every pre-upgrade row coexist
without a placeholder address.

There is deliberately **no `mustSetEmail` column**: it is derived as
`email == null && config.mail != null`, so it cannot drift from the
configuration. There is deliberately **no pending-address column**: changing an
address replaces the live one immediately and lands unverified. The only cost is
that notifications pause and reset is refused until confirmed, and the user is
signed in and able to correct a typo.

### New `EmailToken` table

```prisma
model EmailToken {
  userId    String @map("user_id")
  purpose   String            // 'verify' | 'reset'
  tokenHash String @map("token_hash")   // sha256; the plaintext is never stored
  email     String            // the address it was sent to
  expiresAt Float  @map("expires_at")
  createdAt Float  @map("created_at")
  sentAt    Float  @map("sent_at")
  sendCount Int    @default(1) @map("send_count")
  user      User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, purpose])
  @@index([expiresAt])
  @@map("email_tokens")
}
```

The primary key is `(userId, purpose)`, **not** `tokenHash`, and the hash is
therefore not a lookup key at all: every consumption path already knows which
account it is acting on (confirm is authenticated; reset submits the address
alongside the code). Three consequences, all wanted:

- A guessed code is worthless without the matching account.
- "Resend" is an upsert that invalidates the previous code, instead of leaving a
  pile of live ones.
- `sentAt` / `sendCount` give a 60-second cooldown and a 5-sends-per-token cap
  with no extra bookkeeping.

Storing `email` means a reset token stops working the moment the account's
address changes. Consumption is a single `DELETE ... RETURNING`, the same atomic
one-winner mechanic `consumeRefreshToken` uses.

One token value serves both delivery routes: an 8-character Crockford-base32
code (~40 bits), which the link carries as `?code=`.

### Migration: `data_v19_user_email`

**These changes go in a data migration in `db/migrate.ts`, not a DDL migration
directory.** `data_v10_user_surrogate_id` rebuilds `users` through a `users_new`
table with an explicit column list, so a column added during the DDL pass —
which runs first — is silently dropped when v10 later runs on an older
database. `pending_fixes`, `validations` and `book_requests` all avoid this the
same way; `20260830000000_add_book_requests/migration.sql` is a documented
`SELECT 1;` no-op for exactly this reason.

The migration is idempotent (`ALTER TABLE ... ADD COLUMN` guarded by a
`PRAGMA table_info` check, `CREATE TABLE IF NOT EXISTS`), like its neighbours.
A DDL directory is still created —
`prisma/migrations/20260919000000_add_user_email/migration.sql` — containing
`SELECT 1;` and the explanation above, exactly as its three precedents do, so the
migration history records the change where a reader expects to find it.

`deleteExpired` (`services/token.ts`) gains an `email_tokens` sweep.

## Mail layer

Three modules, so the transport is swappable and everything above it is
testable without a network.

**`services/mailer.ts`** — the seam.

```ts
export type MailMessage = { to: string; subject: string; text: string; html: string };
export type SendResult = { ok: true } | { ok: false; reason: 'bad_address' | 'throttled' | 'misconfigured' | 'transient' };
export type Mailer = { send(msg: MailMessage): Promise<SendResult> };
export function createMailer(mail: MailConfig | null): Mailer | null;
```

`createMailer` returns `null` when mail is unconfigured, so "is mail configured?"
is one predicate with one answer, resolved once at boot, rather than a
credential check scattered across call sites.

**`services/mailer-cloudflare.ts`** — the only driver. Global `fetch`, so **no
new dependency**. It classifies rather than passes through:

| Response | `reason` | Handling |
| --- | --- | --- |
| `200`, address in `permanent_bounces` | `bad_address` | Surfaced to the user as an invalid address; worth recording, it is not a transport fault. |
| `401` / `403` | `misconfigured` | Operator error. Logged loudly, **once per process**, so a bad token cannot flood the log. |
| `429` | `throttled` | Surfaced as "try again shortly". |
| other `5xx`, network error | `transient` | Generic failure; the resend button is the retry. |

**`services/mail-template.ts`** — the verify and reset messages. `text` is
always populated and `html` is a lightly styled rendering of the same words.
Both carry the code; the link appears only when `public_url` is set.

**No queue and no retry in v1.** Both messages are user-initiated and the
resend button *is* the retry; a queue with one synchronous producer would be
machinery serving nothing. Spec 2's fan-out is where retry belongs, behind
`notify()`, not inside the mailer.

### Configuration

Resolved once in `loadConfig()` into `config.mail: MailConfig | null`. Env var
wins over the add-on option, the existing convention.

| Add-on option (`str?`) | Env var | Notes |
| --- | --- | --- |
| `email_cloudflare_account_id` | `CF_ACCOUNT_ID` | |
| `email_cloudflare_api_token` | `CF_API_TOKEN` | needs **Email Sending: Edit** |
| `email_from_address` | `EMAIL_FROM` | must be on a domain verified in that Cloudflare account |
| `email_from_name` | `EMAIL_FROM_NAME` | defaults to `library_name` |
| `public_url` | `PUBLIC_URL` | optional; links appear only when set |

Mail is on when account ID, token and from-address are all non-blank.
`public_url` is validated at load as `http(s)://host[:port]` and, on a malformed
value, falls back to code-only delivery with a warning rather than emitting a
broken link. `config.yaml` gains the five options and their schema entries;
`README.md` gains a row per option and an env-var row.

## Auth flows

### The admin row

`ensureAdminUser()` runs at boot (alongside the existing startup work in
`index.ts`) and upserts a row for `config.username` with `passwordHash: null`
and `isConfigAdmin: true`. If a row already carries `isConfigAdmin: true` under
a different username, it is **renamed** rather than duplicated, so changing
`username` in the add-on options keeps the admin's address and preferences.
A rename blocked by a username collision leaves the existing row alone and logs
a warning.

`/api/login` still compares `config.password` first, so **the credential never
leaves the add-on options**. Two consequences that must be implemented, not
assumed:

- **The admin's access token still carries no `sub`** (`AuthUser.userId` stays
  absent for them), so every existing path that reasons about ownership behaves
  exactly as it does today. The row is reached by `username` lookup, which is
  how `getMustChangePassword` already works. This row is identity-attached
  data; it is not a promotion to a normal user.
- **User-listing surfaces exclude `isConfigAdmin: true`.** The admin has never
  had a row, so `viewer.users` and the admin panel would otherwise start
  listing the admin as a reader with an empty library.

Because the password lives in the options, **password reset refuses the config
admin** (see below).

### Login by email

`POST /api/login`'s contract is unchanged; its `username` field becomes an
identifier. If the value contains `@`, resolve `emailKey` (trimmed, lowercased)
to a username and fall through to the existing logic untouched; otherwise it is
a username. The config-admin comparison still runs first, extended to also match
the admin's own address. Failures stay the generic `401`, so email login leaks
no more than username login does.

The login form's field is relabelled "Username or email" when mail is
configured.

### The set-email gate

Mirrors `mustChangePassword` in every respect:

- `AuthUser` gains `mustSetEmail`, signed into the access token by
  `signAccessToken` and computed at both `issueTokens` call sites and both
  refresh paths as `email == null && config.mail != null`. Configuring mail
  therefore turns the gate on at the next token refresh, and the flag cannot
  drift from the configuration.
- **REST:** a new `emailSetupGate(secret)` in `middleware/auth.ts`, mounted
  immediately after `passwordChangeGate` and shaped exactly like it (same token
  verification, same `403` body shape, an `Email required` message). A sibling
  rather than an extra branch inside the existing gate, so each middleware keeps
  one job and `passwordChangeGate`'s tests stay untouched. Both gates exempt
  `/api/login`, `/api/auth/*` and the new `/api/password/*` routes.
- **GraphQL** is mounted outside that router, so there the gate is an auth
  scope: a new `emailSetupAllowed`, exempting **only** `viewerSetEmail` — the
  same single, load-bearing exemption `passwordChangeAllowed` already documents
  for `userChangePassword`.
- **Client:** `ProtectedRoute` gains a third redirect to a new `/set-email`
  page, ordered *after* the password-reset redirect, so a new account changes
  its password first and then sets its address.

### Verification (authenticated, GraphQL)

| Mutation | Behaviour |
| --- | --- |
| `viewerSetEmail(email)` | Validates and normalizes; writes `email` + `emailKey`; clears `emailVerifiedAt`; deletes outstanding tokens for that user; issues and sends a `verify` token. A `emailKey` collision returns an "already in use" error result, not a throw — the `P2002`-as-outcome convention `createUser` uses. |
| `viewerResendEmailVerification` | Upserts the `verify` token (new code, previous invalidated), subject to the 60s cooldown and 5-send cap. |
| `viewerConfirmEmail(code)` | Consumes the `verify` token for the viewer, checks `email` still matches the token's `email`, sets `emailVerifiedAt`. |

`Viewer` exposes `email` and `emailVerifiedAt` so the settings page can render
the address, a verified badge, and a resend affordance.

**Resolving the acting row.** These mutations need a `userId` to key
`EmailToken`, and the admin's token carries no `sub`. They therefore resolve the
acting row by `userId` when the claim is present and by `username` otherwise —
the admin's only path, and the reason `ensureAdminUser` must have run before any
of them can succeed.

**After `viewerSetEmail` succeeds** the client mints a fresh access token via the
refresh helper in `lib/api-fetch.ts`, so `mustSetEmail` clears immediately
instead of after up to `ACCESS_TOKEN_TTL_SECONDS`, then navigates home. It does
**not** log the caller out: unlike `userChangePassword` — whose page documents a
silent-logout contract because it revokes every refresh token — setting an
address revokes nothing, and `/api/auth/refresh` already rebuilds claims from
current state.

### Forgot / reset (unauthenticated, REST)

These sit beside `/api/login`, where the rate limiter already lives, and outside
the gates.

| Route | Behaviour |
| --- | --- |
| `POST /api/password/forgot {email}` | **Always `204`, with an empty body.** Sends only for a match with a *verified* address. Unknown address, unverified address, and the config admin are indistinguishable in status and body alike. |
| `POST /api/password/reset {email, code, newPassword}` | `204` on success: rotates `passwordHash` (argon2, via `hashLoginPassword`), calls `revokeAllForUsername` so no stolen refresh token survives the reset, clears `mustChangePassword`, deletes the token. `400` on unknown/expired/mismatched code, with no distinction between them. |

The reset page's copy names the add-on configuration as the place to change the
admin password, so the admin is told where to go rather than left guessing why
nothing arrived.

### `/api/public-config`

Gains `emailEnabled: boolean`, so the client hides the forgot-password link and
the email login hint entirely on installs without mail, rather than offering a
dead end.

## Client surfaces

| Surface | Change |
| --- | --- |
| `page/login` | Identifier field relabelled when `emailEnabled`; "Forgot password?" link, shown only when `emailEnabled`. |
| `page/set-email` (new) | The gated set-your-address screen, modelled on `page/password-reset`. |
| `page/forgot-password` (new) | Address entry; always reports "check your inbox". |
| `page/reset-password` (new) | Address + code + new password; code prefilled from `?code=`. Named distinctly from the existing `page/password-reset`, which is the *forced change* screen — this naming collision is a known trap. |
| `page/user` (settings) | Email section: current address, verified badge, change, resend verification. |
| `router/path.ts` | New paths, mirrored in `path-internal.ts` / `path-key.ts`. |

## Security and rate limits

- **Rate limiting.** `createLoginRateLimit` is IP-keyed with 10/60s hardcoded
  and is already correct about the easily-missed parts (per-key staleness,
  size-gated sweeps, proxy hops, injected clock). Generalize it to
  `createIpRateLimit({ now, trustProxyHops, maxAttempts, windowMs, label })`
  and build the login limiter from it; `forgot` and `reset` get a second
  instance at a tighter **5/60s**. Its doc comment and tests survive intact,
  gaining a label for the log line. This is the **only** adjacent refactoring
  in this spec, and it exists because the alternative is duplicating a function
  whose comments document three bugs already fixed in it.
- **TTLs.** `verify` 24h, `reset` 1h. Outstanding tokens are invalidated on
  address change and on password change.
- **Enumeration.** `forgot` is a flat `204`; login failures stay a generic
  `401`; reset failures do not distinguish unknown from expired.
- **Leakage.** Transport errors never reach the client beyond a generic
  failure; the operator's cause is logged server-side. Logs name usernames,
  never addresses or codes.
- **Codes** are generated with `crypto.randomInt` over a Crockford-base32
  alphabet (no `I`/`L`/`O`/`U`), and only their sha256 is persisted.

## Testing

TDD, vitest on both sides.

- **Mailer driver**, stubbed `fetch`: success; `permanent_bounces` inside a
  `200`; `401`; `429`; `500`; network throw — each mapping to its
  classification. `createMailer` returns `null` for blank/partial config.
- **Token service**: issue, consume, single-use, expiry, cooldown, send cap,
  replacement on resend, invalidation on address change and on password change.
- **Normalization**: case and whitespace folding; `emailKey` collision returns
  an outcome rather than throwing.
- **Login by email**: address resolves; the admin's address resolves to the
  admin identity; unknown stays `401`; values without `@` are untouched.
- **Gate**: REST `403`; GraphQL scope refusal; `emailSetupAllowed` exempts only
  `viewerSetEmail`; ordering — a pending password change wins over set-email;
  the gate is inert when `config.mail` is null.
- **REST integration** (supertest): `forgot` returns `204` for unknown,
  unverified and admin alike; `reset` rotates the password, revokes refresh
  tokens and clears `mustChangePassword`; bad and expired codes rejected
  identically; the limiter `429`s with `Retry-After`.
- **Migration** (`migrate.test.ts`): `data_v19` is idempotent, runs after
  `data_v10`, and — the regression that matters — the columns still exist on a
  database that starts pre-v10.
- **Client**: `ProtectedRoute` redirect ordering; the set-email page; forgot and
  reset pages including `?code=` prefill; the settings email section; and that a
  mail-disabled install renders no forgot-password link.
- **Schema**: `npm run graphql:schema` regenerated and `graphql:schema:check`
  clean; client codegen re-run.

## What Spec 2 and web push inherit

- `Mailer` is the channel interface; a `WebPushSender` implements the same
  `send`-shaped contract.
- `notify(userId, event, payload)` is the single fan-out point. Nothing that
  triggers a notification ever knows a channel exists.
- Preferences will be keyed `(userId, event, channel)`, so adding push is rows
  plus a driver — no migration of the preference model. The admin row means the
  admin's preferences live in the same table as everyone's.
- Retry and queueing belong behind `notify()`, where a background trigger has no
  user watching a spinner — not in the mailer, whose only v1 producer is a
  button press.

## Out of scope

Notification preferences and triggers (Spec 2); web push; an SMTP driver;
inbound email; digests or scheduling; changing how `syncPassword` works for
OPDS/KOSync; any change to the admin's credential source.

## Known traps

1. `data_v10_user_surrogate_id` rebuilds `users` with an explicit column list —
   new columns must be added in a data migration that runs after it, never in
   the DDL pass.
2. `page/password-reset` already exists and is the **forced password change**
   screen, not the email reset flow. The new pages are named
   `forgot-password` / `reset-password`.
3. GraphQL is mounted outside `passwordChangeGate`'s router, so a REST gate
   alone does not cover it; the scope is required.
4. The admin row must stay invisible to user-listing surfaces and must not gain
   a `sub` claim.
5. `emailVerifiedAt` must be cleared on every address change, or a verified flag
   outlives the address it described.
6. `mustSetEmail` rides a 15-minute access token, so anything that clears it
   must force a refresh rather than wait the token out — that is why
   `viewerSetEmail`'s client path refreshes explicitly.
