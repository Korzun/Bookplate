# JWT-Based Authentication — Design

**Date:** 2026-06-10
**Status:** Approved

## Goal

Replace the express-session cookie sessions used by the web UI with JWT-based
authentication. The client derives `userId`, `username`, `isAdmin`, and
`mustChangePassword` from the JWT instead of calling `/api/me`, and the
presence of a valid, unexpired JWT is what defines "logged in".

OPDS (HTTP Basic) and KOSync (header) authentication are unchanged.

## Architecture Overview

- **Access token:** short-lived JWT (15 minutes), HS256, signed with
  `jsonwebtoken`. Stored in localStorage; sent as `Authorization: Bearer` on
  API calls.
- **Refresh token:** opaque random 256-bit value (not a JWT), 30-day expiry,
  delivered as an httpOnly `SameSite=Strict` cookie with `Path=/api/auth`, so
  it is only ever sent to the refresh and logout endpoints. The server stores
  only its SHA-256 hash and rotates it on every refresh. The `Secure` cookie
  flag is intentionally omitted: the app is self-hosted and served over plain
  HTTP on a trusted LAN, where `Secure` would prevent the cookie from being
  set at all.
- **Client:** the `AuthProvider` proactively refreshes the access token one
  minute before expiry; a central `apiFetch` wrapper injects the header and
  retries once through a refresh on 401 as a safety net.

## Tokens, Claims, and Signing

### Access token claims

```json
{
  "sub": "<userId>",
  "username": "simon",
  "isAdmin": false,
  "mustChangePassword": false,
  "iat": 1760000000,
  "exp": 1760000900
}
```

- `sub` is the user's surrogate ID. It is **omitted for the config-based
  admin**, who has no DB row.
- The client decodes the payload directly; `GET /api/me` is removed.

### Refresh token storage

New Prisma model:

```prisma
model RefreshToken {
  tokenHash String  @id @map("token_hash")
  userId    String? @map("user_id")   // null for the config-based admin
  username  String
  expiresAt Float   @map("expires_at")
  user      User?   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("refresh_tokens")
}
```

- Every refresh **rotates** the token: the old row is deleted, a new token is
  issued, and a new cookie is set. Presenting a rotated-out (reused) token
  returns 401.
- Logout deletes the row and clears the cookie.
- An admin password-reset deletes all of that user's refresh-token rows,
  forcing re-login within at most 15 minutes (access-token expiry).

### Signing secret

A 256-bit secret is generated with `crypto.randomBytes` on first boot and
persisted in a new `Setting` key-value table in SQLite. Tokens survive
restarts; users manage no new configuration. (The old session secret — the
admin password — is not carried forward.)

```prisma
model Setting {
  key   String @id
  value String

  @@map("settings")
}
```

## Server Endpoints and Middleware

### Endpoints (`routes/ui.ts`)

| Endpoint | Change |
| --- | --- |
| `POST /api/login` | Same credential checks (config admin first, then `UserStore`). On success returns `200 { accessToken }` and sets the refresh cookie. `mustChangePassword` is baked into the claims. |
| `POST /api/auth/refresh` | **New.** Reads the refresh cookie, looks up the hash, checks expiry, rotates the token, returns a fresh `{ accessToken }`. Claims are rebuilt from current state (`UserStore` lookup for users; config match for the admin), so a changed `mustChangePassword` propagates and a deleted/renamed user gets 401. Any failure → 401 and the cookie is cleared. |
| `POST /api/auth/logout` | **New** (replaces `POST /logout`). Deletes the refresh-token row, clears the cookie, returns 204. No server-side redirect. |
| `GET /api/me` | **Removed.** Claims come from the token. |
| `PATCH /api/my/password` | On success, revokes all the user's refresh tokens and returns a brand-new token pair (`{ accessToken }` + new refresh cookie), clearing the `mustChangePassword` claim immediately. |

### Middleware (`middleware/auth.ts`)

- `sessionAuth` → **`jwtAuth`**: verifies the Bearer header and attaches
  `req.user = { userId?, username, isAdmin, mustChangePassword }`. On failure
  returns `401 { error: 'Unauthorized' }` — no redirect; login-gating is the
  SPA's job.
- `adminAuth` reads `req.user.isAdmin`.
- `requirePasswordChange` reads `req.user.mustChangePassword`; the allowlist
  becomes `/api/my/password`, `/api/auth/*` (refresh and logout must keep
  working in the forced-change state), and non-`/api/` paths.
