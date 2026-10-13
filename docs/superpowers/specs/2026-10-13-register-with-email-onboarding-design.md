# Register with email, and onboarding by link — design

Date: 2026-10-13
Status: approved design, not yet planned

## Context

`2026-09-20-email-address-ownership-design.md` gave every `User` an `email`,
`emailKey` and `emailVerifiedAt`, a `mustSetEmail` gate at the login boundary,
and single-use `EmailToken` codes for `verify` and `reset`. Registration did
not change with it: `userRegister` still takes `{ username }` only, generates a
login password, and the admin hands that password to the new user out of band
(`PasswordResultModal`). The new user then meets the `mustSetEmail` gate on
first login and has to supply and verify an address themselves.

This spec moves the address to registration time and replaces the hand-off
with an onboarding email: the admin enters the address, the new user receives
a welcome email with a link, and following it lets them choose their own
password, verifies the address (they proved they can read that inbox) and
signs them in.

The same branch has already renamed the card to "Register new user" and moved
it below the user list. A proper user screen comes later in this branch; it is
where a "resend welcome email" action belongs (see Out of scope).

## Decisions

| # | Decision | Why |
| --- | --- | --- |
| D1 | Email is **required when mail is configured, absent when it is not** — an install-level rule, not an admin choice. | An install that can send mail onboards everyone by mail; one that cannot keeps today's flow exactly. |
| D2 | The onboarding link leads to a **"choose your password" page**, not a passwordless session. | It is the reset flow plus one side effect. A code-for-session exchange would be a new kind of credential in this app, needing its own hardening. |
| D3 | An account registered with an email is created with **`passwordHash: null`**. | No unseen live credential exists. The onboarding link is the only way in. Login already answers 403 "password not set" for such a row. |
| D4 | If the welcome email fails to send, registration **falls back to generating a password** and returning it, as today. | The admin is never left with an account nobody can enter. |
| D5 | Consuming the onboarding code **verifies the address** (`emailVerifiedAt = now`). | Receiving the code proves inbox control, which is exactly what `verify` proves. |
| D6 | No resend action in this pass. | It belongs on the forthcoming user screen. Until then an admin can delete and re-register. |

## Server

### `userRegister`

`UserRegisterInput` gains `email: String` — optional in the schema only because
which rule applies depends on the install:

- **Mail configured** (`isMailConfigured(config)` and `context.mailer !== null`):
  a missing or blank `email` returns `InvalidInputError` on `['email']`,
  "Email is required"; an implausible one returns `InvalidInputError`,
  "Enter a valid email address" (`isValidEmail`).
- **Mail not configured**: a supplied `email` is rejected with
  `EmailNotConfiguredError`. The client never sends one in this state; this is
  defensive only.

The existing check order (charset → reserved name → length) is unchanged and
runs first; the email checks run after it, before any write.

The address is written in the **same `prisma.user.create`** that creates the
account (`email`, `emailKey: normalizeEmail(email)`, `emailVerifiedAt: null`,
`passwordHash: null`, `mustChangePassword: false`). `createUser`
(`services/user.ts`) grows an options object to carry this. A `P2002` collision
must now distinguish which unique index fired. `e.meta.target` is not relied on
(its shape varies under Prisma driver adapters); instead, on `P2002` the
resolver re-queries by `username` — a row there → `UsernameAlreadyExistsError`
as today, otherwise → `EmailInUseError`. `createUser` therefore reports *that*
a unique collision happened, and the resolver decides which. `UserRegisterResult` gains `EmailInUseError` and
`EmailNotConfiguredError`.

After the create, when an email was given:

1. `issueEmailToken({ userId, purpose: 'onboard', email })`.
2. `mailer.send(welcomeMessage({ to, code, username, libraryName, publicUrl }))`.
3. If either step fails (`issued.ok === false` or `send` not ok), generate a
   password, hash it, and update the row with it and `mustChangePassword: true`
   (today's behaviour), then return it. The onboarding token is invalidated in
   this branch so the account does not have two ways in.

`UserRegisterPayload` changes:

```graphql
type UserRegisterPayload {
  user: User!
  password: String          # was String!; null when the welcome email went out
  onboardingEmailSent: Boolean!
}
```

Without an email (mail not configured), the path is unchanged:
`password` is set, `onboardingEmailSent` is false.

`mustSetEmail` is unaffected: these accounts have an address from creation, so
`computeMustSetEmail` is false for them.

### The `onboard` token

`EmailTokenPurpose` becomes `'verify' | 'reset' | 'onboard'`, with
`ONBOARD_TTL_MS = 7 days` — longer than `verify`'s 24h because a new user may
not check that inbox promptly, and safe because the token only works on an
account that has never had a password (see the endpoint's checks). Cooldown
and rolling-window cap are the shared ones. No schema migration: `purpose` is
a plain `String` and the primary key is `(userId, purpose)`.

### `welcomeMessage`

New in `services/mail-template.ts`, built on the existing code-bearing
`render`: subject "Your {libraryName} account", a lead naming the username
("An account has been created for you on {libraryName}. Your username is
{username}."), the code, and — only when `publicUrl` is configured — a link to
`{publicUrl}/welcome?code=…&email=…`. The address is in the link because
tokens are looked up by account, not by hash (same reason the reset flow
submits the address). Without `publicUrl`, the user types the code on the
`/welcome` page, as with every other template. The module's doc comment
listing "every mail message" is updated.

### `POST /api/onboard`

In `routes/ui.ts`, beside `/api/login`, because `issueTokens` is a closure in
that router. Body `{ email, code, newPassword }`. Rate limited with the same
limiter `/api/password/reset` uses; 404 when mail is not configured (same
`requireMail` reasoning).

Checks, in order, with one generic 400 ("That link is not valid or has
expired.") for every failure, as the reset endpoint does:

1. Malformed body.
2. `newPassword.length < MIN_PASSWORD_LENGTH` — before any token lookup, so a
   short password never burns a code.
3. `findUserByEmail` → `null`, or `isConfigAdmin`, or `passwordHash !== null`
   (already onboarded).
4. `consumeEmailToken({ purpose: 'onboard', code })` → `null`.
5. `consumed.email !== account.email`.

Then one `prisma.user.update`: `passwordHash`, `emailVerifiedAt: now`,
`mustChangePassword: false`; `invalidateEmailTokens(userId, 'onboard')`;
`deleteExpired`; and `issueTokens(res, { userId, username, isAdmin: false,
mustChangePassword: false, mustSetEmail: false })`. Response is the same
`{ accessToken }` JSON login returns, plus the refresh cookie. No refresh-token
revocation step is needed: an account with no password has never been able to
log in, so it has none.

## Client

### Register card (`component/user-register`)

Reads `emailEnabled` from the config provider. When true, an Email
`TextInput` (`type="email"`, `autoComplete="off"`) sits under Username and
Register stays disabled until both are valid (username as today; email via a
plausibility check). When false the card is exactly as today and no `email` is
sent.

`UserRegisterDocument` selects `onboardingEmailSent`. Results:

- `onboardingEmailSent: true` → a small confirmation modal: "Welcome email
  sent to {email}. {username} can set their password from the link."
- `false` with a `password` → the existing `PasswordResultModal`; when an
  email was entered, it adds a one-line note that the welcome email could not
  be sent.
- `EmailInUseError` / `InvalidInputError` / `EmailNotConfiguredError` → toast,
  as username errors are today. The form keeps its values.

### Welcome page (`page/welcome`)

New unprotected route `path.welcome()` → `/welcome`, beside
`resetPasswordByEmail`. Modelled on `page/reset-password`: `email` and `code`
prefilled from the query string (editable, for the no-`publicUrl` case), new
password and confirmation, same minimum length. Submit posts to
`/api/onboard`; on 200, `setToken(extractAccessToken(...))` and navigate to the
library, as the login page does. On 400 the generic message, directing the user
to their library admin — not to forgot-password, which requires a verified
address this user does not yet have. 429 handled as the login page handles it.

### Login page

When `emailEnabled`, a "Set up a new account" button sits beside "Forgot
password?" and goes to `/welcome`. Without `publicUrl` the welcome email
carries only a code, so this is how a new user reaches the page. (Added while
planning.)

### Users list

No change. A not-yet-onboarded user already shows their address as
unconfirmed; the forthcoming user screen is where that state gets its own
treatment.

## Testing

Server:

- `userRegister`: mail configured — email required, invalid email, duplicate
  email (`EmailInUseError`, no row created), happy path (`password: null`,
  `onboardingEmailSent: true`, row has email/null hash, `onboard` token exists,
  one message sent); send failure → fallback password, `mustChangePassword`,
  token invalidated. Mail not configured — email rejected, no-email path
  unchanged. Duplicate username still `UsernameAlreadyExistsError`.
- `welcomeMessage`: contents with and without `publicUrl`; library name escaped.
- `/api/onboard`: happy path (password set, verified, tokens issued, cookie
  set, code spent); wrong / expired / reused code; account that already has a
  password; config admin; code issued for a different address; short password
  does not burn the code; 404 when mail is off.

Client:

- Register card with the email field shown and hidden; disabled-until-valid;
  both result modals; error toasts.
- Welcome page: prefill from query string, submit success stores the token and
  navigates, 400 and 429 paths.

## Out of scope

- Resending the welcome email (the forthcoming user screen).
- Adding or changing an address on an existing user from the admin side.
- Any change to the `mustSetEmail` gate or the self-service set-email flow.

## Revised after VQA (2026-10-13)

- **The welcome link is the only way in.** The login page's "Set up a new
  account" button is removed, and `/welcome` no longer shows the address or
  code fields — it reads both from the link, and shows "This link is
  incomplete — use the link from your welcome email." when either is missing.
- **Email requires `public_url`.** `loadConfig` turns mail off (with a startup
  warning) when `public_url` is unset or invalid, for every driver. This
  supersedes "Without `publicUrl`, the user types the code on the `/welcome`
  page" above, and the "Login page" section. Existing installs with mail but
  no `public_url` lose email features until it is set.
