> Preserved 2026-08-02 from the pre-client-polish planning session scratchpad. Commit reviewed: `8aa685c5`. Covers: operational/security/debt hygiene review of `app/server/` — decision-gate pressure-testing, production posture, CORS/body-limit/depth-limit/observability gaps, security spot-checks, and located debt items/dead code. Content below is verbatim from the source review.

# Bookplate server — pre-client-migration hygiene & debt review

Scope: `app/server/` at `8aa685c5` (branch `graphql-migration`), suite 1698/1698.
Lens: operational / security / debt items that are **cheaper to fix before the client migrates** than after.

Ranking key:
- **FIX-BEFORE-CLIENT** — the client migration either makes it worse, entrenches it, or is the last cheap moment.
- **FIX-WHENEVER** — real, but migration-neutral.
- **ACCEPT** — checked, sound, no action.

---

## 0. Executive summary

The migration itself is in good shape. Auth scoping, the `mustChangePassword` parity, `authorizeOnSubscribe`, staging TTL/kind isolation, and refresh-token revocation all hold up under fresh scrutiny — several of them are better than the REST paths they mirror. The debt is not in the schema; it's in the **edges around the yoga mount**: CORS, body limits, query cost, and observability were never configured, because the migration's own brief scoped them out.

Seven FIX-BEFORE-CLIENT items. Two of them (CORS + the missing dev proxy entry) are coupled and will be "solved" the wrong way if hit in that order during client work.

---

## 1. Known decision gates + limitations — pressure-tested

### 1.1 Config admin cannot stage → loses GraphQL replace / analyze / cover — **FIX-BEFORE-CLIENT**

Recorded in `docs/superpowers/specs/2026-07-30-graphql-server-design.md:694`, `:1240`, `:1279`.

Mechanism, verified:
- `POST /api/books/replace-staging` and `/cover-staging` gate on `requireUserId` (`app/server/routes/ui.ts:1337`, `:1384`). The config admin has no users row, so `req.user.userId` is unset → 401. It can never stage.
- Consumers fail the same way from the other end: `app/server/graphql/schema/book/mutation/analyze-replace.ts:161-173` does
  ```ts
  const callerUserId = context.viewer!.userId;
  const staged = callerUserId === null ? null : context.stores.replaceStaging.resolve(...);
  if (staged === null) return stagedUploadNotFoundError();
  ```
  Same shape in `book/mutation/replace.ts:217` and `book/mutation/update-metadata.ts:396`.

Still sound as an *analysis*: yes. The staged file must be keyed to the authenticated caller, never a `?user=`-named target — that reasoning is correct and should not be relaxed.

**But the urgency changed.** While the client was REST-only this was invisible. Once the client migrates, an admin session loses replace, analyze-replace, and staged-cover entirely unless the client keeps a **permanent second code path** on legacy REST (`/api/books/:id/replace/analyze`, `/api/books/:id/replace`, `PATCH /api/books/:id/metadata` multipart) selected on `viewer.isAdmin`. That fork then never goes away, and the legacy-route-deletion gate never opens.

Cheap fix, server-side, before the client forks: give the config admin a **stable synthetic staging key** rather than `null`. The registry key is opaque and never joined against the users table — it only has to be stable and unforgeable per session identity. Something like `configAdminKey(config.username)` returning `` `config-admin:${username}` `` used in exactly the four places that read `viewer.userId` for staging. The `?user=`-target invariant is untouched (the key is still derived from the *authenticated* identity, never the resolved book owner).

Cost now: ~4 call sites + `requireUserId` → a `stagingIdentity(req)` helper, plus tests. Cost later: a permanent dual-transport fork in the client plus a legacy-route gate that stays shut forever.

### 1.2 GraphQL change-password = silent logout — **FIX-WHENEVER**, but the recorded premise is wrong

Recorded at `app/server/graphql/schema/user/mutation/change-password.ts:126-155` and `app/server/graphql/context.ts:60-78`. The behaviour trace is exactly right: `revokeAllForUsername` (`:186`) kills every refresh row including the caller's own, so `POST /api/auth/refresh` 401s, and the stale access token keeps `mustChangePassword: true` for up to 15 min. Fails closed. Correct.

The *reason* given for not fixing it is inaccurate. Both files state that no Response object reaches the context:

> "yoga's context ... only ever sees the fetch `Request`, never a `Response` to set cookies on, so there is no channel to reissue tokens from here."

That is not true for this mount. The handler is mounted as Express middleware (`app/server/server.ts:52`), so it goes through the whatwg-node request-listener path, and `node_modules/@whatwg-node/server/typings/types.d.cts:13` states plainly:

> "If you use `requestListener`, the server context is `{ req: IncomingMessage, res: ServerResponse }`."

Express's `res` is that same object, so `res.cookie()` is reachable from the context factory — `createContext` would just take `res` alongside `request`. Node merges `setHeader`-set headers into a later `writeHead`, so a `Set-Cookie` written before yoga serializes its response should survive.

Two honest options, pick one:
1. **Correct the docs.** Change "there is no channel" → "we deliberately keep the context Response-free so resolvers cannot write transport-level state." That is a defensible design rule and makes the limitation intentional rather than forced.
2. **Fix it** by threading `res` in and reissuing. Requires a test proving the `Set-Cookie` survives yoga's `writeHead` — do not ship this on the strength of the typings alone.

Client impact either way: the migrating client **must** treat `userChangePassword` success as "log out, go to /login". Simplest near-term answer is to leave change-password on REST `/api/my/password`, which reissues seamlessly.

Related, minor: `userChangePassword`'s `authScopes` requires `context.viewer.userId === args.input.userId.id`. The config admin's `userId` is `null`, so it can never satisfy this — the config admin cannot change its password over GraphQL at all. Correct (its password lives in `config.yaml`), but undocumented at the field.

### 1.3 REST-initiated scans emit start/terminal only — **FIX-WHENEVER (one line + a dedupe)**

Verified: `app/server/routes/ui.ts:1069` calls `bookStore.scan(owner)` with no `onProgress`, so a REST-started scan reaches `ScanJobStore` only via `start`/`complete`/`fail`. `libraryScan` (`app/server/graphql/schema/library/mutation/scan.ts:80`) passes the callback and gets full per-file progress.

The recorded rationale was the migration's "no `routes/` edits" constraint. **That constraint has expired.** The fix is literally passing `(progress) => scanJobStore.progress(owner.userId, progress)` as the third argument.

