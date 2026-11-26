# Login protections: lockout, check cap, security headers, sync-auth lockout

Status: draft, for Simon's review (2026-11-25).

## Intent

Bring the login protections being added to scribe-server
(`scribe-server/docs/superpowers/specs/2026-11-25-login-protections-design.md`, itself ported
from aviary-server) to Bookplate, adapted to how Bookplate authenticates. Not prompted by an
incident, but one gap found while comparing (sync-password auth, below) is real and is the most
important item here.

## How Bookplate differs from Scribe

- **Human-chosen passwords, several users.** Scribe's secrets (password + 128-bit Secret Key)
  are unguessable online. Bookplate's login passwords are whatever the user picked; the
  authenticated change path only enforces `min(1)`
  (`graphql/schema/user/mutation/change-password.ts`), the email reset path `min(8)`. Online
  guessing is a realistic attack here, so the per-client lockout matters more than in Scribe.
- **No setup-code routes.** Scribe's global cap has nothing to attach to.
- **A second credential: the sync password.** OPDS (`/opds`, HTTP Basic) and KOSync (`/sync`,
  `x-auth-user`/`x-auth-key`) authenticate with a generated two-word password: two words from
  a 182-word list, ≤15 chars (`services/password.ts`, `generateSyncPassword`), so at most
  ~33k combinations (~15 bits). It is checked by a cheap MD5 compare
  (`services/password.ts`, `authenticate`) and has **no rate limit at all**: `createIpRateLimit`
  deliberately skips these routers (`routes/ui.ts`, its doc comment). That comment claims
  "bcrypt's own cost factor" is the mitigation; there is none — it is MD5. Anyone who knows a
  username can enumerate the space in minutes and then read and download the whole library.

## What exists today

- Fixed-window per-IP limiters from `createIpRateLimit` (`routes/ui.ts`): `POST /api/login`
  10/min, the `/api/password/*` routes 5/min. Keyed by `resolveLoginClientIp` with
  `TRUST_PROXY_HOPS` (`utils/client-ip.ts`). The MCP OAuth endpoints use the SDK's limiter with
  the same key generator (`mcp/index.ts`).
- Email reset codes: 8 chars of Crockford base32 (40 bits), bound to one account, 1 h TTL
  (`services/email-token.ts`).
- Auth is a bearer access token; the one cookie (refresh) is httpOnly, `SameSite=strict`,
  path `/api/auth`. So, as in Scribe, an Origin/CSRF check adds little and is out of scope.
- No security headers; `X-Powered-By` is still on.
- The config admin's password is compared in plain text with `===` (`routes/ui.ts`, the
  `/api/login` handler).

## Goals

1. **Web login lockout** per client, Aviary/Scribe numbers: 5 failures in 15 min locks that
   client for 15 min (`429`, `Retry-After`, `{ error: 'Too many attempts. Try again in N min.' }`).
2. **Sync-auth lockout** on OPDS and KOSync, in its own bucket (see Design for key and numbers).
3. **Concurrency cap on argon2**: at most 2 hashes/verifies in flight process-wide; beyond that
   `429`, `Retry-After: 60`, without hashing and without counting a failure.
4. **Security headers** on every response.
5. **Constant-time compare** for the config admin's password.
6. One `warn` log line per lockout (when it begins, not per refused request) and per busy
   refusal; client address and, for sync, the username; no secrets. Visible in Coolify's logs.
7. Correct the `createIpRateLimit` doc comment's "bcrypt's own cost factor" claim.

## Non-goals

- An event log or UI for failed sign-ins (Coolify logs are enough).
- Origin/CSRF checks (bearer auth already covers it).
- Persisting counters: in memory, a restart clears them, as in Aviary and Scribe.
- Forcing existing users to rotate their sync password.
- A per-account lockout on web login (spraying many IPs at one account): it hands anyone a way
  to lock a named user out, and the per-IP lockout already cuts a single IP from ~14,400 to
  ~480 guesses a day.

## Anti-goals

- **A global lock on web login.** Bookplate has one public door, like Scribe; anyone spraying
  from many addresses could lock every user out, including the admin.
- **Sharing a bucket between web login and sync auth.** E-readers and the browser usually sit
  behind the same home IP; a Kobo with a stale sync password must not lock its owner out of
  the web app.
- **A CSP that breaks the client**: react-jss inline styles, blob-URL covers
  (`client/src/lib/use-authorized-src.ts`, the cover picker), the push service worker, the MCP
  `/connect` consent flow.
- Touching MCP bearer-token traffic or JWT-authenticated API traffic.

## Design

### Which routes count failures

