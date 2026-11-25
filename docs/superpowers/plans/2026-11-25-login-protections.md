# Login Protections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock out clients that keep failing web login, password reset or sync (OPDS/KOSync) auth, cap concurrent argon2 work, and send security headers on every response.

**Architecture:** One in-memory `createLoginLimiter` factory (`middleware/login-limiter.ts`) with two kinds of instance: a web bucket keyed by client IP (login + reset), and a sync bucket keyed by IP + username (OPDS + KOSync, one instance shared by both routers). A process-wide `argonSlots` semaphore (`services/check-slots.ts`) guards argon2: REST routes refuse with 429 when it is full, and authenticated GraphQL mutations wait for a slot. A hand-written `securityHeaders()` middleware is mounted first in `createServer`.

**Tech Stack:** Express 5, TypeScript, Prisma (SQLite), argon2, Vitest + supertest, Playwright CLI for the CSP check.

**Spec:** `docs/superpowers/specs/2026-11-25-login-protections-design.md`

**Working directory:** `.claude/worktrees/login-protections` (branch `login-protections`). Server commands run from `app/server`.

## Global Constraints

- Web bucket: 5 failures in 15 min → locked 15 min. Sync bucket: 10 failures in 15 min → locked 15 min.
- Lockout response: `429`, `Retry-After: <seconds, rounded up>`, body `{ error: 'Too many attempts. Try again in N min.' }` (N = minutes rounded up). OPDS/KOSync use the same status and header; the body shape is the same JSON.
- Busy response: `429`, `Retry-After: 60`, `{ error: 'Server busy. Try again in a minute.' }`; no hash run, no failure counted.
- `MAX_CHECKING = 2`.
- Counters are in memory only; times are ms against an injected `now: () => number` (no fake timers in tests).
- Web bucket key: `resolveLoginClientIp(req, config.trustProxyHops ?? 0)`. Sync bucket key: that IP + `'\u0000'` + username.
- The existing `createIpRateLimit` instances stay in front, unchanged.
- One `warn` line when a lockout begins (not per refused request) and one per busy refusal. Client address and, for sync, username. Never a password, code or key.
- No new dependencies (no `helmet`).
- CSP exactly: `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`
- Spec refinement made in this plan: authenticated GraphQL mutations (`userChangePassword`, `userRegister`) **wait** for an argon slot instead of answering 429. They are owner/admin-only and low-volume, and a refusal would need a new GraphQL error type and client handling. Task 4 updates the spec's Check cap section to match.

## Review Focus

1. **A KOReader with a stale sync password at home must not lock a second user's devices at the same IP.** Test in Task 3.
2. **OPDS clients send a no-credentials request first to get the Basic challenge.** That request must not count, or every fresh connection burns one failure. Test in Task 3.
3. **A wrong config-admin password must count as a failure, and a right one must still log in after four failures.** The admin check isn't argon2, so it's easy to leave outside the counting. Test in Task 2.
4. **Cover images must keep their own `Cache-Control`/`ETag` under the `/api` `no-store` default, including on a `304`.** The cover route's 304 branch (`GET /api/books/:id/cover`, `routes/ui.ts`) returns before it sets `Cache-Control`, so it would carry `no-store`, and browsers may then evict the cached cover. Test in Task 5.
5. **A burst of concurrent wrong logins must trip the lock, not all get checked.** This is what provisional counting is for. Test in Task 1 (unit) and Task 2 (route, five parallel requests then a sixth).

---

### Task 1: Limiter and check-slot primitives

**Files:**
- Create: `app/server/middleware/login-limiter.ts`
- Create: `app/server/middleware/login-limiter.test.ts`
- Create: `app/server/services/check-slots.ts`
- Create: `app/server/services/check-slots.test.ts`