Worth doing together with the duplication it sits in: `scan.ts:60-95` is documented as reproducing the REST pipeline "line for line" — `bookStore.scan` → `revalidateLibrary` → `thumbnailQueue.reconcile` → same `log.info`/`log.error` wording → `scanJobStore.complete/fail`. Two copies of the same orchestration in two transports. Extract to `services/run-library-scan.ts` and have both call it; the `onProgress` asymmetry disappears as a side effect rather than as a separate patch.

Urgency: low. The client will drive scans through `libraryScan`, so it gets the good path. It matters only for the startup scan and any remaining REST caller.

### 1.4 Staged uploads survive `userDelete` until TTL — **FIX-WHENEVER (low)**

Confirmed: no `userDelete` path touches `replaceStaging`. Neither `app/server/routes/users.ts:80-91` nor `app/server/graphql/schema/user/mutation/delete.ts` has a hook; the only callers of the service are the two staging routes and the three consuming mutations.

Actual exposure is small and I'd resist over-fixing it: the entries are keyed by `userId`, and `findOwned` requires an exact `userId` match, so a deleted user's staged bytes are **unreachable** the moment the row is gone — no reassignment risk (ids are `randomUUID`, not sequential). It is purely orphaned disk, bounded at 30 min, and the directory scan in `sweep()` reclaims it on the next `stage()` from anyone.

Only real edge: a server where nobody stages again leaves the files until the next `stage()`. Same class as I-1, which `findOwned` already fixed for the reachable path. If you want it closed, the cheapest honest fix is a periodic sweep timer rather than a `userDelete` hook — it covers this *and* the "quiet server" case with one mechanism.

---

## 2. Production posture

### 2.1 `isProduction` wiring — **ACCEPT (this is done right)**

`app/server/index.ts:84`: `isProduction: process.env.NODE_ENV !== 'development'`.

I went looking for the usual bug here and it isn't present. Nothing in the shipped image sets `NODE_ENV` — `run.sh` is a bare `exec node /bookplate/app/server/dist/index.js`, the `Dockerfile` has no `ENV NODE_ENV`, and `docker-compose.yml` doesn't set it. A conventional `=== 'production'` test would therefore have left **every real deployment in dev mode** with GraphiQL served and errors unmasked. The inverted test fails closed, and `app/server/package.json`'s `dev` script sets `NODE_ENV=development` explicitly to opt back in. The reasoning is recorded at `index.ts:79-83`.

Consequences, all correct:
- GraphiQL off in prod (`yoga.ts:75`), `maskedErrors` on (`:76`), `landingPage: false` (`:77`).
- Introspection off in prod via `NoSchemaIntrospectionCustomRule`, **plus** the "Did you mean" suggestion stripper (`yoga.ts:38-56`) — that second half is a genuinely good catch, since validation suggestions leak field names even with introspection disabled.

One DX nit: `npm run dev -w app/server` sets the flag, but running `tsx index.ts` or `node dist/index.js` directly does not, so ad-hoc local runs get no GraphiQL. Worth a line in the README rather than a code change.

### 2.2 CORS on `/graphql` is wide open — **FIX-BEFORE-CLIENT**

`createYoga` in `app/server/graphql/yoga.ts:70-80` passes no `cors` option. Yoga then installs `useCORS` with `corsOptionsFactory = () => ({})` (`node_modules/@whatwg-node/server/cjs/plugins/useCors.js:83`), and that empty object takes the most permissive branch of `getCORSHeadersByRequestAndOptions`:

```js
if (corsOptions.origin == null || corsOptions.origin.length === 0 || corsOptions.origin.includes('*')) {
    headers['Access-Control-Allow-Origin'] = currentOrigin;   // reflects the caller's Origin
    headers['Vary'] = 'Origin';
}
...
else if (headers['Access-Control-Allow-Origin'] !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';      // and credentials, because ACAO !== '*'
}
```

So **every origin on the internet gets `Access-Control-Allow-Origin: <its own origin>` plus `Access-Control-Allow-Credentials: true` on `/graphql`.** The REST surface has no CORS middleware at all, so browsers block cross-origin reads there. That is a real REST/GraphQL asymmetry, and it is the answer to the "does the coexistence create anything" question.

Not exploitable today, and I want to be precise about why, because the reason is load-bearing:
- `/graphql` authenticates **only** from the `Authorization` header (`app/server/graphql/context.ts:100-111`, `viewerFromHeader`). It never reads cookies.
- The only cookie in the system is `refresh_token`, set `httpOnly`, `sameSite: 'strict'`, `path: '/api/auth'` (`app/server/routes/ui.ts:91-96`) — it is not sent to `/graphql` under any circumstances.

So an attacker page gets a 401 today. The problem is that this is defence-in-depth that has already been spent, and the migration is exactly when someone reaches for cookie auth on `/graphql` to avoid token plumbing. The day that happens, this configuration is instant cross-origin account takeover with no other change required.

Fix: `cors: false` in `createYoga`. The client is same-origin in production (Express serves the SPA from the same process). Which brings us to the coupled item.

### 2.3 The Vite dev proxy has no `/graphql` entry — **FIX-BEFORE-CLIENT**

`app/client/vite.config.ts:16-19` proxies only `/api` and `/logout`. The dev client runs on `:5173`, the server on `:3000`.

The moment the client issues its first `/graphql` request in dev, it hits the Vite dev server and falls through to the SPA's `index.html`. The obvious-looking fix is to point the GraphQL client at `http://localhost:3000/graphql` — which **works**, because of 2.2, and thereby entrenches the open CORS config as load-bearing for local dev.

Do these two together, in this order:
1. Add `'/graphql': apiUrl` to the Vite proxy.
2. Set `cors: false` in `createYoga`.

Done in that order, dev is same-origin through the proxy and nothing needs CORS. Done in the other order, or not at all, you will end up defending the reflected-origin config.

Note the proxy also needs to not buffer for the SSE subscription; Vite's `http-proxy` passes `text/event-stream` through fine, but verify the subscription actually streams in dev rather than accumulating.

### 2.4 No request-size limit on `/graphql` — **FIX-BEFORE-CLIENT**

`app/server/server.ts:52` mounts the yoga handler **before** `express.json()` (`:54`), deliberately and correctly — yoga reads the raw body itself and a parser upstream would consume it (the reasoning is at `server.ts:46-51`).