| Route | Failure = | Bucket | Check cap |
|---|---|---|---|
| `POST /api/login` | 401 (wrong password, unknown user, unknown email) | web | yes (verify) |
| `POST /api/password/reset` | 400 invalid/expired code | web | yes (hash) |
| `/opds/*` (Basic) | 401 with credentials present | sync | — (MD5) |
| `/sync/*` (KOSync) | 401 with headers present | sync | — (MD5) |
| GraphQL `userChangePassword`, `userRegister` | — (authenticated) | — | yes (hash/verify) |

Not failures: a 400 for a malformed body; the 403 "password not set"; a request with no
credentials at all (the Basic-auth challenge round trip, a KOSync request missing headers).
`POST /api/password/forgot` always answers 204, so it has nothing to count; its existing 5/min
limiter stays.

### Web bucket

Keyed by `resolveLoginClientIp`. 5 failures in 15 min → locked 15 min. Login and reset share it.

### Sync bucket

Keyed by **client IP + username** so a stale device locks only its own user at that address,
not other household members' devices. Threshold **10 failures in 15 min → locked 15 min**,
looser than web because devices retry on their own. Against one IP that still stretches the
33k space to ~34 days per username.

Known trade-off: a device with a stale password keeps that user's sync locked at that IP until
it is fixed, including the user's other devices there. The device is already failing visibly,
and the log line names the user, so this is acceptable.

### Counting (ported from Aviary's `LoginLimiter`, shared by both buckets)

- One `createLoginLimiter({ now, maxFailures, windowMs, lockMs, label })` factory, two
  instances. `middleware/login-limiter.ts`, next to the other middleware.
- Each attempt let through is recorded as a failure *before* the check runs and taken back on
  success, so a concurrent burst trips the lock instead of all being checked.
- A success clears that key's failure count. This is the lockout only: the existing
  fixed-window `createIpRateLimit` stays in front of web login, unchanged, including its rule
  that a success does not reset its window.
- Bounded memory: expired entries swept the same size-gated way `createIpRateLimit` does.
- Times in ms against an injected `now`, so tests need no fake timers.

### Check cap

One process-wide semaphore (`MAX_CHECKING = 2`): the module singleton `argonSlots` in
`services/check-slots.ts`, injectable into `createUiRouter` for tests. It wraps `argon2.hash` and
`argon2.verify` at their callers, acquired after the lockout check and before the provisional
failure is recorded, released in `finally`. argon2's default uses 64 MB per operation, which is
the real resource being protected on this hardware.

REST routes (login, reset) refuse with 429 when both slots are busy. Authenticated GraphQL
mutations (`userChangePassword`, `userRegister`) wait for a slot instead, since the caller is
already known and there is no lockout to protect.

The config admin's credential is not argon2, so it does not take a slot.

### Config admin compare

Replace `password === config.password` with a `crypto.timingSafeEqual` over SHA-256 digests of
both sides (equal length regardless of input). The username comparison stays as it is.

### Headers

On every response (API, GraphQL, SPA, static, OPDS, KOSync, MCP), hand-written as in Aviary
(no `helmet`):

- `Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: same-origin`
- `X-Frame-Options: DENY`
- `X-Powered-By` removed (`server.disable('x-powered-by')`).
- `/api/*`, `/graphql` and the MCP/OAuth paths also get `Cache-Control: no-store`, unless the
  route sets its own. Cover and file responses already set `ETag`/`Cache-Control`
  (`routes/ui.ts`, `routes/opds.ts`) and must keep them; set the default first and let routes
  overwrite it.

Differences from Scribe's CSP: `blob:` in `img-src` for covers; `worker-src 'self'` stated
explicitly for the push service worker.

### Sync password length (open)

Making new sync passwords three words (182³ ≈ 6M) would help, but the generator caps the
result at 15 characters, which looks like a device-entry constraint. Left open: find out why the
cap exists before changing it. The lockout stands on its own either way.

### Tests

- Limiter unit tests: locks after N, unlocks after the lock period, provisional count under a
  concurrent burst, success clears, busy refusal not counted, sweep bounds memory.
- Route tests: web login and reset return 429 after 5 failures; OPDS and KOSync after 10; a
  stale-password user at one IP does not lock another user at the same IP; a no-credentials
  Basic challenge does not count; a web lockout does not affect sync and vice versa.
- Check cap: a third concurrent login gets 429 without calling argon2.
- Config admin login still works, and still fails on a wrong password.
- Headers present on an API, GraphQL, SPA, OPDS and MCP response; existing cover
  `Cache-Control` survives.
- The client still works under the CSP: screenshot the library page (with covers), a book page
  and the MCP consent page via Playwright against a dev server, and check the console for CSP
  violations.

## Left to the builder

- How the limiters and semaphore are threaded through `createServer`, `createUiRouter`,
  `opdsAuth`/`kosyncAuth` and the GraphQL context.
- Exact log wording.