**Interfaces:**
- Produces (`middleware/login-limiter.ts`):
  ```ts
  export type LoginAttempt = {
    /** Credential accepted: clears this key's failures and any lock. */
    succeeded(): void;
    /** Not a credential failure after all (e.g. 403 password-not-set, busy): removes this one provisional failure; undoes a lock it alone started. */
    cancelled(): void;
  };
  export type LoginLimiter = {
    /** ms until the lock lifts, or null when not locked. Expired locks are cleared here. */
    lockedForMs(key: string): number | null;
    /** Records a provisional failure now. If that reaches maxFailures, starts the lock and logs one warn naming `who`. */
    begin(key: string, who: string): LoginAttempt;
    size(): number;
  };
  export function createLoginLimiter(options: {
    now?: () => number; maxFailures: number; windowMs: number; lockMs: number; label: string;
  }): LoginLimiter;
  export const WEB_LOCKOUT: { maxFailures: 5; windowMs: 900_000; lockMs: 900_000 };
  export const SYNC_LOCKOUT: { maxFailures: 10; windowMs: 900_000; lockMs: 900_000 };
  export function sendLocked(res: Response, retryAfterMs: number): void;
  export function sendBusy(res: Response, who: string, label: string): void; // also logs the busy warn
  ```
- Produces (`services/check-slots.ts`):
  ```ts
  export type Release = () => void; // idempotent
  export type CheckSlots = { tryAcquire(): Release | null; acquire(): Promise<Release>; inFlight(): number };
  export const MAX_CHECKING = 2;
  export function createCheckSlots(max: number): CheckSlots;
  export const argonSlots: CheckSlots; // process-wide, createCheckSlots(MAX_CHECKING)
  ```

- [ ] **Step 1: Write the failing limiter tests** in `login-limiter.test.ts`, with a mutable `let t = 0; const now = () => t;` and `createLoginLimiter({ now, ...WEB_LOCKOUT, label: 'Test' })`:
  - `locks after 5 failures`: 5 × `begin('a','a')` → `lockedForMs('a')` is `900_000`; key `'b'` is still `null`.
  - `stays unlocked at 4 failures`: 4 begins → `null`.
  - `unlocks 15 min after the lock began`: lock at `t=0`; at `t=899_999` → `1`; at `t=900_000` → `null`, and one more begin does not re-lock (failures cleared with the lock).
  - `failures older than the window drop off`: 4 begins at `t=0`, `t=900_000`, 1 begin → `null`.
  - `provisional count under a burst`: 5 begins held open (no `succeeded`) → locked before any resolves.
  - `success clears failures and the lock`: 5 begins, `succeeded()` on the last → `null`; then 4 more begins → still `null`.
  - `cancelled removes one failure and undoes a lock it alone started`: 5 begins, `cancelled()` on the 5th → `null`; a 5th begin locks again.
  - `logs one warn when a lock begins, not per refused check`: spy `process.stderr.write`; 5 begins + 3 `lockedForMs` → exactly one line containing `Test` and `who`, and never the key's secret part.
  - `sweep bounds memory`: 300 distinct keys with one failure each at `t=0`, advance `t` past the window, one more begin → `size()` is `1`.
  - `sendLocked`: on a tiny express app via supertest, `retryAfterMs = 61_000` → status 429, `Retry-After: 62`, body `{ error: 'Too many attempts. Try again in 2 min.' }`.
  - `sendBusy`: status 429, `Retry-After: 60`, body `{ error: 'Server busy. Try again in a minute.' }`, one warn line.

- [ ] **Step 2: Write the failing check-slot tests** in `check-slots.test.ts`:
  - `tryAcquire gives out at most max slots`: `createCheckSlots(2)` → two releases, third `null`; `inFlight()` is 2.
  - `release frees a slot and is idempotent`: release twice → `inFlight()` is 1, not 0 then -1.
  - `acquire waits for a slot, FIFO`: fill both, start two `acquire()`s, release one → only the first resolves.
  - `MAX_CHECKING is 2` and `argonSlots` is a `CheckSlots` with `inFlight() === 0` at load.

- [ ] **Step 3: Run them to see them fail**

  Run: `cd app/server && npx vitest run middleware/login-limiter.test.ts services/check-slots.test.ts`
  Expected: FAIL, modules not found.