- `requireUserId` reads `req.user.userId` (no session destruction).
- `opdsAuth` and `kosyncAuth` are untouched.

### Plumbing

- Remove `express-session` (dependency, `server.ts` setup, `SessionData`
  augmentation in `global.d.ts` — replaced by an `Express.Request.user`
  augmentation).
- Add `cookie-parser` for the refresh cookie.
- HTML routes serve the SPA unconditionally; the client routes to `/login`
  when logged out.

## Client

### `src/lib/token.ts` (new, dependency-free)

- `getToken()` / `setToken()` / `clearToken()` — localStorage under one key.
- `decodeClaims(token)` — base64url-decodes the payload (no signature check;
  the server is the verifier). Returns
  `{ userId?, username, isAdmin, mustChangePassword, exp }` or `null` if
  malformed.
- `isExpired(claims)` — `exp` vs. now.

### `src/lib/api-fetch.ts` (new)

- Injects `Authorization: Bearer <token>` when a token exists.
- On 401: calls `POST /api/auth/refresh` once (single-flight — parallel 401s
  share one in-flight refresh promise), stores the new token, retries the
  original request once. If the refresh fails: clears the token and signals
  logged-out.
- All data hooks switch `fetch(...)` → `apiFetch(...)`.

### `AuthProvider` (`provider/auth/provider.tsx`)

- State is a single `token` value; `userId`, `username`, `isAdmin`, and
  `mustChangePassword` are derived via `decodeClaims`.
- **Logged in = valid, unexpired token in localStorage.**
- On mount: if the stored token is missing or expired, silently try one
  `POST /api/auth/refresh` (the httpOnly cookie may still be valid — this
  keeps users logged in across browser restarts). On failure, render
  logged-out.
- **Proactive refresh:** a `useEffect` keyed on the token schedules
  `refreshToken()` one minute before `exp`; each refresh re-arms the timer.
  The `apiFetch` 401-retry covers what the timer misses (laptop sleep, drift).

### Auth hooks (`provider/auth/hook/`)

- `useLogin` stores the returned `accessToken` into context.
- `useLogout` posts `/api/auth/logout`, clears the token, navigates to
  `/login`.
- The password-change flow stores the fresh token returned by
  `PATCH /api/my/password`, which clears the must-change-password banner.

### Routing

Existing client-side gating in `App.tsx` keys off "token present and valid"
instead of "did `/api/me` succeed". `loading` only exists during the
mount-time silent-refresh attempt.

## Error Handling

- Expired/invalid access token → 401 from `jwtAuth` → `apiFetch` refreshes
  once → on failure, token cleared, SPA routes to `/login`. No redirect loops
  (`/login` and `POST /api/login` are unauthenticated).
- Revoked/expired refresh token → `/api/auth/refresh` returns 401 and clears
  the cookie.
- Malformed localStorage tokens are treated as logged-out, not as errors.
- Clock skew is a non-issue server-side (same machine signs and verifies);
  the 1-minute-early client refresh tolerates minor client drift.

## Migration

- One Prisma migration adds `refresh_tokens` and `settings`. Existing tables
  are unchanged.
- Deploy effect: all existing sessions die; every user re-logs-in once.
  Acceptable for a self-hosted app; note in the changelog.
- Expired `refresh_tokens` rows are deleted lazily: on a refresh attempt that
  hits an expired row, and a sweep on login. No background job.

## Testing

- **Server:** middleware tests for `jwtAuth`/`adminAuth` (valid, expired,
  malformed, missing); route tests for login → refresh → rotate → logout,
  refresh-token reuse after rotation (401), password change revoking tokens,
  admin reset forcing re-login. Existing route tests switch from session
  cookies to Bearer headers.
- **Client:** unit tests for `decodeClaims`/`isExpired`; `api-fetch` tests for
  header injection, single-flight refresh, retry-once, give-up; `AuthProvider`
  tests for claim derivation, mount-time silent refresh, and timer-based
  proactive refresh (fake timers). Hook tests seed localStorage with a test
  token instead of mocking `/api/me`.
- `npm test` then `npm run lint` at every task boundary.

## Out of Scope

- Logout-everywhere UI and multi-device session listing.
- OPDS/KOSync auth changes.
- Changes to how admin credentials are configured.