The side effect is that no body limit applies to `/graphql` at all. REST bodies are capped at body-parser's 100kb default; multer caps uploads at 200MB (`epubUpload`) and 10MB (`coverUpload`), `routes/ui.ts:128-141`. `/graphql` is capped at nothing.

Worse, the body must be fully read to extract the query, which happens **before** the context factory's auth check. So this is an **unauthenticated** memory-pressure vector: `POST /graphql` with a multi-GB body is buffered and only then 401'd.

Fix: mount a size guard ahead of the handler, e.g. `server.use('/graphql', express.raw({ type: '*/*', limit: '1mb' }))` won't work (it consumes the body) — instead gate on `Content-Length` in a tiny middleware, or use `express.text({ limit })` and hand yoga the parsed body via its `parseRequestBody`/plugin seam. Simplest reliable option: a 4-line middleware rejecting `Content-Length > 1mb` with 413 before the handler, accepting that a chunked request without `Content-Length` needs a streaming counter. 1MB is generous — the largest persisted query in this schema is far under it.

### 2.5 No query depth / complexity / alias limits — **FIX-BEFORE-CLIENT**

No cost analysis is installed. Introspection being off in prod raises the bar only slightly: the full SDL is committed at `app/server/graphql/schema.generated.graphql`, and the migrating client ships its operations.

There is a concrete amplification cycle in the schema:

```
Book.series: Series  →  Series.books(first: N): SeriesBooksConnection  →  node: Book  →  Book.series: Series  →  …
```

Every hop takes its own `first`, and `Library.entries` clamps `first` to 1..100 (`library/model.ts:123`) but `Series.books` is a separate connection. A depth-10 nesting with `first: 100` at each level is a straightforward authenticated database amplification. Aliases multiply it further with no limit.

(I checked the other candidates and they're clean: `Book` has no `owner`/`library` back-reference, and `Progress` has no `library` field — the `library: Library` occurrences in the SDL are mutation *payloads*, which don't form cycles. `Series` is the only one.)

Fix: a max-depth validation rule. `yoga.ts` already has the plugin seam (`useSchemaConcealment` adds a validation rule via `onValidate`/`addValidationRule`), so this is ~15 lines hand-rolled, or `@escape.tech/graphql-armor-max-depth` + `-max-aliases` if you'd rather take the dependency. Unlike the concealment plugin, install it in **all** environments, not just production — you want the dev client to hit the ceiling first.

### 2.6 Batching — **ACCEPT**

Yoga does not enable request batching unless `useBatching`/`batching` is configured, and it isn't. Nothing to do.

### 2.7 No rate limiting anywhere — **FIX-WHENEVER**

`grep -riE 'rate.?limit|helmet|throttle'` over `app/server/` returns nothing. In particular `POST /api/login` (`routes/ui.ts:186-219`) has no attempt limiting, so it is open to unauthenticated credential brute-force at whatever rate the box sustains. Argon2 hashing is the only brake, and for the config-admin branch it's a plain string comparison with no hashing cost at all (`ui.ts:193`).

Migration-neutral, so not before-client: **`/graphql` has no unauthenticated fields whatsoever** — login, refresh and public config all stay on REST (`builder.ts`, `queryType`/`mutationType`/`subscriptionType` all carry `authenticated: true`, and `root-auth.test.ts` walks the built schema to enforce it). So the migration adds no new unauthenticated surface. But note that `/graphql` would also bypass any REST rate limiter added later, since it's mounted first and outside every router — worth keeping in mind so the limiter goes on `server.use(...)` at the top rather than per-router.

Also absent: `helmet` / security headers (`X-Content-Type-Options`, `X-Frame-Options`, HSTS, CSP). Pre-existing.

---

## 3. Security spot-checks (fresh eyes)

### 3.1 Staging TTL / eviction under clock skew — **ACCEPT**