- [ ] **Step 4: Implement both modules.** The limiter keeps `Map<key, { failures: number[]; lockedUntil: number | null }>` and prunes `failures` to the window on every touch. Sweep the whole map only when `size > 256`, like `createIpRateLimit`'s threshold, dropping entries with no live failures and no live lock. `cancelled()` removes one timestamp (its own) and clears `lockedUntil` if the remaining count is below `maxFailures`. Logger namespace `'LoginLimiter'`. Line format: `` `${label} lockout: ${who} locked for ${lockMs/60000} min after ${maxFailures} failures` ``.

- [ ] **Step 5: Run the tests to see them pass**

  Run: `cd app/server && npx vitest run middleware/login-limiter.test.ts services/check-slots.test.ts`
  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add app/server/middleware/login-limiter.* app/server/services/check-slots.*
  git commit -m "feat(auth): login lockout limiter and argon check slots"
  ```

---

### Task 2: Web lockout, check cap and constant-time admin compare on login and reset

**Files:**
- Modify: `app/server/routes/ui.ts` (`CreateUiRouterDeps`, `createUiRouter`, the `POST /api/login` handler)
- Modify: `app/server/routes/password.ts` (`createPasswordRouter` deps, `POST /api/password/reset`)
- Modify: `app/server/services/password.ts` (add `safeEqual`)
- Test: `app/server/routes/ui.test.ts`, `app/server/routes/password.test.ts`, `app/server/services/password.test.ts`

**Interfaces:**
- Consumes: Task 1 (`createLoginLimiter`, `WEB_LOCKOUT`, `sendLocked`, `sendBusy`, `CheckSlots`, `argonSlots`).
- Produces:
  - `CreateUiRouterDeps` gains `webLimiter?: LoginLimiter` (default: a fresh `createLoginLimiter({ now: loginRateLimitNow, ...WEB_LOCKOUT, label: 'Login' })` per router build) and `argonSlots?: CheckSlots` (default: the shared `argonSlots`).
  - `createPasswordRouter` deps gain `webLimiter: LoginLimiter`, `argonSlots: CheckSlots`, `trustProxyHops: number`. `createUiRouter` passes its own instances, so login and reset share one bucket.
  - `export function safeEqual(a: string, b: string): boolean` in `services/password.ts`: `timingSafeEqual` over the SHA-256 digests of both.

- [ ] **Step 1: Write the failing tests.**
  `services/password.test.ts`: `safeEqual('pass','pass')` true; `safeEqual('pass','pas')` false; `safeEqual('','')` true.

  `ui.test.ts`, new `describe('login lockout')` using `buildApp` and a helper `login(u, p)`:
  - `5 wrong passwords then 429 for that client, even with the right password`: 5 × alice/wrong → 401 each; alice/alicepass → 429, `Retry-After: 900`, body `{ error: 'Too many attempts. Try again in 15 min.' }`.
  - `success clears the failure count`: 4 wrong, 1 right (200), 4 wrong → all 401; 5th wrong after that → 401 (not 429 yet), 6th → 429.
  - `wrong config-admin password counts; right one still works after 4` (Review Focus 3): 4 × admin/wrong → 401; admin/pass → 200; then 5 × admin/wrong → 5th is 401, next request 429.
  - `unknown email counts as a failure`: 5 × `nobody@example.com` → next is 429.
  - `403 password-not-set does not count`: create `nopass`; 6 × nopass → all 403.
  - `malformed body does not count`: 6 bodiless POSTs → all 401; then alice/alicepass → 200.
  - `concurrent burst trips the lock` (Review Focus 5): `Promise.all` of 5 wrong logins, then one more wrong → 429.
  - `unlocks after 15 min`: drive the existing `loginRateLimitNow` clock (it also feeds the web limiter) past `900_000` → 200.
  - `busy argon refuses without verifying or counting`: build with `argonSlots: createCheckSlots(2)`, take both slots, `vi.spyOn(argon2, 'verify')`; alice/alicepass → 429, `Retry-After: 60`, busy body, spy not called. Release, then 5 wrong → 5th still 401 (the busy one didn't count).
  - `config admin login does not need a slot`: both slots taken → admin/pass → 200.

  Check the existing `rate limiting (Task 4)` tests still hold: they send successes, and the `trustProxyHops` test sends failures. If one of them now hits the lockout before the 11th attempt, change its credentials to valid ones. Don't loosen the lockout.

  `password.test.ts`, new `describe('reset lockout')` (mail configured, as the existing reset tests set up):
  - `5 wrong codes then 429`: 5 × wrong code for a real address → 400 each; next (even with the right code) → 429 with lockout body.
  - `too-short password and malformed body do not count`: 6 × each → 400, then a correct reset → 204.
  - `reset and login share one bucket`: 3 wrong logins + 2 wrong codes from one client → next login is 429.

- [ ] **Step 2: Run them to see them fail**

  Run: `cd app/server && npx vitest run routes/ui.test.ts routes/password.test.ts services/password.test.ts`
  Expected: the new tests FAIL (no 429 after 5; `safeEqual` not exported).

- [ ] **Step 3: Implement.** Use the same order in both routes:
  1. Existing IP limiter, then body validation.
  2. `lockedForMs(ip)`: if locked, `sendLocked`.
  3. `begin(ip, ip)`.
  4. Credential check.
  5. `succeeded()` / leave the failure / `cancelled()`.

  Login specifics:
  - Begin right after the body type check.
  - Admin match uses `loginName === config.username && safeEqual(password, config.password)`, then `succeeded()`.
  - The 403 password-not-set branch calls `cancelled()`.
  - Right before `validateUser`, call `argonSlots.tryAcquire()`. If it returns null, `cancelled()` then `sendBusy(res, ip, 'Login')`. Release in `finally`.

  Reset specifics:
  - Begin after the length check.
  - `tryAcquire` around `hashLoginPassword`. If busy: `cancelled()` and `sendBusy`.
  - `succeeded()` on 204.

- [ ] **Step 4: Run the tests to see them pass**

  Run: `cd app/server && npx vitest run routes/ui.test.ts routes/password.test.ts services/password.test.ts`
  Expected: PASS, including every pre-existing test in those files.

- [ ] **Step 5: Commit**

  ```bash
  git add app/server/routes/ui.ts app/server/routes/password.ts app/server/services/password.ts app/server/routes/*.test.ts app/server/services/password.test.ts
  git commit -m "feat(auth): lock out repeated login and reset failures, cap argon checks"
  ```

---

### Task 3: Sync-auth lockout on OPDS and KOSync

**Files:**
- Modify: `app/server/middleware/auth.ts` (`opdsAuth`, `kosyncAuth`)
- Modify: `app/server/routes/opds.ts` (`CreateOpdsRouterDeps`), `app/server/routes/kosync.ts` (`createKosyncRouter`)
- Modify: `app/server/routes/ui.ts` (correct the `createIpRateLimit` doc comment's "bcrypt's own cost factor" sentence: the check is an MD5 compare, and these routes are now covered by the sync lockout in `middleware/auth.ts`)
- Test: `app/server/middleware/auth.test.ts`, `app/server/routes/opds.test.ts`, `app/server/routes/kosync.test.ts`

**Interfaces:**
- Consumes: Task 1 (`createLoginLimiter`, `SYNC_LOCKOUT`, `sendLocked`, `LoginLimiter`), `resolveLoginClientIp`.
- Produces:
  - `opdsAuth(prisma, realm, deps: { syncLimiter: LoginLimiter; trustProxyHops: number })`
  - `kosyncAuth(prisma, deps: { syncLimiter: LoginLimiter; trustProxyHops: number })`
  - `CreateOpdsRouterDeps` gains `syncLimiter?: LoginLimiter; trustProxyHops?: number`
  - `createKosyncRouter(prisma, deps?: { syncLimiter?: LoginLimiter; trustProxyHops?: number })`. When `syncLimiter` is omitted, each router builds its own `createLoginLimiter({ ...SYNC_LOCKOUT, label: 'Sync' })`, which tests rely on. Task 5 makes `createServer` pass one shared instance to both.

- [ ] **Step 1: Write the failing tests.** In `kosync.test.ts`, each against `GET /sync/users/auth`:
  - `10 wrong keys then 429 for that user`: the 11th request, even with the right key, gets 429 and the lockout body.
  - `stale device for one user does not lock another user at the same IP` (Review Focus 1): lock alice, then bob with the right key → 200.
  - `missing headers do not count`: 11 requests with no headers → all 401; alice right key → 200.
  - `success clears`: 9 wrong, 1 right, 9 wrong → all 401 except the right one.

  In `opds.test.ts`:
  - `10 wrong Basic passwords then 429`.
  - `no Authorization header (the challenge round trip) does not count` (Review Focus 2): 11 × no header → 401 with `WWW-Authenticate`; then correct credentials → 200.
  - `OPDS and KOSync share a bucket when given one limiter`: mount both routers with one `syncLimiter`. 5 wrong OPDS + 5 wrong KOSync for alice → the next KOSync request is 429.

  In `auth.test.ts`, assert no warn line ever contains the submitted password or key.

- [ ] **Step 2: Run them to see them fail**

  Run: `cd app/server && npx vitest run routes/kosync.test.ts routes/opds.test.ts middleware/auth.test.ts`
  Expected: the new tests FAIL. Existing tests fail to compile until the call sites are updated, so update the call sites in the test files in this step.

- [ ] **Step 3: Implement.**
  - Credentials present: key = `${ip}\u0000${username}`, who = `` `${ip} user "${username}"` ``.
  - `lockedForMs` set → `sendLocked`, with no `WWW-Authenticate` (a 429 is not a challenge).
  - Otherwise `begin`, then `authenticate`. Success → `succeeded()`. Failure → leave the failure counted.
  - The no-credentials branches don't touch the limiter.

- [ ] **Step 4: Run the tests to see them pass**

  Run: `cd app/server && npx vitest run routes/kosync.test.ts routes/opds.test.ts middleware/auth.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add app/server/middleware/auth.* app/server/routes/opds.* app/server/routes/kosync.* app/server/routes/ui.ts
  git commit -m "feat(auth): lock out repeated sync-password failures on OPDS and KOSync"
  ```

---

### Task 4: GraphQL password mutations take an argon slot

**Files:**
- Modify: `app/server/graphql/schema/user/mutation/change-password.ts`, `app/server/graphql/schema/user/mutation/register.ts`
- Modify: `docs/superpowers/specs/2026-11-25-login-protections-design.md` (Check cap section: GraphQL mutations wait for a slot; REST refuses)
- Test: the existing `change-password.test.ts` and `register.test.ts` next to them

**Interfaces:**
- Consumes: `argonSlots` from Task 1 (imported directly, not added to `Context`).

- [ ] **Step 1: Write the failing tests.** In each test file, add `waits for an argon slot when both are taken`: acquire both `argonSlots` slots, fire the mutation, `await` a tick and assert it hasn't resolved, release one, then assert the normal success payload. Release everything in `afterEach`, since the singleton is shared across tests.

- [ ] **Step 2: Run them to see them fail**

  Run: `cd app/server && npx vitest run graphql/schema/user/mutation/change-password.test.ts graphql/schema/user/mutation/register.test.ts`
  Expected: the new tests FAIL. The mutation resolves while the slots are full.

- [ ] **Step 3: Implement.** `const release = await argonSlots.acquire()`, released in `finally`. In change-password, hold one slot across `validateUser` and `hashLoginPassword`; in register, around `hashLoginPassword`. Edit the spec's Check cap paragraph to say the same.

- [ ] **Step 4: Run the tests to see them pass**

  Run: same command. Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add app/server/graphql/schema/user/mutation/ docs/superpowers/specs/2026-11-25-login-protections-design.md
  git commit -m "feat(auth): argon slot for password GraphQL mutations"
  ```

---

### Task 5: Security headers and server wiring

**Files:**
- Create: `app/server/middleware/security-headers.ts`, `app/server/middleware/security-headers.test.ts`
- Modify: `app/server/server.ts`
- Modify: `app/server/routes/ui.ts` (cover route: headers before the 304 branch)

**Interfaces:**
- Consumes: Task 3's router deps.
- Produces: `export const CONTENT_SECURITY_POLICY: string` (the exact value in Global Constraints) and `export function securityHeaders(): RequestHandler`.

- [ ] **Step 1: Write the failing tests** in `security-headers.test.ts`, on a small express app with `securityHeaders()` first, plus stub routes `GET /api/x`, `POST /graphql`, `GET /mcp/oauth/authorize`, `GET /` (HTML), `GET /opds/x`, and `GET /api/covers/x`, which does `res.set('Cache-Control', 'public, max-age=86400'); res.set('ETag', '"e"')`:
  - every route has the CSP (string equal to `CONTENT_SECURITY_POLICY`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`.
  - `/api/x`, `/graphql`, `/mcp/oauth/authorize` have `Cache-Control: no-store`; `/` and `/opds/x` do not.
  - `/api/covers/x` keeps `public, max-age=86400` and its ETag (Review Focus 4).
  - `CONTENT_SECURITY_POLICY` contains `img-src 'self' data: blob:` and `worker-src 'self'`.

  Also add tests against the real `GET /api/books/:id/cover` in `ui.test.ts`, mounted behind `securityHeaders()` (add it to `buildApp`):
  - `cover keeps its Cache-Control`: with `?v=1` → `private, max-age=31536000, immutable`; without → `private, max-age=0, must-revalidate`.
  - `cover 304 carries the cover Cache-Control, not no-store`: repeat with `If-None-Match` set to the first response's ETag → 304 with the same `Cache-Control` as the 200.

- [ ] **Step 2: Run to see it fail**

  Run: `cd app/server && npx vitest run middleware/security-headers.test.ts`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement and wire.**
  - `securityHeaders()` sets the four headers on every request. It adds `Cache-Control: no-store` when `req.path` starts with `/api/`, `/graphql` or `/mcp`. Routes that call `res.set('Cache-Control', …)` later overwrite it.
  - In `routes/ui.ts`'s cover route, move the `Cache-Control` (and `ETag`) `res.set` calls above the `if-none-match` → 304 branch, so both responses carry them.
  - In `createServer`:
    - Call `server.disable('x-powered-by')`.
    - Mount `securityHeaders()` as the first middleware, before `requestTimeout`.
    - Build one `createLoginLimiter({ ...SYNC_LOCKOUT, label: 'Sync' })` and pass it, plus `config.trustProxyHops ?? 0`, to both `createOpdsRouter` and `createKosyncRouter`.

- [ ] **Step 4: Run to see it pass**

  Run: `cd app/server && npx vitest run middleware/security-headers.test.ts routes/ui.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add app/server/middleware/security-headers.* app/server/server.ts app/server/routes/ui.ts app/server/routes/ui.test.ts
  git commit -m "feat(server): security headers on every response, shared sync limiter"
  ```

---

### Task 6: Full verification and CSP check in a real browser

**Files:** none changed unless a check fails. If one does, fix it in the owning task's files and commit with that task's prefix.

- [ ] **Step 1: Lint and the whole test suite**

  Run: `npm run lint && npm test` (repo root)
  Expected: both exit 0.

- [ ] **Step 2: Build and run the production server with demo data.** Use the project's `run` skill to start the app the way it is served in production, so the headers come from Express and not Vite, with `SEED_DEMO=1` and a `SEED_PASSWORD`. Confirm the headers with `curl -sI http://localhost:<port>/` showing the CSP.

- [ ] **Step 3: Check the client under the CSP.** Write a small Playwright script in the scratchpad that:
  - logs in as the demo user;
  - visits the library grid (covers load as blob URLs), a book page and the MCP `/connect` consent page;
  - takes a screenshot of each;
  - collects every console message containing `Content-Security-Policy`.

  Expected: no CSP console messages, and the covers render in the screenshots. View each PNG.

- [ ] **Step 4: Check the lockout end to end.** Use `curl` against the running server:
  - 5 wrong `POST /api/login` → the 6th is 429 with `Retry-After`.
  - 10 wrong `GET /sync/users/auth` for one user → the 11th is 429.
  - A different user's request is unaffected.
  - The server log has exactly one lockout `warn` line per lock.

- [ ] **Step 5: Stop the server.** Report the results to the user, with the screenshots, before any PR.