`app/server/services/replace-staging.ts`. The design holds up:
- TTL is enforced in **two** places with one shared boundary definition — `sweep()` (lazy, on `stage()`) and `findOwned()` (on every `resolve`/`consume`). Both use `createdAt < now() - ttlMs`, so exactly-`ttlMs`-old is not expired in either. No drift.
- The `findOwned` check is what closes the "quiet server never sweeps" hole (recorded as reviewer finding I-1). Confirmed present at the read path, not just the write path.
- `consume()` is fully synchronous between lookup and unlink, so two concurrent finalizers genuinely cannot both succeed — that's stronger than merely tolerating a double-delete.
- Denial is uniform across unknown / expired / foreign / kind-mismatched. Kind is checked alongside `userId` in the same predicate. No oracle.
- `extensionFor` uses a fixed allowlist and never derives any part of the filename from the client-supplied `mimeType`. The traversal and `ENAMETOOLONG` concerns are genuinely closed, including the Windows `\` case.

Clock skew: `now` defaults to `Date.now()`, which is wall-clock and not monotonic. A backwards NTP correction extends effective TTL; a forward jump expires entries early. Bounded at 30 min, affects only staged temp files, and the failure mode is a re-upload. Switching to `performance.now()`-based timing would complicate the `mtime`-based orphan scan (which is inherently wall-clock, since it must survive restarts) for no real gain. **Accept.**

Missing, though — see 4.x below: there is **no per-user quota** on staged uploads.

### 3.2 SSE subscription resource lifecycle — **ACCEPT (no leak)**

Traced end to end:
- `Subscription.scanProgress`'s `subscribe` is an async generator doing `for await (const job of context.stores.scanJob.subscribe(owner.userId))` (`library/subscription/scan-progress.ts`).
- That delegates to `ScanJobStore.subscribe` → `publisher.subscribe('scan', userId)` → yoga's `createPubSub`, which returns a `Repeater` registering exactly one listener and de-registering it on stop:
  ```js
  return new Repeater(function subscriptionRepeater(next, stop) {
      stop.then(() => target.removeEventListener(topic, pubsubEventListener));
      target.addEventListener(topic, pubsubEventListener);
      ...
  });
  ```
  (`node_modules/@graphql-yoga/subscription/cjs/create-pub-sub.js:22-30`)

On client disconnect yoga calls `.return()` on the outer generator; per async-generator semantics the suspended `for await` calls `.return()` on the inner iterator, the Repeater's `stop` resolves, and the listener is removed. **An abandoned SSE connection does not leak a pubsub subscription.** No manual cleanup needed and none is missing.

Supporting checks, all fine:
- `requestTimeout(90_000)` (`server.ts:29`) does not kill the stream: it bails on `res.headersSent`, which SSE sets immediately, and the timer is cleared on `finish`/`close`. Reasoning recorded at `server.ts:49-51`; verified against `middleware/timeout.ts`.
- Yoga sends a `:\n\n` ping every 12s (`graphql-yoga/cjs/plugins/result-processor/sse.js:11,31-38`), which keeps the connection under Cloudflare's ~100s idle timeout during the long gaps between scans. Nothing to add.

Two small notes, neither a leak:
- **nginx buffering** — no `X-Accel-Buffering: no` header is set. Cloudflare doesn't buffer `text/event-stream`, but anyone fronting this with default nginx will see the subscription stall. One header if you want to be friendly to self-hosters. *(FIX-WHENEVER)*
- **Max-listener warning** — `@whatwg-node/events` resolves to Node's global `EventTarget`, which emits `MaxListenersExceededWarning` past 10 listeners for a given type. Topics are per-user, so this triggers when one user opens 11+ concurrent subscriptions (tabs). Log noise only. `events.setMaxListeners(0, target)` in `pubsub.ts` silences it. *(FIX-WHENEVER, cosmetic)*
- No cap on concurrent subscriptions per user. Each is cheap (one listener + one open socket), so this is bounded by socket limits rather than being a distinct vector. **Accept.**

### 3.3 Refresh-token revocation coverage — **ACCEPT**

Traced every path in `app/server/services/token-store.ts` and its callers:

| Event | Revoked? | Where |
|---|---|---|
| Refresh used | Yes — rotated atomically | `DELETE … RETURNING` in one statement, `token-store.ts:58` |
| Logout | Yes | `routes/ui.ts:270` |
| Self password change (REST) | Yes, all for username | `routes/ui.ts:420` |
| Self password change (GraphQL) | Yes, all for username | `user/mutation/change-password.ts:186` |
| Admin password reset (REST) | Yes, all for username | `routes/users.ts:108` |
| Admin password reset (GraphQL) | Yes, all for username | `user/mutation/reset-password.ts:99` |
| Expired rows | Swept on every login | `routes/ui.ts:197`, `:209` |
| User deleted | **No** — but see below | — |

Rotation is a single `DELETE … RETURNING` (`token-store.ts:57-58`), so it's atomic — a replayed token cannot be consumed twice even under concurrency. Expiry is re-checked on the returned row (`:61`) rather than trusted from the delete. Good.

REST/GraphQL parity on the two password paths is complete for the security-relevant half (revocation). Only the convenience half (cookie reissue) diverges — that's §1.2.

`userDelete` not revoking is **not** a hole: `POST /api/auth/refresh` rebuilds claims from current state and rejects when the username no longer resolves (`routes/ui.ts:248-253`), so an orphaned refresh row is dead on use. Only the deleted user's already-issued **access** token survives, for the remainder of its 15-minute TTL — identical to REST's behaviour, and unavoidable with stateless JWTs. Accept. (Cleaning the orphan rows is cosmetic; the login-time `deleteExpired` sweep gets them within TTL anyway.)

### 3.4 CSRF asymmetry from REST+GraphQL coexistence — **ACCEPT (no asymmetry)**

This was the item I most expected to find something in, and it's clean:
- `/graphql` derives the viewer **only** from `Authorization: Bearer` (`context.ts:100-111`). It reads no cookies and `cookieParser` is mounted after it anyway (`server.ts:56`).
- The single cookie, `refresh_token`, is `httpOnly` + `sameSite: 'strict'` + `path: '/api/auth'` (`ui.ts:91-96`), so it is never attached to a `/graphql` request nor to a cross-site request to `/api/auth/*`.
- Therefore a cross-origin `POST /graphql` carries no ambient credential and 401s. No CSRF token needed, and yoga's `useCSRFPrevention` would be redundant.

The same session **is** usable on both transports (same access token), but since neither transport uses ambient cookie credentials for API calls, there's no confused-deputy surface. The CORS finding in §2.2 is a separate issue and is about response *readability*, not CSRF.

One thing to preserve explicitly during the client migration: **do not move `/graphql` to cookie auth.** If that ever happens, §2.2 becomes critical and `useCSRFPrevention` becomes mandatory. Worth a comment in `context.ts` next to `viewerFromHeader` saying so.

### 3.5 Observability collapse on `/graphql` — **FIX-BEFORE-CLIENT**

`middleware/request-log.ts` logs `method originalUrl → status (ms)`. Today that's a per-endpoint audit trail. After the client migrates, essentially the whole application collapses into repeated:

```
POST /graphql → 200 (14ms)
```

and because GraphQL returns errors inside a 200 body, the `statusCode < 400` branch demotes it to **debug** — meaning a failing mutation is, by default, *less* visible than it is today. The current `requestLog` heuristic ("mutations and non-2xx log at info") inverts precisely backwards for GraphQL.

Compounding it: `maskedErrors: true` in production means the client sees only "Unexpected error." The `yoga.ts` `logging` bridge (`:81-86`) is what routes the real error to the operator, and its doc comment correctly identifies this as "the only channel by which a real failure reaches an operator" — but it captures yoga's *internal* logging, not per-operation outcomes.

Fix before the client migrates, because that's when the trail goes dark: a small yoga plugin on `onExecute`/`onResultProcess` logging `operationName`, duration, and error count — at `info` when `errors.length > 0`. ~20 lines in `yoga.ts` next to the existing plugin. Also consider excluding `/graphql` from `requestLog` so you don't emit two lines per request.

---

## 4. Additional findings not in the recorded gates

### 4.1 `Library.book(id: String!)` takes a raw local id — **FIX-BEFORE-CLIENT (schema-visible)**

`app/server/graphql/schema/library/model.ts:100-109`:
```ts
book: t.prismaField({
  type: book,
  nullable: true,
  args: { id: t.arg.string({ required: true }) },
  resolve: (query, owner, args, context) =>
    context.prisma.book.findUnique({ ...query, where: { userId_id: { userId: owner.userId, id: args.id } } }),
}),
```

The Book-Relay-ID pass (commits `30764e89`, `7051065a`, `b8fb8976`) made the global ID the *only* book identifier — `Book.bookId` was removed outright. But this field still takes a **raw local** book id, so a client holding a `Book.id` from any other part of the schema cannot feed it here without decoding the global ID itself — which is exactly the operation the migration just removed the ability to do cleanly.

This is the last cheap moment: no client depends on it yet. Either make it `t.arg.globalID({ for: book })` for consistency, or delete it in favour of the root `node(id:)` field, which already resolves a `Book` global ID. My preference is delete — `node(id:)` covers it, and `Library.book` duplicates a lookup the Relay spec already standardises.

Worth a broader pass on the same axis before the client locks in: `Library.seriesByName(name:)`, `Library.seriesNextIndex(name:)` and `Series` are name-keyed, which is a defensible domain choice, but confirm no other field takes a raw id.

### 4.2 No per-user quota on staged uploads; one unbounded upload route — **FIX-WHENEVER**

- `POST /api/books/replace-staging` uses `epubUpload` = **memoryStorage** with `fileSize: 200MB` (`routes/ui.ts:136-142`). Each concurrent staging upload holds up to 200MB in the Node heap before it's written to disk. A handful of concurrent uploads will OOM a small container. Disk storage with a move-into-place would be strictly better here, since the bytes go to disk immediately anyway (`replace-staging.ts` `stage()` does `fs.writeFileSync`).
- Nothing caps the *number* of staged files per user. Within one 30-minute TTL window a single authenticated user can stage arbitrarily many 200MB files; `sweep()` only reclaims entries older than the TTL, so peak disk is unbounded by design.
- Separately: `upload` (the diskStorage multer used by `POST /api/books/upload`, `routes/ui.ts:120-126`) has **no `limits` at all** — no `fileSize`, no `files`. Only an extension filter. That's a pre-existing REST issue, not a migration artifact, but it's the same file and worth fixing in the same pass.

### 4.3 Both Pothos `errors` and `validation` plugins are registered with zero usages — **FIX-WHENEVER (clean deletion)**

`app/server/graphql/schema/builder.ts:66` registers `[RelayPlugin, ScopeAuthPlugin, ErrorsPlugin, PrismaPlugin, ValidationPlugin]`.

- `ErrorsPlugin`: the builder comment (`:57-64`) already documents it as deliberately inert — every error type in the schema is a plain data shape carrying `owner: Owner`, not an error *class*, so `extractAndSortErrorTypes` can't accept them and no field declares an `errors:` option. Confirmed: `grep -rn "errors: {" graphql/schema` (excluding tests) returns **nothing**.
- `ValidationPlugin`: **also unused, and this one is not documented anywhere.** `grep -rn "validate:" graphql/schema` (excluding tests) returns **nothing**. Validation is done with hand-rolled zod `safeParse` inside resolvers (e.g. `analyze-replace.ts:152`, `replace.ts:202`), which is the right call given the error-shape convention — but it means the plugin is pure overhead.

Both wrap every field resolution for no benefit. Removing them is a genuinely clean commit: two lines in `builder.ts`, two entries out of `app/server/package.json` (`@pothos/plugin-errors`, `@pothos/plugin-validation`), and the `builder.ts:57-64` comment shrinks to nothing. The schema snapshot should be byte-identical — `npm run graphql:schema:check` proves it.

---

## 5. Accepted-debt roll-up — triage

See §6 for the located line numbers.

**Worth one cleanup commit now** (mechanical, no schema change, reduces friction during client work):
- The ~12 duplicated local `bookGlobalId` test helpers → one export in `graphql/test-util.ts`. This is the highest-value item in the list: every new client-facing test written during the migration would otherwise copy a 13th.
- Any remaining `rawBookId` references. `8aa685c5` fixed two comments; residue should go with them so nobody greps it up and thinks the field still exists.
- Edition-cache `log.warn` wording — one string.
- The unasserted `book { id }` selection and the enqueue-spy nit — both one-line test edits, do them in the same commit or drop them permanently.

**Worth doing, needs a test rather than an edit:**
- `stagedCoverId.min(1)` untested — pin it. It's on a security-adjacent path (staged-upload resolution) and costs one `it()`.
- The empty-local-id arm — same reasoning; an unpinned branch on an ID-decoding path is the kind of thing that silently changes behaviour under a Pothos/relay upgrade.

**Fine forever, don't spend the commit:**
- Real-timer SSE test sleeps. Converting a subscription test to fake timers tends to make it test the mock rather than the plumbing, and the plumbing (§3.2) is the part worth testing. Accept the seconds.
- `device` free-form label param — free-form is the intended UX for a user-assigned device name; there's nothing to validate against beyond length.

**Wants a decision from you before anyone touches it:**
- The edition-cache warn wording. It is *not* a wording nit — the GraphQL helper flattens an asymmetry that REST actually has, and the file's own doc comment transcribes REST correctly and then contradicts itself in the code. Three tests pin it. See §6.1 item 10.

**Correction to the brief's framing:** I had provisionally flagged `bookType` as schema-visible and therefore before-client. **It is not.** There is no `bookType` in the SDL at all — it's a TypeScript import-alias inconsistency, split 5/5 across the book mutations. It stays in the mechanical pile. See §6.1 item 1.

---

## 6. Located debt items and dead code

*(Populated from the two sweep agents; see the notes below each.)*

### 6.1 Debt-item locations

**First, a meta-finding worth acting on: the accepted-debt list is not in the repo.** A sweep of `docs/superpowers/plans/*.md`, `docs/superpowers/specs/*.md`, `.superpowers/*.md` and the last 40 commit messages for "accepted minor" / "debt" / "unpinned" / "nit" turns up nothing. Every item below was matched to code by *behaviour*, not by a recorded note. Three of the ten descriptions in the brief point at the wrong artifact (items 1, 6, 10 below), which is consistent with the list having been written from memory. If it lives in a session transcript or an external doc, commit it alongside the cleanup — otherwise the next reviewer re-derives all of this from scratch.

| # | Item | Location | Class |
|---|---|---|---|
| 1 | `bookType` alias | 5 files, see below | (a) mechanical |
| 2 | Empty local-id arm | `schema/node-scope.ts:83` | (b) needs test |
| 3 | `stagedCoverId.min(1)` | `book/mutation/update-metadata.ts:132` | (b) needs test |
| 4 | Device free-form `label` | `device/mutation/purge-quietly.ts:45-49` | (a) mechanical |
| 5 | `bookGlobalId` duplicates | 11 files, see below | (a) mechanical |
| 6 | Residual raw-`bookId` comments | `device/mutation/update.ts:46-49`, `progress/mutation/set.ts:51-53` | (a) mechanical |
| 7 | Real-timer SSE sleeps | `scan-progress.test.ts` ×4, `scan-progress-sse.test.ts:148`, `scan.test.ts:76` | (b) infra — **leave** |
| 8 | Unasserted `book { id }` | `book/mutation/clear-editions.test.ts:27` → `:72` | (b) 1 line |
| 9 | Enqueue-spy nit | `book/mutation/update-metadata.test.ts:661-745` | (a) 1 word |
| 10 | Edition-cache warn wording | `device/mutation/purge-quietly.ts:53-55` | needs a decision |

All paths relative to `app/server/graphql/`.

**1 — `bookType` is not schema-visible.** No `bookType` field, input or type exists anywhere in `schema.generated.graphql`. What exists is an inconsistent TS import alias for the same `Book` model ref, split 5/5 across the book mutations: aliased `bookType` in `update-metadata.ts:36`, `replace.ts:34`, `link-document.ts:25`, `resolve-pending-fix.ts:27`, `unlink-document.ts:18`; aliased `book` (the majority convention elsewhere) in `validate.ts:6`, `clear-editions.ts:4`, `regen-chapters.ts:14`, `analyze-replace.ts:18`, `delete.ts:7`. Zero API surface. 5 imports + 10 use sites.

**2 — empty local-id arm.** `node-scope.ts:83`, `if (parsed === null) return build(NO_MATCH_USER_ID, localId);`. `parseCompoundId` (`:52-68`) reaches it for `''` because `JSON.parse('')` throws into the catch at `:56`. Pinned only with *non-empty* malformed input (`node-scope.test.ts:67-69`, `validate.test.ts:237-251`); `encodeGlobalID('Book', '')` appears in no test. The arm also forwards `localId` through unchanged as the `id` half and nothing asserts on that. Secondary: `library/entries-cursor.ts:28` has the only literal empty-string early return in a decode helper and **no dedicated test file at all** — `entries.test.ts` exercises only real round-trip cursors.

**3 — `stagedCoverId.min(1)`.** Rule at `update-metadata.ts:132`, rationale at `:119-123`. The `stagedCoverId` describe block (`update-metadata.test.ts:407-745`) covers unknown, expired, foreign and kind-mismatch but never `''`. It is the odd one out — every sibling `min(1)` is pinned: `replace.ts:62`←`replace.test.ts:237`, `analyze-replace.ts:39`←`:263,271`, `unlink-document.ts:54`←`:154,162`, `link-document.ts:60`←`:120`, `progress/mutation/set.ts:65`←`:337`. Copy the `analyze-replace.test.ts:263-272` shape verbatim.

**4 — device `label`.** `purge-quietly.ts:45-49` takes `label` and `detail` as unvalidated strings interpolated into the log line at `:54`. **Not reachable from the API** — all three call sites pass hardcoded literals (`update.ts:184`, `delete.ts:97`, `disable-user.ts:103-106`). The `detail` half does interpolate client-supplied ids (`parsed.data.deviceId`), so if anything this is a mild log-injection surface, not an input-validation one. Narrowing `label` to a string-literal union is compile-time only.

**5 — `bookGlobalId` duplicates: 11, not 12.** Byte-identical 2-line body in each: `book/mutation/` → `analyze-replace.test.ts:81`, `clear-editions.test.ts:50`, `delete.test.ts:41`, `link-document.test.ts:47`, `regen-chapters.test.ts:48`, `replace.test.ts:108`, `resolve-pending-fix.test.ts:106`, `unlink-document.test.ts:64`, `update-metadata.test.ts:82`, `validate.test.ts:63`; plus `pending-fix/model.test.ts:14`. Seven carry a comment naming `delete.test.ts` as canonical, so the extraction target is unambiguous. The "12th" is a miscount — `user/query/get.test.ts:52` is a local *variable* of that name, not a helper. Note the inverse helper `rawBookId` already lives in `book/mutation/test-helpers.ts:119-123`; `bookGlobalId` can't join it there only because `pending-fix/model.test.ts` sits outside that directory, hence `test-util.ts` as the target.

**6 — `rawBookId` is live; the debt is two stale comments.** Correcting the brief: `rawBookId` is a current, exported, widely-imported test helper (`book/mutation/test-helpers.ts:119-123`, used by 5 files). What was removed is the raw `Book.bookId` *field*. Two comments still cite it in the present tense as an id-like field in this schema: `device/mutation/update.ts:46-49` (same file `8aa685c5` touched, 25 lines below the part it fixed) and `progress/mutation/set.ts:51-53`. Already correctly past-tensed and needing no change: `unlink-document.ts:42`, `delete.ts:29`, `update-metadata.ts:112-118`, `link-document.ts:51-56`, `test-helpers.ts:117`. This finishes `8aa685c5`.

**7 — real-timer sleeps total ~560 ms unconditional**: `scan-progress.test.ts:86` (50 ms), `:95` (**300 ms**, clearing the 250 ms coalescing window), `:167` (50), `:200` (50); `scan-progress-sse.test.ts:148` (100); `scan.test.ts:76` (10). The 2000 ms at `scan-progress-sse.test.ts:104` is a `Promise.race` failure guard costing nothing on green. **Do not convert these.** `scan-progress.test.ts:64-71` carries an explicit reasoned comment that real timers are required — `ScanJobStore.apply` reads `Date.now()` directly, and the waits either let the `subscribe` field's real sqlite `loadOwner` round trip reach the `for await` that registers the pubsub listener, or clear the coalescing window. Faking means faking `Date.now()` for `ScanJobStore` *and* inventing a deterministic listener-registered signal. 560 ms is a poor return on that risk.

**8 — unasserted `book { id }`: exactly one.** `clear-editions.test.ts` selects `book { id deviceEditionCount }` at `:27`, types it at `:68`, asserts only `deviceEditionCount` at `:72`. The file already defines the `bookGlobalId` helper it would need (`:50`) and uses it solely to *build* the input at `:61`. One line: `expect(data.book.id).toBe(bookGlobalId(harness.aliceOwner.userId, BOOK_ID));` — exactly the assertion `link-document.test.ts:67` and `resolve-pending-fix.test.ts:290` already make. Every other `book { id }` selection in the suite does assert. **Best value/effort ratio of the ten.**

**9 — enqueue-spy.** `update-metadata.test.ts:661-745`, `vi.spyOn(harness.stores.thumbnail, 'enqueue')` at `:665,682,701,725`. Two candidate weaknesses, neither recorded anywhere: (i) the spies are never restored — `afterEach:35-38` calls `clearAllMocks()`, which clears history but does not undo `spyOn`; this is harmless *only* because `beforeEach:31-33` builds a fresh harness each test, i.e. correct by accident rather than construction (`restoreAllMocks()` is the one-word fix); (ii) the spy passes through to the real `enqueue`, safe only because the harness `ThumbnailQueue` is deliberately never started — documented at both ends (`test-util.ts:112-118`, `update-metadata.test.ts:655-660`), so that coupling is at least visible. The block is otherwise strong; `:677` asserts the post-edit id via `rawBookId`, which is the subtle part.

**10 — edition-cache warn wording is in `purge-quietly.ts`, not `edition-store.ts`.** Correcting the brief: `edition-store.ts`'s only `log.warn` (`:96-98`) is about EPUB validation fallback, unrelated. The real site is `device/mutation/purge-quietly.ts:53-55`, which emits `` `${label} — edition-cache purge failed for ${detail}` `` for all three call sites. But REST's three warns are **not** uniform (`routes/devices.ts`): `:145` and `:170` say `edition-cache purge failed`, while `:228` says `edition purge failed` — no `-cache`. So `deviceDisableUser` diverges from its REST counterpart. The kicker: `purge-quietly.ts:35-38`'s own doc comment transcribes all three REST messages *accurately, including the asymmetry*, and then the code at `:54` flattens it — comment and code disagree. Pinned by three tests (`update.test.ts:241-243`, `delete.test.ts:111-113`, `disable-user.test.ts:136-138`), so this is not a free edit.

**Recommendation on 10:** REST's asymmetry reads like a typo in `routes/devices.ts`, and GraphQL normalising it is arguably the improvement. Since every plan doc treats "`routes/` diff empty" as a hard constraint, the honest fix is to **amend the doc comment at `:35-38` to state the normalisation is deliberate** rather than change code or tests. But it's your call — that's why it's listed separately from the mechanical pile.

**The single cleanup commit** is items 1-6 and 8-9. Item 7 should not be in it; item 10 needs the decision above first.

### 6.2 Dead code

**Genuinely orphaned by the migration — exactly one:**
- **`isKnownStoreError`**, `graphql/to-result.ts:42`. Its only non-test reference is its own declaration. `toResult` (same file, `:85`) does *not* call it — it inlines `expected.some((errorClass) => error instanceof errorClass)` at `:92`. Sole consumer is `to-result.test.ts`. Delete it, or make `toResult` use it.

**Dead module:**
- **`graphql/schema/staged-upload-not-found-error/index.ts`** — the only barrel under `schema/*/` that nothing imports. It's absent from `schema/index.ts`'s side-effect list (`:1-46`), and all three real consumers bypass it, importing `../../staged-upload-not-found-error/model` directly (`book/mutation/replace.ts:33`, `update-metadata.ts:35`, `analyze-replace.ts:17`). Every other `schema/*/index.ts` has at least one importer — this one is an outlier, which also suggests the error type may not be registered in the schema the same way its siblings are. **Worth a look beyond just deleting the file: confirm the type actually lands in the built SDL.**

**Redundant `export` keywords** (~20 symbols exported but referenced only inside their own file): `EditionBuildOptions` (`services/edition-builder.ts:8`), `AnalyzeEpubOptions`/`ApplyAutoAndAcceptedOptions`/`ApplyAutoAndAcceptedResult` (`services/epub-import-pipeline.ts:71,193,199`), `MIMETYPE_PATH`/`EPUB_MIMETYPE` (`services/epub-zip.ts:3,4`), `StagedFile`/`ReplaceStagingDeps` (`services/replace-staging.ts:30,90`), `RefreshIdentity` (`services/token-store.ts:8`), `EditionUserPurger` (`services/user-store.ts:22`), `MetadataField`/`MetadataIssueKind`/`DetectInput` (`utils/metadata-issues.ts:1,3,30`), `ARTIFACT_PATH` (`graphql/print-schema.ts:6`), `ConfigView` (`graphql/schema/config/model.ts:12`), `EditLineageEntryErrorShape`/`LineageEntryNotFoundErrorShape`, `ExecuteOptions` (`graphql/test-util.ts:29`), `MutationResult` (`graphql/to-result.ts:40`), `GraphqlHandlerDeps` (`graphql/yoga.ts:11`). Cosmetic — most are types, and several are plausibly exported for documentation value. Low priority; don't let it bloat the cleanup commit.

Separately confirmed, correcting two things that *look* dead but aren't:
- `TokenStore.deleteExpired` **is** live — `routes/ui.ts:197`, `:209`.
- `noopScanPublisher` (`services/scan-publisher.ts:33`) is production-dead but test-load-bearing; the default is deliberate and documented. Leave it.
- `ScanJobStore` re-exports `ScanJob`/`ScanJobStatus`/`ScanResult` from `scan-events.ts` for "backward compatibility" while its own doc comment (`scan-job-store.ts:12-16`) admits *"nothing outside this file imports the type from here today."* Self-documented dead re-export — safe to drop.

### 6.3 REST ↔ GraphQL duplication

Both Pothos plugin removals from §4.3 are independently confirmed, and the `ValidationPlugin` case is stronger than I'd assumed: `graphql/schema/invalid-input-error/model.ts:9-20` explains that routing validation through the plugin would require `unsafelyHandleInputErrors`, **which bypasses scope-auth**, and the file explicitly instructs "do not 'simplify' this back to declarative arg validation." So removing the plugin isn't just cleanup — it removes a footgun that the codebase has already had to write a warning about.

Eight duplicated pairs, in rough order of how much they'd bite:

1. **`currentChapter` derivation — the anti-drift guarantee doesn't actually hold.** GraphQL uses `deriveCurrentChapter` (`graphql/derive.ts:85-93`), extracted per `progress/model.ts:41-47` explicitly "so the two readings cannot drift" — but `routes/ui.ts:303-312` still computes it inline via `parseCfiSpineIndex` → `spineIndexToChapter` and was **never switched over**. The extraction happened; the migration didn't. This is the one duplication with a live correctness risk, and fixing it is a 3-line change in `ui.ts`. **Do this one.**
2. **Scan background pipeline** — `routes/ui.ts:1069-1088` vs `library/mutation/scan.ts:78-102`, mirrored "line for line" per its own comment. Only divergence is the `onProgress` callback (§1.3). Note the consequence the sweep surfaced: `scan.ts:81` is the *only* non-test caller of `scanJobStore.progress`, so the entire progress machinery — `reduceScanJob`'s `'progress'` branch, `shouldPublish`'s coalescing, the `ScanProgress`/`ScanPhase` types — is reachable only through GraphQL.
3. **ISO-8601 publish-date regex** — `routes/ui.ts:48` and a byte-identical copy at `book/mutation/update-metadata.ts:45`, whose comment at `:39` concedes it is "duplicated rather than imported."
4. **Book-list cursor codec** — inline base64-JSON decode at `routes/ui.ts:519-524` + clamp at `:527`, vs `library/entries-cursor.ts:29-45` + the same clamp restated at `library/model.ts:122`. Telling contrast: `Library.progress` *does* share REST's helpers (`clampProgressTake`, `decodeProgressCursor` from `utils/progress-pagination.ts`). The book cursor is the one that got a second implementation.
5. **Device field validation** — `routes/devices.ts:15-52` (`parseBody`) vs `device/mutation/device-fields-schema.ts:32-39`; name-after-trim, 50-char ceiling, non-empty-slug rule and positive-integer dimensions re-expressed in zod.
6. **Edition-cache purge** — REST has three character-identical try/catch blocks (`routes/devices.ts:141-149`, `166-174`, `224-232`); GraphQL collapsed its three into `purge-quietly.ts:49-58`. The extraction stopped at the GraphQL boundary. (This is also where §6.1 item 10 lives.)
7. **Library filter vocabulary** — `VALID_STATUSES` (`routes/ui.ts:65`) + inline entry-type narrowing (`:489-490`) vs the enums at `library/entries-filter.ts:3-17`.
8. **Admin user registration** — `routes/users.ts:114-156` vs `user/mutation/register.ts:147-175`, with the check *ordering* deliberately reproduced via two zod schemas. Only `isValidUsername`/`MIN_USERNAME_LENGTH` are shared.
9. *(minor)* The "must pass validation" 409 string exists three times: `routes/ui.ts:1129-1132`, `:1269-1273`, `book-not-validated-error/model.ts:47`.

Correctly shared, for contrast: `utils/user-books-dir.ts`, `utils/progress-pagination.ts`, `utils/username.ts`, `utils/slug.ts`, `services/revalidate-library.ts`.

My read: items 1 and 2 are worth fixing; 3, 4 and 9 are cheap if you're already in the file; 5, 7 and 8 are defensible as-is, because the GraphQL versions encode *ordering* and *schema-level typing* that the REST versions can't express. Don't force-share those.

### 6.4 REST endpoint coverage

GraphQL now has an equivalent for **every** REST endpoint under `routes/ui.ts`, `routes/users.ts` and `routes/devices.ts` — 38 pairs, enumerated by the sweep. Correctly staying REST with no GraphQL twin: `POST /api/login`, `/api/auth/refresh`, `/api/auth/logout`, `GET /api/public-config`, the three binary routes (`/cover`, `/download`, `/upload`), the SPA/static handlers, and the entire `opds.ts` / `kosync.ts` routers.

So **no REST route can be deleted yet** — the client uses all of them. The legacy-route-deletion gate is blocked on the client migration, and §1.1 is what would otherwise keep it blocked permanently.

Two things the sweep surfaced that sharpen the picture:

- **The client is 100% REST today.** `app/client/package.json` has no GraphQL client dependency, and `grep -r graphql app/client/src` returns zero hits including tests. GraphQL is a fully-built, fully-tested, **zero-consumer** parallel API. That's the correct state to be in before a migration — but it also means none of the GraphQL paths have ever run against real client traffic, which is worth weighting when deciding how much of §2 to fix pre-emptively versus discover in staging.
- **`POST /api/books/replace-staging` and `/cover-staging` are dead in production right now** (`routes/ui.ts:1336-1360`, `:1383-1404`). They were added *by* the migration; the client's replace flow still posts multipart to `/api/books/:id/replace` and `/replace/analyze`. Their only callers are `routes/ui.test.ts:2180-2282` and GraphQL mutations nothing invokes. `services/replace-staging.ts` is therefore reachable in production only via a code path with no caller.

That last point is the strongest argument for fixing §1.1 **now**: the staging seam has never carried real traffic, so changing its identity key is currently a zero-risk change. The moment the client starts using it, it isn't.

---

## 7. Recommended sequencing

**Before the client migrates** (one focused PR, all small):
1. `cors: false` in `createYoga` — §2.2
2. `'/graphql': apiUrl` in the Vite proxy — §2.3 *(do 1 and 2 together, in this order)*
3. Body-size guard ahead of the yoga mount — §2.4
4. Max-depth (+ max-alias) validation rule, all environments — §2.5
5. Per-operation GraphQL logging plugin; stop demoting GraphQL errors to debug — §3.5
6. Staging identity for the config admin — §1.1 *(the only one with real design content; consider a short spike first)*
7. `Library.book(id:)` — global ID or delete — §4.1
8. Decide the `bookType` alias — §5

**Whenever:**
- Point `routes/ui.ts:303-312` at `deriveCurrentChapter` — the only duplication with a live correctness risk — §6.3 item 1
- Extract the shared scan pipeline; wire REST's `onProgress` — §1.3
- Drop `ErrorsPlugin` + `ValidationPlugin` and their deps — §4.3
- Delete `isKnownStoreError` (or make `toResult` use it) and the orphaned `staged-upload-not-found-error/index.ts` barrel — §6.2
- Upload limits: diskStorage for staging, `limits` on `upload`, per-user staged quota — §4.2
- Periodic staging sweep timer — §1.4
- Rate limiting (mount above `/graphql`, not per-router) and security headers — §2.7
- Correct or fix the change-password Response-availability claim — §1.2
- `X-Accel-Buffering: no`; `setMaxListeners(0)` on the pubsub target — §3.2
- The mechanical half of the debt roll-up — §5

**Accept:** `isProduction` wiring, staging TTL/skew, SSE lifecycle, refresh-token revocation, CSRF posture, batching, SSE test sleeps, device label.
