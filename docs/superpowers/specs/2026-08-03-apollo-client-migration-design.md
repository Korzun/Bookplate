# Spec 2 — migrating the React client to Apollo Client v4

**Date:** 2026-08-03
**Branch:** `graphql-migration`
**Predecessor:** spec 1 (server) — complete, twice reviewed, unmerged at `8d576127`
**Successor:** spec 3 — delete the now-legacy REST routes, gated on this finishing

Read `2026-07-30-graphql-server-design.md` §"Phase 2 (Apollo Client) inputs" and
`../reviews/2026-08-02-apollo-fit.md` alongside this document. This spec does not restate
them; it records the decisions they left open, and **corrects them where measurement
disagreed** (see §10).

---

## 1. Scope

Migrate the client's app API from REST to GraphQL. Measured surface, current as of HEAD:

| measure | value |
|---|---|
| `apiFetch(` call sites, non-test, excluding its own definition | **50** |
| source files containing them | **43** |
| client test files | 129 |

(The handoff brief said "~55 call sites across 53 files"; that figure counts test files and
`lib/api-fetch.ts` itself. 50/43 is the migration surface.)

REST routes are **not** deleted here — that is spec 3. Partial migration is a valid, shippable
state at every commit boundary.

### In scope, decided during brainstorming

- The core query/mutation migration.
- The `scanProgress` SSE subscription, replacing the 2-second polling loop in
  `use-scan-library.ts`. Without it, spec 3 cannot delete `/api/books/scan/status`.
- An "id in every selection" CI check.
- Login 429 handling (§C2 of the server spec — documented as a client contract, never
  implemented).
- Preserving today's optimistic UI (currently: `use-delete-book`).

### Explicitly out of scope

- Persisted queries as a *transport* feature. Distinct from codegen's `persistedDocuments`
  artifact, which **is** in scope as a build/measurement artifact only — see §5.2 and §13.
- Any server change. If a screen has nowhere to go, **surface it and stop** (§12).
- Unrelated refactoring of the six providers that are staying.

---

## 2. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | The four server-state providers (`book`, `device`, `progress`, `user`) | **Retired.** The Apollo cache is the single source of truth; components use generated hooks with colocated fragments. |
| D2 | How screens are rooted, given self reads `viewer.library` and an admin cannot | **`node(id: $libraryId) { ... on Library { … } }`** — one document per screen for both roles. |
| D3 | Test seam | **Real `InMemoryCache` (built from the app's exported `cacheConfig`) over Apollo's `MockLink`**, via a `renderWithApollo` helper. Transport links get dedicated tests instead of riding along in every screen test. |
| D4 | Sequencing | **Route by route, riskiest transport first** — see §9. |
| D5 | Backward pagination | **Not supported client-side at all.** The shared load-more hook is forward-only with no direction parameter. See §5.1. |

### 2.1 Why `node(id:)` — measured, not asserted

`Query.user(id:)` is **admin-only**: it returns `FORBIDDEN` to a non-admin *even for their own
id* (`user/query/get.test.ts`, "refuses a non-admin"). So a uniform `user(id:)` root is
impossible, and `viewer.library` is `null` for the config-based admin
(`viewer/model.ts:17`). `Library` is a `Node` whose `loadOne` is `isOwnerOrAdmin`-gated, which
makes `node(id:)` the only single-root option.

Verified at runtime against the live schema (a throwaway harness test, since this is
load-bearing for the whole client architecture):

| viewer | `node(id: <Library gid>)` | result |
|---|---|---|
| owner (non-admin) | own library | resolves, `user.username === 'alice'` |
| admin | the same library | resolves, `user.username === 'alice'` |
| non-admin | **another user's** library | `null` — the schema's "not found, never forbidden" convention |

The Library global ID is `encodeGlobalID('Library', userId)` — **viewer-independent**, unlike
`Book.id`, whose compound key makes it differ between an owner and an admin. That is what makes
one stored id usable by both roles.

#### Deferred alternative — `Query.library(id: ID!): Library`

Considered and **deliberately deferred**, recorded here so it is a decision on file rather than
something rediscovered mid-implementation.

A dedicated typed root would drop `... on Library` from ~10 documents and give a wrong-type
global ID a coercion error via `for:`, exactly as `Query.user` already does. Budget-wise it is a
**wash** — inline fragments are depth-transparent, so `library(id:)` and `node(id:)` both land
at depth 8.

It is deferred, not rejected, because **adding a root field is purely additive and
non-breaking**: existing documents keep working untouched and any that want the typed root can
migrate lazily or never. So the "schema changes are cheapest before the client freezes" argument
— sound in general, and decisive for anything *breaking* — does not apply. Nothing is
foreclosed by waiting.

The cost of living without it is one `... on Library` line per document plus a three-line
`asLibrary(node)` narrowing helper in one place. Revisit only if that boilerplate actually
grates during implementation, at which point its value is known rather than guessed.

**Explicitly NOT the alternative to take: relaxing `Query.user(id:)` to `isOwnerOrAdmin`.** It
loses the comparison it exists to win (`user(id:).library` measures depth **9** vs `node(id:)`'s
**8**), it widens the auth surface of a root field that faithfully mirrors an admin-only REST
router (`routes/users.ts` applies `router.use(adminAuth)` to the whole router), and it makes
`User.library`'s `ownerOf` denial branch — documented today as unreachable defense-in-depth
*because* `Query.user` is admin-gated — newly reachable, requiring test coverage it does not
have. A security-relevant behaviour change bought for a regression in query depth.

Cost of each rooting strategy, measured with `costOf()` / `measureOperationDepth` against a
realistic grid query (`entries(first: 20)` with a `Series` arm and a shared book card):

| strategy | breadth /100 | complexity /33,000 | depth /12 |
|---|---|---|---|
| `viewer.library` | 41 | 5.9% | 9 |
| `user(id:).library` | 42 | 5.9% | 9 |
| **`node(id:)` → `... on Library`** | **40** | 5.9% | **8** |
| both roots in one doc via `@include`/`@skip` | 83 | 11.8% | 9 |
| `node(id:)` with a richer card | 76 | 12.4% | 10 |
| **`@include`/`@skip` with a richer card** | **155 — REJECTED** | 24.9% | 11 |

The `@include`/`@skip` "one document, two roots" shape is **dead**: breadth SUMs over the
expanded selection tree, so spreading the library fragment down both branches doubles it, and
it blows `BREADTH_BUDGET` the moment the card is realistic. `node(id:)` is also one level
shallower than either alternative — real headroom in a corridor whose ceiling is 12 and whose
worst legitimate shape already measures 11.

---

## 3. Architecture

### 3.1 Provider disposition

| Provider | Disposition |
|---|---|
| `book`, `device`, `progress`, `user` | **Deleted.** Each dies when its last consumer migrates. |
| `auth` | **Untouched.** Derives `username`/`userId`/`isAdmin`/`mustChangePassword` from JWT claims (`decodeClaims`), not from a network read — there is no auth query to migrate. |
| `theme`, `toast`, `config` | Untouched. |
| `upload` | Untouched. `POST /api/books/upload` stays REST permanently (multer + XHR progress). |
| `library-target` | **Reshaped** — see §3.2. |

`BookContext`'s `completeBookIds` — the hand-rolled "this list row is thin, this detail row is
rich" tracker — is Apollo's partial-entity merge by `id`. It is deleted, not ported.

### 3.2 `library-target` and the current library id

Today: stores a **username** in localStorage; `useWithTargetUser()` appends `?user=<username>`
to REST URLs.

After: stores the selected **Library global ID**. `useWithTargetUser` is **deleted** — GraphQL
carries the target in the query root, not a query-string parameter.

```ts
useCurrentLibraryId(): string | undefined
//  admin with a selection -> the stored Library global ID
//  admin with none        -> undefined (screens render "Select a library")
//  everyone else          -> viewer.library.id, from the bootstrap query
```

**Storage migration: none.** A stored value that is not a Library global ID (i.e. a legacy
username) is treated as "no selection", so an admin re-picks a library once after upgrade. A
one-time UX cost in exchange for zero migration code and no dead code path to carry forever.

**The self library id is read from the server, not minted client-side.** The JWT claims carry
the raw user id, so `btoa('Library:' + userId)` would work — and is rejected deliberately.
Hard-coding Pothos's global-ID encoding into the client is exactly the coupling the
book-relay-id plan removed; a bootstrap query costs one cheap round trip and cannot drift.

**Global IDs in URLs must be `encodeURIComponent`'d.** They are standard base64 and may contain
`+`, `/`, `=`. `router/path.ts` already wraps every id it embeds — that discipline carries over
unchanged; only the *value* changes from a raw content hash to a global ID.

### 3.3 Foundation

Built once, before any screen. Versions verified against the registry, not transcribed:

| package | version | note |
|---|---|---|
| `@apollo/client` | 4.2.9 | |
| `rxjs` | ^7.3.0 | **required** peer dependency of Apollo v4 — not optional, not mentioned in the review |
| `graphql` | reuse the hoisted **16.14.2** | Apollo v4 accepts `^16 \|\| ^17`. Do **not** add graphql 17: a second graphql instance in the workspace is a well-known hazard |
| `graphql-sse` | 2.6.0 | |
| `@graphql-codegen/cli` | 7.2.0 | |
| `@graphql-codegen/client-preset` | 6.1.0 | |
| `@graphql-codegen/fragment-matcher` | 7.1.0 | `possibleTypes` |

Export names verified against the installed 4.2.9 package: `SetContextLink`
(`/link/context`), `ErrorLink` (`/link/error`), `CombinedGraphQLErrors` + `ServerError`
(`/errors`), `ApolloProvider`/`useQuery`/`useMutation`/`useSubscription`/`useFragment`
(`/react`), `MockLink` + `MockSubscriptionLink` (`/testing`), `MockedProvider`
(`/testing/react`), `relayStylePagination` (`/utilities`).

`/graphql` is **already** in the Vite dev proxy (`vite.config.ts`) — verified, no change needed.

Codegen reads the **committed SDL** (`app/server/graphql/schema.generated.graphql`), never
introspection: production introspection is disabled by `NoSchemaIntrospectionCustomRule`.

```ts
// app/client/codegen.ts
schema: '../server/graphql/schema.generated.graphql',
documents: 'src/**/*.{ts,tsx}',
config: { scalars: { DateTime: 'string', JSON: 'unknown' } },
generates: {
  // hashAlgorithm pinned to sha256 deliberately — see §13.
  'src/gql/':                  { preset: 'client-preset',
                                 presetConfig: { persistedDocuments: { hashAlgorithm: 'sha256' } } },
  'src/gql/possible-types.ts': { plugins: ['fragment-matcher'] },
}
```

No scalar marshalling. `DateTime` arrives as an ISO-8601 string and is parsed at the display
edge; `JSON` is `unknown` and narrowed at its one real render site. `apollo-link-scalars` is
rejected — it needs the executable schema in the browser bundle.

---

## 4. Cache configuration

Exported as a single `cacheConfig` object that both `main.tsx` and the test helper consume, so
tests can never drift from production.

```ts
typePolicies: {
  Viewer:   { keyFields: [] },                        // root singleton, no id field
  Config:   { keyFields: [] },                        // same shape, static
  Library: {
    fields: {
      entries:  relayStylePagination(['filter']),
      progress: relayStylePagination(),
      book:     { keyArgs: ['id'] },
    },
  },
  Series:     { fields: { books:    relayStylePagination() } },
  Validation: { fields: { messages: relayStylePagination() } },
}
```

*(Updated 2026-08-04, in the schema-id-cleanup plan's Task 6: `Progress` no longer has a
typePolicy — see §14.7.)*

Everything else normalizes with **zero** config. `Book`, `Library`, `Series`, `User` are
`Node`s; `Device`, `PendingFix`, `Validation`, `ScanStatus`, `Progress` carry a scalar `id`
without implementing `Node`. Id-less types (`SuggestionGroup`, `Suggestion`, `MetadataFix`,
`PendingFixState`, `UndoSnapshot`, `Identifier`, `LinkedDocument`, `ValidationMessage`,
`ScanResult`) store **inline** under their parent — "zero config" for them means "no
normalization", not "normalizes automatically".

**Cache-key value sharing.** `PendingFix.id` and `Validation.id` equal the owning `Book`'s
global ID. Three distinct entities (`Book:<gid>`, `PendingFix:<gid>`, `Validation:<gid>`)
namespaced by `__typename`. Consequences:

- Evicting a `PendingFix` needs **its own** `cache.identify` call. Passing the bare id string,
  or hand-building `` `Book:${id}` ``, silently evicts the **Book**.
- `Query.node(id:)` fed a `PendingFix.id` resolves a **Book**, by design. Neither is a
  per-type refetch handle.

---

## 5. Data flow

### 5.1 Pagination — forward only (D5)

There is **zero** backward pagination in the client today: no `before=`, no `startCursor`, no
`hasPreviousPage` anywhere in `app/client/src`. The shared load-more hook is therefore
forward-only with no direction parameter.

**Tripwire, recorded because it costs nothing and rediscovering it is expensive:** the
asymmetry still exists server-side. `Library.entries` and `Library.progress` reject `last`/
`before` outright with `BACKWARD_PAGINATION_UNSUPPORTED` (forward-only keyset cursor);
`Series.books` and `Validation.messages` genuinely support backward paging via
`t.relatedConnection`. So "we only page forward" must not decay into "the four connections are
interchangeable" — adding backward paging to a series view would work, adding it to
`Library.entries` would throw at runtime.

Page-size ceilings, all rejecting an oversize page rather than silently clamping:

| field | maxSize | defaultSize |
|---|---|---|
| `Library.entries` | 100 | 20 |
| `Library.progress` | 100 | 50 |
| `Series.books` | 100 | 20 |
| `Validation.messages` | 100 | 20 |
| `Query.nodes(ids:)` | 100 | — |

### 5.2 Cost enforcement — measure the shipped documents, not copies of them

§Q of the server spec directs client authors to copy fixtures into `cost-calibration.test.ts`
and measure by hand. **This spec does that differently, deliberately.** Hand-copied fixtures
drift from the documents actually shipped, and §Q itself records two occasions where a
transcribed number was wrong (18,503 vs. the true 24,203; and a parenthetical delta no test
covered).

Instead: `persistedDocuments: true` emits a committed `persisted-documents.json` containing
every real operation. One server-side test reads that artifact and, for **every** operation:

1. runs `accepts()` from `cost-test-support.ts` — schema validity plus the **real**
   `costLimitRule` through `validate()`, exactly as a live request goes through `yoga.ts`. This
   catches `PAGE_SIZE_EXCEEDED` and `BACKWARD_PAGINATION_UNSUPPORTED` too, which a bare
   `measureOperationCost` call would not;
2. asserts headroom via `measureOperationCost` — under **70%** of both `BREADTH_BUDGET` (100)
   and `COMPLEXITY_BUDGET` (33,000), matching the CI `Cost calibration` job's own threshold.

Consequences worth stating plainly:
- Drift becomes structurally impossible — the thing measured *is* the thing shipped.
- A too-expensive query fails CI when codegen runs, not when someone remembers to add a fixture.
- The existing `LEGIT_FIXTURES` corpus stays as-is; this is additive.

**Prefer literal page sizes over variables in documents.** `cost-limit.ts:506` prices a
variable-valued `first`/`last` at that field's **`maxSize`** — the conservative worst case,
since validation sees the AST and not resolved variable values. So `entries(first: $first)` is
measured at 100 even when the client only ever sends 20, and a rich card can fail the gate
purely because the page size is a variable. The client uses a fixed page size today, so write
`entries(first: 20)` literally and reserve variables for connections that genuinely need a
runtime-varying page size.

Budget context: the admin user-list screen already sits at **68.5%**, the worst legitimate
anchor and the number `COMPLEXITY_BUDGET` was derived from. There is no fixed "safe `first`" —
page size and selection richness are the same budget spent two ways, and multipliers compound
across nesting. When a shared fragment grows, re-measure.

### 5.3 Binary transfer stays REST

`Book.coverUrl`, `Book.downloadUrl`, `Book.thumbnailUrl(width:)` are consumed **verbatim**.
They carry an admin `?user=<owner username>` param and a floored `v=<mtime epoch>` cache token
the client would get wrong, and the ordering/joining is done server-side.

`lib/use-authorized-src.ts` keeps doing its blob fetch — still the only way to attach a Bearer
header to an `<img>`. Only the URL's origin changes. `lib/cover-url.ts` is **deleted** in the
sweep.

### 5.4 Staged uploads

Stage over REST, then mutate:

1. `POST /api/books/replace-staging` (EPUB) or `POST /api/books/cover-staging` (image) →
   `{ stagedUploadId }`.
2. `bookAnalyzeReplace(id, stagedUploadId)` reads without consuming — safe to call repeatedly
   while the user reviews proposed fixes.
3. `bookReplace(...)` / `bookUpdateMetadata(..., stagedCoverId)` consume **only on success**.

**The behaviour to preserve: a typed error leaves the staged file in place, so the retry path
must not re-upload.** That is the entire reason the staging seam exists. A 30-minute TTL means
a user sitting on a review screen too long gets `StagedUploadNotFoundError` on submit and
should be re-prompted for upload, not shown a generic failure.

Staged ids are **`String`, not `ID`** — opaque service tokens. Never run them through global-ID
decoding; never use them as cache keys.

Admins can stage, analyze and apply exactly like any user (`stagingIdentityOf` maps an admin
session to a sentinel). Build no `Viewer.user`-null special case.

### 5.5 Mutations

Ten of the 24 need a hand-written `update`: `bookDelete`, `bookResolvePendingFix`,
`deviceCreate`, `deviceDelete`, `progressDelete`, `progressSet`, `userChangePassword` (not a
cache update — see §6), `userDelete`, `userRegenerateSyncPassword`, `userRegister`. The other
fourteen return the entity they changed and normalize for free, provided the selection includes
the changed collection (e.g. `device { id enabledUsers { id } }`).

Two shared helpers carry the weight:

- **`filterDanglingEdges(connection, { readField, canRead })`** — Apollo auto-filters arrays of
  *references* but **not** arrays of *edge objects*, which is what every connection here is.
  Reused across `Library.entries` and `Library.progress`. (`Library.pendingFixes` is a plain
  array of references and *is* auto-filtered — it needs only the `cache.evict`.)
- **`unwrapResult(result)`** — every mutation result branches three ways: `null` (entity gone) /
  typed error member / payload. Only `deviceCreate`, `progressSet`, `userRegister` are
  non-nullable.

**Optimistic UI is preserved** where it exists today (`use-delete-book` removes the book and,
when it was the last of its series, the series row). An `optimisticResponse` must name a
concrete union member's `__typename` and supply every selected field.

### 5.6 Deletion payload shapes — not one universal shape

| mutation | eviction key |
|---|---|
| `bookDelete` | `deletedId: ID!` only — `cache.evict({ id: cache.identify({ __typename: 'Book', id: deletedId }) })` |
| `userDelete` | `deletedId: ID!` (plus a raw `deletedUserId` Apollo ignores) |
| `progressDelete` | `deletedDocument: String!` + the `userId` the caller passed in — the composite key |
| `deviceDelete` | `deletedDeviceId: String!` — `Device` has an `id` but is not a `Node` |

`bookDelete`/`progressDelete` also return the parent `Library`; `userDelete`/`deviceDelete`
have no `Library` parent to report.

---

## 6. Transport and error handling

### 6.1 Link chain

`ErrorLink → SetContextLink → HttpLink`, with `split()` on subscription operations diverting to
`SSELink`. `ErrorLink` goes **first** so its retry re-reads the token `SetContextLink` injects.

It reuses the existing `refreshAccessToken()` — already single-flight in-tab and cross-tab via
`navigator.locks` — rather than reimplementing it, and carries `apiFetch`'s one-shot `retried`
guard.

**Corrected 2026-08-03 during execution:** this sentence originally ended "so a permanently dead
refresh cannot loop," which is **false**. Probed against `@apollo/client@4.2.9` with a
permanently-failing refresh, the error handler is entered exactly once whether or not the guard
is present (`handlerEntries=1`, `networkAttempts=2`, rejected, in both configurations): Apollo's
`ErrorLink` intercepts only the original `forward()`, and the retry observable it returns
subscribes straight to the outer observer, so a failed retry never re-enters the handler. Apollo
itself is what bounds the retry. The guard is kept as **defense-in-depth** — non-re-entry is an
implementation detail of 4.2.9, not a documented contract — but nothing today can exercise it,
and no test can prove it load-bearing.

```ts
import { from as observableFrom, mergeMap, throwError } from 'rxjs';

const refreshLink = new ErrorLink(({ error, operation, forward }) => {
  const isAuth =
    (CombinedGraphQLErrors.is(error) &&
      error.errors.some((e) => e.extensions?.code === 'UNAUTHENTICATED')) ||
    (ServerError.is(error) && error.statusCode === 401);   // defensive fallback
  if (!isAuth || operation.getContext().retried) return;
  operation.setContext({ retried: true });
  return observableFrom(refreshAccessToken()).pipe(
    mergeMap((ok) => (ok ? forward(operation) : throwError(() => error)))
  );
});
```

This form is **verified working** end to end against Apollo 4.2.9: one `UNAUTHENTICATED` → one
refresh → one retry → success. It differs from the snippet in the server spec and the
Apollo-fit review, which does not compile — see §10.

The server half of this contract is pinned by `content-negotiation.test.ts`: Apollo's negotiated
`Accept` gets `application/graphql-response+json` back, which is what keeps `extensions.code`
reachable on a non-2xx response.

### 6.2 Typed errors are data, not errors

`BookHashCollisionError`, `StagedUploadNotFoundError`, `IncorrectPasswordError` and the rest
arrive **in `data`**, discriminated by `__typename`. They never reach `ErrorLink` and must never
be handled there. Nearly all user-facing error UI comes from `unwrapResult` at the call site;
the link chain handles only genuine transport failures.

### 6.3 Transport error taxonomy

| code | treatment |
|---|---|
| `UNAUTHENTICATED` / HTTP 401 | refresh once, retry once, then surface |
| `FORBIDDEN` | surface; never retry |
| `QUERY_COMPLEXITY`, `QUERY_BREADTH`, `PAGE_SIZE_EXCEEDED`, `BACKWARD_PAGINATION_UNSUPPORTED` | **developer errors, not user-facing states.** The §5.2 cost gate makes the first three unreachable in shipped code; if one appears, something bypassed the gate. Fail loudly in dev, generic toast in prod, never auto-retry |
| `GRAPHQL_VALIDATION_FAILED` | same. Note it is **indistinguishable** from a depth-limit rejection — `depth-limit.ts` sets no code of its own. No automatic back-off keyed on it |

There is no `QUERY_DEPTH` code in this schema. Do not write a branch expecting one.

`errorPolicy` stays at the default `none`.

**CORRECTED 2026-08-05 during execution — this paragraph previously claimed the two admin-scoped
fields (`Viewer.users`, `Device.enabledUsers`) are "already nullable server-side, so a scope
denial nulls just that field", implying the whole-screen-blanking failure mode was gone by
construction. That is FALSE on the client.** The server's tested contract
(`app/server/graphql/schema/viewer/users.test.ts`) returns `users: null` **together with** a
`FORBIDDEN` GraphQL error. Apollo's default `errorPolicy: 'none'` discards `data` entirely
whenever ANY error accompanies the response, so a non-admin selecting one of these fields gets
`{ data: undefined, error: FORBIDDEN }` — not a partial result with one null field. Nullability
makes the denial local *server-side*; it does not make it local *client-side*.

Two consequences for anything selecting these fields:

- **Do not fold `null` into an empty list and assume that path runs.** It does not; the error
  branch does. A test mocking `null` without an accompanying `errors` array reproduces a
  response shape the real server never sends.
- **Gate the query instead.** `useUserList` passes `skip: !isAdmin` for exactly this reason —
  a non-admin should not issue the request at all rather than issue one guaranteed to be
  refused. `Device.enabledUsers` needs the same treatment wherever it is selected.

Closing this properly (rather than gating each call site) would mean special-casing `FORBIDDEN`
in `createRefreshLink` the way `UNAUTHENTICATED` already is, or setting `errorPolicy: 'all'` on
the affected queries. `viewer/model.ts`'s own doc comment anticipates that work; it has not been
done.

### 6.4 Two behavioural contracts

- **`userChangePassword` means silent logout.** It revokes the caller's own refresh tokens and
  the server cannot reissue cookies from a GraphQL context. Success ⇒ log out and navigate to
  `/login`. Never "continue the session".
- **Login 429.** `POST /api/login` rate-limits at 10 attempts/minute/IP. The form today treats
  any non-200 as bad credentials, so a 429 renders as "wrong password" — misleading, and it does
  **not** clear on a correct retry (a successful login does not reset the counter, deliberately).
  Render it as "too many attempts, try again in `Retry-After`s", distinctly from a 401.

---

## 7. The scan subscription

Yoga emits GraphQL-over-SSE **distinct-connections** mode, which is `graphql-sse`'s default
(`singleConnection: false`) and needs no `/graphql/stream` endpoint.

### 7.1 Why hand-rolled — the corrected rationale

The handoff's reason ("Apollo has no first-class SSE link, so you must write one") is
**imprecise**, and the correction matters because it changes what to copy. Verified empirically
(§10, C5): Apollo's **official** `GraphQLWsLink` from `@apollo/client/link/subscriptions`,
handed `graphql-sse`'s `createClient()`, drives this exact server correctly —

```
SUBSCRIPTION EVENTS: [1,2,3]           # against real graphql-yoga@5.21.2
QUERY over http link:  {"ok":true}     # split() coexistence confirmed
BODY KEYS yoga saw:    ["extensions","operationName","query","variables"]
operationType leaked?: false
```

`GraphQLWsLink` names the **graphql-ws client *interface***, not WebSockets as a transport.

It is still not the right choice here, for a narrower reason: `graphql-sse`'s `Client<false>`
is missing `on` and `terminate`, so the constructor call is a **type error**. Adopting it means
`as unknown as Client` plus installing `graphql-ws` purely to satisfy a `.d.ts` it never
executes. That cast is safe *today* only because the link touches exactly one method — every
`this.client.*` call site in its 96-line source is `this.client.subscribe(...)`. A future Apollo
release calling `terminate()` during cleanup would break it silently at runtime, on the
disconnect path. Bad failure mode, bought for ~40 saved lines that are mostly `CloseEvent` error
mapping — WebSocket-specific, and dead code over SSE.

**So: hand-roll, but model it on Apollo's `GraphQLWsLink` implementation, NOT on graphql-sse's
README recipe.** The README recipe is what introduces the `operationType` bug this section warns
about; Apollo's is the same shape with the bug already absent, and is the reference
implementation to copy.

### 7.2 Details

- **`@graphql-sse/apollo-client` is dead** (0.0.19, 2022, pins Apollo 3 and graphql 15). Do not
  use it.
- **Destructure the operation explicitly** — `{ variables, operationName, extensions }` plus
  `print(operation.query)`. Apollo v4 attaches an `operationType` property, and spreading
  `{ ...operation }` puts it in the request body, which yoga rejects as an unknown parameter
  with a confusing 400. This is verbatim what Apollo's own link does, which is the confirmation
  that the fix is right rather than merely plausible.
- Auth is a non-problem: `graphql-sse` uses `fetch`, not `EventSource`, so a real
  `Authorization` header works and the `headers` callback may be async — call
  `ensureFreshToken()` from it.
- **Read `Library.scanStatus` immediately after `subscribe()` resolves, and on every reconnect.**
  There is an inherent registration gap; this read closes it. `ScanStatus` keys on `id`, so
  events merge into the already-rendered status with no typePolicy override.
- A scan started via REST (`POST /api/books/scan`, still reachable) is visible only at
  start/terminal granularity — no intermediate `total`/`processed`/`phase`/`currentFile`. Build
  the progress UI assuming `libraryScan` drives it.

The 2-second polling loop in `use-scan-library.ts` is removed only once the SSE path is proven
green.

---

## 8. Testing and guardrails

### 8.1 The seam

```ts
export const renderWithApollo = (ui, { mocks, ...opts }) =>
  renderWithProviders(
    <ApolloProvider client={new ApolloClient({
      link: new MockLink(mocks),
      cache: new InMemoryCache(cacheConfig),   // the app's own exported config, not a copy
    })}>{ui}</ApolloProvider>, opts);
```

Cache-update functions are then tested against the **actual** `typePolicies`, which is where the
bugs live. Transport links (`ErrorLink` refresh, `SSELink` body shape) get dedicated tests
rather than riding along in every screen test.

**MockLink's weakness, and the fix.** A mock can return a shape the server never would, so a
green test can hide a broken query. client-preset generates a result type per document, so
typing mocks as `MockedResponse<LibraryGridQuery>` makes `tsc --noEmit` — already part of
`npm run lint` — reject a malformed mock at compile time. No new dependency, no runtime
validation.

### 8.2 Seen-to-fail targets

Every property-protecting test is demonstrated failing against a deliberately broken version.
These are mandatory because each has a specific way to pass while broken:

| property | how it passes while broken | required test shape |
|---|---|---|
| `Progress` composite key *(superseded, see §14.7 — key is now the default `id`, not a composite)* | with one user, `["document"]` and `["userId","document"]` are indistinguishable | two users owning the same book; must fail when reverted to `["document"]` |
| Admin traversal scoping | counts match whether or not scoping is right | admin views user A then user B; assert **contents**, i.e. whose data rendered — never counts |
| `coverUrl` passthrough | asserting `v=` is present passes with an admin param leaking in | assert the **absence** of `?user=` on a self URL |
| One-shot refresh retry | a working happy path passes with the guard removed | must fail when `retried` is removed (loop) **and** when link order is flipped (stale token) |
| SSE body shape | a subscription that works locally can still carry a stray field | assert the exact request-body key set excludes `operationType` |
| Connection-edge filtering | Apollo auto-filters arrays of *references*, so a naive test passes without the helper | assert on an **edge-object** connection |

### 8.3 CI guardrails

All wired into `npm run lint` from the repo root (never from a workspace — the two workspaces
have separate configs and a workspace-local run silently skips the other):

1. **id-in-every-selection** — a document walk failing when a query or fragment selects a
   normalizable type without its key field (`id` for every type now, including `Progress` —
   see §14.7; the composite `userId`+`document` requirement it once enforced for `Progress` no
   longer applies). Apollo injects `__typename` but **never** `id`; an omission silently
   un-normalizes with no test failure. The client lints with **oxlint**, which has no GraphQL
   plugin, so this is a small script in the existing `graphql:schema:check` style rather than
   adopting a second lint framework for one rule.
2. **Codegen freshness** — regenerate and diff, mirroring the server's SDL check.
3. **The persisted-documents cost gate** (§5.2).

### 8.4 On test counts

Of the 43 source files holding an `apiFetch` call, ~36 are `provider/*/hook/*.ts`; those and
their tests are rewritten, so the client suite's shape changes substantially. Definition of done
is "both suites green", **not** "972 unchanged". Report the real number.

---

## 9. Sequencing

Route by route, riskiest transport first. Each step ends shippable; providers die as their last
consumer moves.

| # | Step | Ends with | Status |
|---|---|---|---|
| 0 | Foundation — deps, codegen, `cacheConfig`, link chain, `ApolloProvider`, `renderWithApollo`, the three guardrails | Codegen + all three CI checks green with zero documents | ✅ Complete |
| 1 | Viewer/config bootstrap + login 429 | Transport proven end to end against a real server; `useCurrentLibraryId()` live **for the self path only** — the admin path arrives with the library-target reshape at step 5 | ✅ Complete |
| 2 | **SSE link + `scanProgress`** | Polling loop removed; `/api/books/scan/status` unused | ✅ Complete |
| 3 | `/devices` | `DeviceProvider` deleted | ✅ Complete |
| 4 | `/users` | `UserProvider` deleted | ✅ Complete |
| 5 | Library-target reshape + `/library` grid | `/library` on GraphQL; `useCurrentLibraryId` serves admins; `library-target` stores a Library global ID. `useWithTargetUser` is NOT deleted — 19 non-test consumers remain[^step5-count] across book detail, edit, upload, series, download and cover, all still on REST (steps 6–9) | ✅ Complete |
| 6 | Book detail + `/library/series/:name` | Book detail and `/library/series/:name` on GraphQL; `from-book.tsx` deleted; `Validation.counts` shipped with an N+1-safe batching loader whose reject path is proven load-bearing. `useWithTargetUser` down to **9** non-test consumers[^step6-count], not the 8 the step-6 spec scoped — `use-fetch-book.ts` cannot retire here, it backs `useBook`, which keeps consumers in steps 7–8. `use-series.ts`/`use-series-book-list.ts` retired as genuinely dead, along with the `useSeriesBookList`-only callers `useMySeriesProgress`/`useUserSeriesProgress` (already reduced to zero consumers by an earlier task's `SeriesRow` rewrite onto `Series.progressPercentage`). server 2008/2008, client 1106/1106 (down from 1144 — the 38 tests belonging to the five deleted hooks) | ✅ Complete |
| 7 | Book edit | `page/book-edit` and `BookEditForm` read and save entirely over GraphQL; the cover stages first over the permanent REST seam, then rides into `bookUpdateMetadata`'s `stagedCoverId`. Validation and lineage are NOT new work here despite the row's original text — both landed in step 6 (`Validation.counts`/`editingBlocked`, `Book.lineage`/`bookUnlinkDocument`); step 7 only reads the already-shipped `validation { valid }` field to gate editing. Pending fixes stay on REST, by ruling — `usePendingFixesForBook` reads the upload queue's in-memory items, not a server call, and migrating it alone would create two sources of truth; that's step 9's work. `useWithTargetUser` down to **7** non-test consumers[^step7-count], exactly the step-7 spec's own prediction — `use-series-names.ts`/`use-fetch-series-next-index.ts` migrated onto `SeriesNamesDocument`/`SeriesNextIndexDocument` in place (not deleted). server 2014/2014, client 1144/1144. | ✅ Complete |
| 8 | Progress screens | Both progress screens and the link modal read and mutate entirely over GraphQL; `Progress.book` shipped with a batching loader whose reject path is proven load-bearing (re-verified at the sweep, times out rather than fails an assertion when broken). `ProgressProvider`, its context, and all ten hooks deleted, along with the STEP-8 BRIDGE (`SetProgressModal`'s `onSaved`/`page/book`'s `onSaved={refetch}`) and both `renameProgressKey` calls — TRUE, but only because this step also removed the two calls INTO `ProgressProvider` from step 9's own hooks: `usePatchBookMetadata` (`provider/book/hook/use-patch-book-metadata.ts`, called by `use-upload-queue.ts`) and `useReplaceBook` (`provider/book/hook/use-replace-book.ts`, called by `upload-replace-modal`) both called `renameProgressKey` to keep the REST progress map's keys in sync across an id rotation; that job is already handled server-side (`BookStore.resolveBookId`/`reimportBook`, `app/server/services/book-store.ts`), so nothing replaces the calls. `useWithTargetUser` still at **7** non-test consumers, unchanged — no progress hook ever called it, confirmed by direct count at the sweep. `useBook`/`use-fetch-book.ts` lose their last two non-test consumers (the two progress rows) but are NOT deleted here — step 10 owns `BookProvider`. server 2023/2023 (+9 from step 7's 2014), client 1112/1112 (net -89 from the pre-deletion-commit peak of 1201: -88 from `provider/progress/`'s own deleted test files, -2 from the two `renameProgressKey` tests, +1 new `use-progress-mutations` test for a `Book.progress` cache-consistency fix surfaced while wiring the delete path) | ✅ Complete |
| 9 | `/upload` — bytes stay REST, refetch via Apollo | `/upload` and the Replace modal read and mutate pending fixes entirely over GraphQL (`LibraryPendingFixesDocument`, `BookResolvePendingFixDocument`, `BookAnalyzeReplaceDocument`, `BookReplaceDocument`); the multipart upload POST and the staging POST stay REST, by design. `provider/upload/api.ts`, `provider/book/hook/use-upload-queue.ts` (the old REST engine), and `provider/book/hook/use-patch-book-metadata.ts` deleted; a new `provider/upload/hook/use-upload-queue.ts` (different path, GraphQL-backed) merges the transport and fix-state hooks behind the old `UseUploadQueue` shape. `useWithTargetUser` down to **5** non-test consumers[^step9-count] — exactly the step-9 spec's own prediction, unlike steps 6 and 7: `use-download-book` (permanent seam), the upload transport (admin-on-behalf multipart POST), and three dead files step 10 owns (`use-fetch-book`, `use-fetch-book-list`, `use-upload-book-list`). Deliberately NOT deleted here, confirmed still present at the sweep: `use-book.ts`, `use-book-list.ts`, `use-standalone-book-list.ts`, `use-book-list-items.ts`, `use-fetch-book.ts`, `use-fetch-book-list.ts`, `use-upload-book-list.ts`, and `BookProvider` — all dead, all owned by step 10. server 2041/2041 (+18 from step 8's 2023), client 1119/1119 (+7 from step 8's 1112). | ✅ Complete |
| 10 | Sweep | `BookProvider`, `BookContext`, seven dead hooks (`use-book`, `use-fetch-book`, `use-book-list`, `use-standalone-book-list`, `use-book-list-items`, `use-upload-book-list`, `use-fetch-book-list`), and `lib/cover-url.ts` deleted — 2010 lines in one commit; `provider/book/` survives as a directory of hooks with no provider. `useBookListFilter` simplified to pure URL-derived state (the context copy it also wrote was a write-only cache — the third this migration found — with no reader outside its own dedup effect), which dissolved the one dependency keeping `BookContext` alive. Both duplicated logout call sites (`use-logout.ts`, `use-change-my-password.ts`) consolidated onto one new best-effort helper, `lib/logout.ts`, with a one-shot `sessionStorage` marker (`markLoggedOut`/`consumeLoggedOutMark`) suppressing exactly the first post-logout silent refresh — a deliberate behaviour change: a failed logout POST now still clears the token and redirects, where before it left the user stranded with silent, unrendered error state. The `apiFetch`-only sweep assertion replaced with `lib/rest-seams.test.ts`, which also catches bare `fetch(` and `new XMLHttpRequest`, runs in the ordinary client suite, and corrects the four inaccuracies in the prior §9.1 (see below) — seen to fail with a planted stray `fetch("/api/nope")` (named exactly, then reverted, then re-observed passing) per §6, and separately caught two real false positives against existing doc-comment prose while being built (a space-before-paren match in `component/book-row/from-entry.tsx`, then unstripped comment text found at review), both fixed — the first by tightening the regex, the second by stripping comments before scanning. This step's own sweep (folded in from Task 4's review, which correctly left the file as out-of-list — see Task 4's report) also deleted `provider/book/util.ts` (the sole remaining consumer of the REST-era `Book`/`Identifier` types) and those two types with it. server 2041/2041 (unchanged — this step touched no server code), client 1082/1082 (down from step 9's 1119: net of the ~2010 deleted lines' tests against new logout/filter/rest-seam tests). Every prediction in the step-10 design spec held; nothing was found wrong at the sweep beyond the four inaccuracies §9.1 itself documents. **Spec 2 is now COMPLETE, 10 of 10.** | ✅ Complete |

[^step5-count]: The library-target-and-grid plan was scoped against a pre-step-5 count of ~21
non-test consumers. Step 5's own row/fragment rewrite (`BookRow`/`SeriesRow` no longer self-fetching,
Task 7 of that plan) retired 2 of those call sites as a side effect. 19 is a direct count at the
step's completion (`grep -rn 'useWithTargetUser(' app/client/src | grep -v '\.test\.' | wc -l`),
not the number carried forward from the plan's own scoping text.

[^step6-count]: The step-6 design spec (§5) predicted 12 of the 20 pre-step-6 consumers would
retire, leaving 8. Two of the three hooks flagged for possible retirement at cleanup did: `use-
series.ts` and `use-series-book-list.ts` had zero non-test, non-barrel consumers by the sweep
(task 13) — the latter's only two callers, `useMySeriesProgress`/`useUserSeriesProgress`, were
themselves already unreachable. The third, `use-fetch-book.ts`, was miscounted as retiring in the
step-6 surface map's own "12 retiring" table even though that same document's "Hooks whose
consumers do NOT all retire here" section correctly notes `useBook` (which calls `useFetchBook`
internally) survives for `page/book-edit` and the two progress-row components — a direct
contradiction the sweep resolves in the code's favor: 11 retire, 9 survive, not 12/8.

[^step7-count]: The step-7 spec predicted 2 of the 9 step-6 survivors would retire —
`use-series-names.ts` and `use-fetch-series-next-index.ts` — leaving 7. It also predicted
`PatchBookMetadataResult.globalId` would go dead once `usePatchBookMetadata` lost `BookEditForm` as
a caller; task 8's sweep found that prediction wrong, the same shape of mistake step 6 made about
`use-fetch-book.ts`: `use-upload-queue.ts` (step 9's own hook, unaffected by this step) reads
`patched.globalId` in its `applyPatch` and `undo` paths to keep the queue's stored `bookGlobalId`
fresh across a metadata patch that rotates the book's raw id — see the step-7 spec's own §6 for the
correction. The count itself held: `grep -rn 'useWithTargetUser(' app/client/src | grep -v
'\.test\.' | wc -l` → 7, matching by name: `use-download-book` (permanent seam), `use-fetch-book`,
`use-fetch-book-list`, `use-patch-book-metadata`, `use-replace-book`, `use-upload-book-list`,
`use-upload-queue`.

[^step9-count]: The step-9 design spec (§7.4) predicted 7 → 5, by name: `use-download-book`
(permanent seam), `use-fetch-book`, `use-fetch-book-list`, `use-upload-book-list` (three dead,
deleted at step 10), and the upload transport (kept — admin-on-behalf uploads still need
`?user=` on the multipart POST). Direct count at the task-12 sweep (`grep -rn
'useWithTargetUser(' app/client/src | grep -v '\.test\.' | wc -l`) → **5**, by exactly those
five names (`grep -rln`): `use-download-book.ts`, `use-fetch-book-list.ts`, `use-fetch-book.ts`,
`use-upload-book-list.ts`, `use-upload-transport.ts`. Unlike steps 6 and 7, this prediction held
— no wrapper hook hid a live caller this time.

SSE lands at step 2, not last, because it holds the most unknown-unknowns (yoga's wire format,
the `operationType` strip, the registration race) and is cheap to test in isolation. Finding a
surprise there after eight routes are built would be expensive, and it is the one route deletion
spec 3 is gated on.

### 9.1 The eight REST seams that remain after step 10 — corrected at the sweep

This section previously claimed four seams and was wrong in four ways: it said
`lib/api-fetch.ts` held "login, logout, refresh" when only refresh was there; login is in
`page/login/index.tsx`; logout was duplicated across `provider/auth/hook/use-logout.ts` and
`provider/user/hook/use-change-my-password.ts`; and `use-download-book.ts` was named nowhere,
despite calling `apiFetch` for a binary transfer. Step 10 also consolidated logout into a new
single helper, `lib/logout.ts`, used by both former call sites — so the corrected list below
is not just a correction of a prior miscount, it reflects a real shape change made by this step.

The real, current list is eight:

| # | Seam | Call | Form |
|---|---|---|---|
| 1 | `lib/api-fetch.ts` | `POST /api/auth/refresh` + the authorized-fetch wrapper | bare `fetch` |
| 2 | `page/login/index.tsx` | `POST /api/login` (pre-auth) | bare `fetch` |
| 3 | `lib/logout.ts` | `POST /api/auth/logout` (pre-auth teardown) | bare `fetch` |
| 4 | `provider/config/provider.tsx` | `GET /api/public-config` (pre-auth) | bare `fetch` |
| 5 | `lib/use-authorized-src.ts` | blob fetch of cover/thumbnail/download URLs | `apiFetch` |
| 6 | `provider/book/hook/use-download-book.ts` | file download | `apiFetch` |
| 7 | `provider/upload/hook/use-upload-transport.ts` | `POST /api/books/upload` | **`new XMLHttpRequest`** |
| 8 | `lib/staged-upload.ts` | `POST /api/books/{replace,cover}-staging` | `apiFetch` |

Any other REST call after step 10 is a bug, and the sweep asserts it — the enforcing test now
lives at `app/client/src/lib/rest-seams.test.ts`, runs in the ordinary client suite (not a
manual/CI-only step), and matches all three call forms in the table above: `apiFetch(`, bare
`fetch(`, and `new XMLHttpRequest`. It strips block and line comments before scanning, so a
doc comment describing a REST call in prose — this migration has ten steps of exactly that —
does not get flagged as if it made one. A second test in the same file asserts every listed
seam still exists on disk and still makes a call of one of the three forms, so a stale
allow-list entry (a seam that was migrated away without being un-listed) fails loudly too.

Two blind spots are accepted and documented in that file's own comments, not silently:

1. A call written with a space before the paren — `fetch (url)` — would evade the regex the
   same way a loose version of the pattern once false-positived on prose in
   `component/book-row/from-entry.tsx` ("...the REST cover *image* fetch (a binary
   endpoint..."). This is not just empirically true today: `npm run lint`'s `oxfmt --check`
   normalizes every real call expression to have no space before the call paren, so CI itself
   keeps the assumption enforced.
2. A call split across a line break — `fetch\n('/api/nope')` — would also evade it. No such
   call exists in this tree and `oxfmt` would not produce one, but this is a plain-text
   pattern, not an AST walk, so a sufficiently contrived call could still slip past it.

---

## 10. Corrections to prior documents

Per the project's "verify, don't transcribe" discipline — where a document contradicted the
code, the code won and the document is corrected in place.

**C1 — the `ErrorLink` snippet does not compile.** Both
`2026-07-30-graphql-server-design.md` §C (~line 1367) and
`../reviews/2026-08-02-apollo-fit.md` §E give:

```ts
return Observable.from(refreshAccessToken()).flatMap(ok => (ok ? forward(operation) : throwError(error)));
```

Probed against the installed `@apollo/client@4.2.9`:

```
Apollo Observable === rxjs Observable: true
Observable.from:  undefined     // rxjs exports a standalone from()
observable.flatMap: undefined   // rxjs 7 uses .pipe(mergeMap(...))
```

Apollo v4 re-exports rxjs's `Observable` verbatim. There is no static `from`, no `.flatMap`, and
rxjs 7's `throwError` takes a **factory**, not a value. The corrected, verified-working form is
in §6.1. Both documents get a correction note in place.

**C2 — `rxjs` is a required peer dependency** of `@apollo/client@4`. Neither document mentions
it; a client installed from the review's dependency list alone would fail to resolve.

**C3 — migration surface.** The handoff brief's "~55 `apiFetch(` call sites across 53 files"
counts test files and `api-fetch.ts` itself. Measured: **50 call sites across 43 source files**.

**C4 — `@graphql-eslint`'s `require-id-when-available`**, named by the review as the
highest-value day-one guardrail, is not available: the client lints with oxlint, not ESLint.
Replaced by an equivalent script (§8.3.1).

**C5 — "Apollo has no first-class SSE link" is imprecise, and the imprecision matters.** The
review §F and the server spec §D both say Apollo has no usable link, so ~25 lines must be
hand-rolled from graphql-sse's README recipe — while separately warning that the README recipe
leaks `operationType` and 400s.

Tested against real `graphql-yoga@5.21.2`: Apollo's official `GraphQLWsLink`
(`@apollo/client/link/subscriptions`), constructed with `graphql-sse`'s `createClient()`,
subscribes successfully, coexists with `HttpLink` under `split()`, and sends **exactly**
`["extensions","operationName","query","variables"]` — no `operationType`. `GraphQLWsLink` names
the graphql-ws client *interface*, not a WebSocket transport.

Hand-rolling remains correct, but for a different and narrower reason (§7.1): graphql-sse's
`Client<false>` lacks `on`/`terminate`, making the constructor a type error that only an
`as unknown as Client` cast plus a phantom `graphql-ws` dependency can silence. The practical
consequence of this correction is **what to copy**: Apollo's implementation, which is the
README recipe with the `operationType` bug already absent — not the README recipe plus a
remembered patch.

---

## 11. Definition of done

- Client uses GraphQL for the app API; REST routes still present but unused by the client, so
  spec 3 can delete them.
- REST calls confined to the eight seams in §9.1, asserted by `lib/rest-seams.test.ts`.
- Server suite green (1939 at baseline); client suite green (count will differ — §8.4).
- `npm run lint` clean **from the repo root**.
- `npm run test:cost -w app/server` green.
- No shipped operation over 70% of either budget, enforced by the persisted-documents gate
  (§5.2) rather than by hand-copied fixtures.

---

## 12. Risks and stop conditions

- **A screen with nowhere to go.** The server is complete and twice reviewed; two gaps were
  found and closed pre-emptively, so more are possible but should be rare. If one appears:
  **surface it and stop.** Do not silently patch the server mid-client-work — any server change
  means SDL regeneration, the calibration suite, and its own review.
- **The cost corridor is narrow, not comfortable.** Depth ceiling 12 against a worst legitimate
  shape of 11; the admin user-list at 68.5% of the complexity budget. The §5.2 gate turns this
  from a discipline problem into a build failure, which is the point.
- **A ~72KB deeply-nested query 500s at graphql-js's parse stage** — pre-existing, documented,
  accepted debt on the server. Not introduced or worsened here; noted so it is not mistaken for
  a client defect. See §13 — spec 3 has a cheap opportunity to close it.

---

## 13. Trusted documents — evaluated, deferred to spec 3, with one cheap hook left in place

Raised during brainstorming as "should we install `@graphql-yoga/plugin-apq`?". Both plugins
were read at 3.21.2 before answering; they are close to opposites.

**`@graphql-yoga/plugin-apq` — rejected outright.** Its `onParams` does
`store.set(sha256Hash, params.query)`: **any caller can register any query.** It is a
payload-size optimization, not an allowlist, and carries **zero** security value. Here it is a
net negative — operations are text-only under the 100kb cap, there is no CDN in front of
authenticated POSTs to benefit, and it adds a client-populated server-side cache surface.

**`@graphql-yoga/plugin-persisted-operations` (trusted documents) — attractive, deferred.**
This is what APQ is usually confused with. Verified in source: with the default
`allowArbitraryOperations: false`, `onParams` throws `PersistedQueryOnly` the moment
`params.query` is present at all, so **rejection precedes the GraphQL parse**.

Why that ordering matters unusually much for this codebase:

1. **It closes the carried parse-stage debt.** The ~72KB nested query that overflows
   graphql-js's recursive-descent parser does so *before* `depthLimitRule`, auth, or context
   run, and is **unauthenticated-reachable**. That debt note states the fix "needs a pre-parse
   size/complexity guard, not a depth-rule change." This is precisely that guard.
2. **It closes the paired observability gap** — a parse-stage failure emits no operation-log
   line, so probing it leaves no trace. Rejected at `onParams`, it never reaches parse.
3. **The expensive prerequisite is already paid for.** §5.2 generates and commits
   `persisted-documents.json` for the cost gate regardless.
4. **No version-skew risk.** Client and server build into a single Docker image, so the usual
   "deployed client is ahead of the server's manifest" objection does not apply.

Caveats: dev needs `allowArbitraryOperations` for GraphiQL, and the depth/breadth/complexity
rules must **stay** as defense in depth (and for the dev path), not be retired as redundant.

**Deferred to spec 3**, which already touches the server; adopting it here would violate this
spec's own "surface a gap and stop, do not patch the server mid-client-work" rule, and it needs
its own review of plugin ordering.

**The one thing locked in now (§3.3):** codegen's `persistedDocuments.hashAlgorithm` is pinned
to **`sha256`**, matching what yoga's `defaultExtractPersistedOperationId` reads from
`extensions.persistedQuery.sha256Hash`. It is already client-preset's default, but pinning it
makes it an explicit cross-spec contract rather than an incidental default that could move.
Spec 3 can then adopt the existing manifest directly instead of regenerating it. Zero cost
today.

`persistedDocuments.mode` stays at its default **`embedHashInDocument`** for spec 2: the full
document remains in the bundle and the client keeps sending real queries, so the manifest is
purely a build artifact for the cost gate. Spec 3 flips it to `replaceDocumentWithHash` when
trusted documents actually land — that flip is the switch from "measured" to "enforced", and it
is spec 3's to throw, not this one's.

---

## 14. What execution of steps 0–2 actually taught us — read before planning steps 3–10

*(Added 2026-08-04, after the foundation plan shipped: 17 commits, `8d576127..9796c318`. Client
suite 972 → 1009, server 1939 → 1942, `test:cost` 30 → 33, root lint clean.)*

Everything below is a correction or an addition discovered by EXECUTING this spec. The pattern
worth naming up front: **every defect found in the foundation was in something this spec asserted
about a library's behaviour without running it.** The one component that was built and run against
a real server before being written down (`SSELink`, §7) needed no correction at all. Prefer
executing a probe over reading documentation when the claim is load-bearing.

### 14.1 Fragment masking is ON — this changes how every later fragment is consumed

`client-preset` enables fragment masking by default, and this spec never mentioned it. A field
selected through a named fragment is NOT accessible on the parent's generated type: the type
carries an opaque `{ ' $fragmentRefs': … }` marker instead. Consuming it requires codegen's own
`useFragment` helper to unmask.

Despite the name it is **not a React hook** — it is a generated identity function that re-types
the opaque marker, so it may be called conditionally or on a possibly-`undefined` value.

Every screen in steps 3–10 uses shared fragments. Plan for unmasking at each consumption site, or
make a deliberate decision to set `fragmentMasking: false` — but decide it, do not discover it.

### 14.2 The codegen config's final, working shape

Two settings were added during execution that §3.3's original snippet lacked. Both are load-bearing:

- **`documentTransforms: [addTypenameSelectionDocumentTransform]`** — Apollo v4 always injects
  `__typename` at runtime. Without this the generated types omit it, so typed mocks *reject* the
  `__typename` Apollo needs in order to normalize, pushing authors toward mocks that silently fail
  to normalize. It also made the persisted-documents manifest record a query the client never
  actually sends. Generated types now carry a root-level `__typename: 'Query'` too — mock data must
  include it.
- **`'!src/**/*.test.{ts,tsx}'` in `documents`** — without it, ad hoc `gql` fixtures inside test
  files land in the manifest, and both manifest-driven guardrails then police operations that are
  not shipped.

### 14.3 The three guardrails, and what each actually enforces

All three were mutation-tested at final review and confirmed load-bearing, not decorative:

| Guardrail | Where | Enforces |
|---|---|---|
| codegen freshness | `npm run lint` (client) | committed `src/gql/` matches the SDL + documents |
| cache-key selection | client vitest, `provider/apollo/selection-ids.ts` | every shipped operation selects each normalizable type's key field |
| query-cost gate | server vitest, `client-operations-cost.test.ts` | every shipped operation passes the REAL `costLimitRule` and stays under 70% of both budgets |

The cache-key checker **derives** key fields from the app's own `cacheConfig` rather than
restating them, so a typePolicy change propagates automatically. Keep that property.

Two things it taught us about writing documents:

- **`node(id:)` returns the `Node` INTERFACE, which itself declares `id`.** A selection set on
  `Node` needs `id` selected directly on it — an inline fragment `... on Library { id }` satisfies
  `Library`'s key, not `Node`'s. So the rooting pattern is
  `node(id: $libraryId) { id ... on Library { id … } }`. The guardrail caught this spec's own
  omission in a shipped document.
- Fragment applicability is **subtype-aware**: `fragment X on Node { id }` spread into a `Book`
  selection does satisfy `Book`'s key, because `Book implements Node`.

### 14.4 Cache lifecycle — `useResetApolloStoreOnIdentityChange` must not be removed

The final review found a **Critical** gap this spec never considered: the Apollo client is created
once at module scope, and nothing reset it when the logged-in user changed. Logout happens to be
safe only because it hard-navigates; a refresh-cookie expiry clears the token WITHOUT navigating,
the router then transitions client-side, and the next user's `cache-first` query is served the
previous user's data with no network request.

`provider/apollo/identity-reset.ts` now clears the store on **identity** change (via `currentIdentity()`,
listening to both `TOKEN_CHANGED_EVENT` and the cross-tab `storage` event). It keys on identity,
NOT on the token value — a routine refresh mints a new token for the same user every few minutes,
and clearing then would empty the cache constantly. A test pins that a same-identity refresh does
**not** clear; keep it.

Steps 3–10 put real tenant data (book lists, progress, validation) into that cache. This is the
control that makes multi-tenant caching safe.

### 14.5 Corrections to earlier sections of this spec

- **§6.1's `retried` guard** is unreachable defense-in-depth, not the thing that prevents a retry
  loop — see the correction already recorded in that section. Apollo's `ErrorLink` bounds the retry.
- **Apollo v4 dropped the `TCacheShape` generic** from `ApolloClient`/`ApolloCache`, so
  `client.cache.extract()` returns `unknown`. A narrowing cast to `NormalizedCacheObject` is
  legitimate and unavoidable.
- **`rxjs@^7` is a required peer dependency** (§3.3) — confirmed in practice.

### 14.6 Carried into steps 3–10

- ~~A shared `renderHookWithApollo` seam is missing.~~ **Closed** (library-target-and-grid plan,
  Task 1) — built in `test-utils.tsx`.
- ~~`useCurrentLibraryId` is self-path only.~~ **Closed** (library-target-and-grid plan, Task 4) —
  the admin path was added: an admin reads the `library-target` selection, a non-admin always
  reads `viewer.library.id` regardless of any stored selection.
- **Error-surfacing policy, decided (library-target-and-grid plan, Task 6).** Every migrated screen
  hook returns `error: string | undefined`, derived from Apollo's `error?.message`. A **first-page**
  failure with no data is the screen's empty-error state; a **fetchMore** failure keeps the existing
  rows and offers a retry affordance. This holds because Apollo's `fetchMore` runs with a forced
  `fetchPolicy: 'no-cache'`, and a rejection never reaches the handler that writes to cache — so
  `useQuery`'s own `data`/`error` are left completely untouched by a failed page, and the caller-side
  split on `edges.length === 0` vs `> 0` (the same distinction `LibraryPage` already made pre-GraphQL)
  is what decides which state to show.
- **Settled: Apollo v4's `useSubscription` DOES clear `data` on a variables change, synchronously**
  (library-target-and-grid plan, Task 10). Read from `useSubscription`'s own source
  (`@apollo/client/react/hooks/useSubscription.js`), not just observed: `variables` are
  deep-memoized (`useDeepMemo`, compared via `@wry/equality`'s `equal`); when they change, the hook
  runs `setObservable((observable = recreate()))` **in the render body**, not an effect; `recreate()`
  builds a brand-new tracking object whose `__.result` starts as `{ loading: true, data: undefined,
  error: undefined }`; and the `useSyncExternalStore` snapshot getter is an inline closure
  (`() => observable.__.result`) created *after* that reassignment, in the same expression, so it
  already captures the new object's pointer in that same render — no stale frame where a previous
  library's event still shows through. The variables-changed check that triggers this
  (`!equal(variables, observable.__.variables)`) runs unconditionally, with no branch on whether the
  outgoing `observable` had already delivered a result or was still awaiting its first one — so this
  clearing fires identically in both cases, and a mid-scan library switch (a switch *after* the prior
  library's subscription had already emitted) is covered exactly like a switch before any event
  arrives, not just the latter.

### 14.7 `Progress` typePolicy removed — server now issues a computed global ID

*(Added 2026-08-04, schema-id-cleanup plan, Task 6.)* The server-side cleanup gave `Progress` a
computed `id` field — `encodeGlobalID('Progress', JSON.stringify([userId, document]))` — so the
GraphQL type now carries its own opaque, owner-scoped identifier and no longer exposes a raw
`userId` output field at all. The client's composite `keyFields: ['userId', 'document']` policy
(§4, §8.2, §8.3) keyed on a field that no longer exists, so it was deleted; `Progress` now
normalizes on the default `id` key like every other scalar-id type.

The property the composite key protected — two users owning the same book share a `document`
value (a KOReader content hash) and must not collapse onto one cache entity — is unchanged and
still guarded, now by the global ID carrying the owner instead of by the composite key.
`cache.test.ts`'s two-user test was rewritten to write the new `id`/`document` shape and was
re-run seen-to-fail with `Progress: { keyFields: ['document'] }` temporarily restored: both users'
writes collapsed onto one entity (the second write's `percentage` clobbered the first's), then the
policy was reverted and the suite confirmed green. `selection-ids.ts`'s cache-key checker derives
its required fields from `cacheConfig` rather than restating them, so it followed this change with
no hand-patching — only its test fixture's expectation moved from `missing: ['userId']` to
`missing: ['id']`.

### 14.8 Known residuals from the schema-ID cleanup (2026-08-04)

One Minor item remains parked at merge, verified real and not load-bearing. (The other — the
`Progress.id` SDL description's "(to their owning `Book`)" fix — was folded in at task 2 and is
struck here.)

- **`progressDelete`'s `owner === null` guard is pinned by contract, not proven load-bearing.**
  Deleting the guard leaves the suite green: `clearProgress` returns false for a phantom user and
  the following line produces an identical observable. Distinguishing the two would need a
  progress row orphaned from its user, which the foreign key likely forbids.

Also deferred deliberately (not a defect): the `Progress` id encoding is duplicated across
`progress/model.ts` and `progress/mutation/delete.ts` rather than extracted into a shared module.
An end-to-end round-trip test pins encode-matches-decode instead, and the failure mode is closed
(a mismatch yields FORBIDDEN/null, never a wrong-row delete). Extract it when someone next works
in that area.

## 15. Known behaviour changes

User-visible or contract-visible differences from the REST app, introduced across this migration's
plans. Recorded here so a future reader who notices one of these doesn't mistake it for a bug.

- **`progressCount` on `/users` is served `cache-first`** (`use-user-list.ts` sets no `fetchPolicy`,
  so it inherits Apollo's default). Once `UserListDocument` has resolved once in a session, later
  reads — from any component, mounted at any later time — are served from the cache without a new
  network round trip; nothing here polls or auto-refetches. An external e-reader sync that updates a
  user's `Progress` rows mid-session will not be reflected in this figure until something explicitly
  invalidates the cache (a hard reload, or a mutation with its own refetch/eviction behavior — no
  current mutation touches this field). **This is not a regression the migration introduced**,
  verified against the REST implementation it replaced (`use-user-list.ts` at `549bb757`, the last
  commit before the GraphQL rewrite): its `UserProvider` fetched `/api/users` once into app-root
  state and gated every subsequent mount's re-fetch on `Object.keys(userList).length === 0`, which
  is false forever after the first successful load — `progressCount` was equally frozen for the
  whole session under REST. The mechanism moved from a hand-rolled guard to Apollo's default
  `fetchPolicy`; the observable staleness for this specific field did not change.
- **The series progress badge — dropped, then restored, net zero user-visible change.** `SeriesRow`
  lost its progress badge in Task 7 of the library-target-and-grid plan: the grid rows became
  fetch-free (rendering straight from a fragment ref, no per-row `useSeriesBookList` call), and no
  server field yet existed to carry an equivalent value down with the connection. Task 14 restored
  it by adding `Series.progressPercentage` — an N+1-safe, request-batched server aggregate (two
  queries total per page of series, not one per series) — whose semantics were verified to exactly
  match the old client-side calculation it replaced (`calculateSeriesProgressPercent` /
  `useMySeriesProgress`, `provider/progress/helper.ts` — both deleted as dead code by task 13's
  sweep, once `SeriesRow` no longer called either): the unweighted mean of each member book's
  `Progress.percentage`, a bookless-of-progress member counting as 0%, and `undefined` (no badge at
  all, not a "0%" badge) when either the series has no books or none of its books have any progress
  row. A reader who only saw one half of this arc — the drop in Task 7, or the restore in Task 14 —
  would misread it as a real change; end to end, it is not.
- **Change-password now logs the caller out.** Introduced in the schema-id-cleanup / devices-users
  lineage and carried forward here: the server's `userChangePassword` mutation revokes every one of
  the caller's refresh tokens as a side effect, and a GraphQL context has no `Response` to reissue
  auth cookies on even if it wanted to. So `useChangeMyPassword` (`provider/user/hook/use-change-my-
  password.ts`) treats a successful change as an unconditional silent logout: it best-effort POSTs
  `/api/auth/logout` to clear the now-meaningless refresh cookie (outcome ignored), then
  unconditionally `clearToken()`s and navigates to `/login`. The REST hook it replaced
  (`use-change-my-password.ts` before `4307ea19`, "feat: store fresh access token after password
  change") did the opposite — it stored the fresh access token the REST endpoint returned and let
  the session continue uninterrupted. Do not "restore" that continuation; the server-side token
  revocation makes it impossible to honor, not merely a client choice.
- **Deleting a book can reset the library grid to page 1.** `useDeleteBook`'s `update`
  (`provider/book/hook/use-delete-book.ts`) evicts the owning `Library`'s entire `entries` field
  (every filter variant), not just the deleted book's edge — required because deleting the last
  book in a series also deletes the `Series` row server-side, and `BookDeletePayload` carries no
  `deletedSeriesId` the client could use to evict just that one stale edge. `relayStylePagination`
  stores everything `fetchMore` accumulated across every page scrolled; evicting the whole field
  discards all of it, so a user several pages deep who deletes one book sees the grid re-fetch from
  the network on its next read and restart at page 1, not resume where they were. This is new,
  real, and deliberately not fixed narrower here: a `cache.modify` that filters out only the
  deleted book's (and, for the series case, the now-empty series') edge in place would preserve
  already-loaded pages, and is the natural follow-up if the page-1 reset proves annoying in
  practice — it needs a way to identify the affected `Series` edge without a `deletedSeriesId` in
  hand, which was out of this step's scope.
- **The validation modal's summary counts can now exceed its visible message rows.** `Validation.
  counts` (task 2) tallies every message server-side, unbounded — the gap this field was built to
  close, since REST's tally was likewise unbounded (`epub-validator.ts`'s `formatMessages` slices
  nothing). But `Validation.messages` is still a paginated connection, capped at
  `CONNECTION_LIMITS.validationMessages.maxSize` (100), and `page/book` requests it at that literal
  max (`graphql/book.ts`'s `ValidationFragment`). REST's `ValidationDetailModal` rendered every
  message it was ever handed, with no cap of its own, because REST's `ValidationReport.messages`
  was itself unbounded. So for a book with more than 100 validation messages, the summary row
  (`SeverityCounts`, fed by the now-authoritative `counts`) can report totals the visible message
  list below it does not fully account for — a real, new divergence from REST's always-complete
  list, traded deliberately for the cost-budget safety a paginated connection buys (spec 2, step 6,
  §1). No shipped library has approached 100 messages on one book; revisit if one does.

- **Saving a book edit with a changed cover now makes two network requests where REST made one, so a
  large cover is visible in Save's latency.** `useUpdateBookMetadata` (step 7,
  `provider/book/hook/use-update-book-metadata.ts`) stages the cover file over the permanent REST
  seam (`~/lib/staged-upload`) FIRST, sequentially, and only then fires `bookUpdateMetadata` with the
  staged id — GraphQL has no file transport, so the single multipart `PATCH /metadata` the REST form
  used to send is now two round trips end to end, not one. The two phases can also report two
  DIFFERENT user-facing failure messages ("Couldn't upload the cover image" vs "Couldn't save your
  changes") where REST could only ever report one generic failure. This is real and new — not fixed
  here, since there is no single-request alternative once file bytes and a GraphQL mutation are both
  in play — but a user with a slow connection uploading a large cover will notice Save taking longer
  and, rarely, see it fail at the upload phase with the changed metadata never sent at all.
- **`renameProgressKey` is no longer called after a book-edit save that rotates the book's id** —
  the REST-era `usePatchBookMetadata` called it explicitly; `useUpdateBookMetadata` (step 7) does
  not, because there is no client-side `Progress` map left to rename a key in under GraphQL. Real,
  and unrecorded until this whole-branch review flagged it. The impact is buffered server-side, not
  client-side: `BookStore.resolveBookId` (`app/server/services/book-store.ts`) resolves an old id
  through `book_id_history` back to the book's current id on every lookup, and `reimportBook`
  (same file) migrates the owner's `Progress` row itself from the old document id to the new one as
  part of the same transaction that performs the id rotation. So a client that still only knows the
  pre-save id keeps resolving to the right `Progress` row server-side; nothing here relies on the
  client ever renaming a local key.

Confirmed NOT a new divergence, despite looking like a candidate at first read: **a series with more
than 100 books still truncates** (`graphql/series.ts`'s `SeriesDetailDocument` requests
`books(first: 100)`) — but this is the exact `MAX_TAKE` the REST hook it replaces
(`use-series-book-list.ts`, deleted by task 13) already clamped at, so the limitation is carried,
not introduced.

Confirmed CLOSED, not an open divergence: the step-6 design spec's plan to narrow
`ValidationMessage.segments` was never shipped — task 12b restored the full `segments { text
subject }` selection (subject monospacing) before this sweep ran, verified still rendering in
`control/validation-detail-modal/index.tsx`.

- **The link-progress picker's filtering is now a debounced server round trip, not an instant local
  filter.** The REST screen's book picker fetched the whole library once and filtered the in-memory
  list on every keystroke. `LinkProgressModal` (`control/link-progress-modal/index.tsx`) replaces
  that with `LinkPickerBooksDocument`, filtered server-side via `LibraryFilter.query` — the same
  mechanism the library grid's own search already uses — so every distinct filter string is a new
  network request. The typed input is debounced 200ms (`DEBOUNCE_MS`, matching
  `use-search-suggestions.ts`'s identical constant) before it becomes a query variable, so a normal
  typing cadence collapses into one request per pause rather than one per character, but the modal
  is now visibly loading between keystrokes on a slow connection where it previously never was.
  Confirmed shipped as written.
- **The progress card no longer fetches its rows while collapsed — only a lightweight count.** The
  REST `MyProgress`/`UserRow` cards called `useMyProgressList()`/`useUserProgressList()` directly at
  the top level just to `Object.keys(...).length` the result for the "N books synced" subtitle, so
  the full row list was fetched on mount unconditionally, whether or not the card was ever expanded.
  `MyProgress` (`component/my-progress/index.tsx`) and the admin equivalent now read a dedicated
  `MyProgressCountDocument`/`Viewer.user.progressCount` for that subtitle instead, and the row-
  fetching components (`MyProgressContent`/`UserRowContent`, each calling
  `useMyProgressList`/`useUserProgressList`) are children of `Card`'s `isCollapsible`/
  `defaultCollapsed` pair, which does not mount its children at all while collapsed — so the row
  list is fetched only once a user actually expands the card. Strictly less work than REST did, not
  more; recorded here because it is still an observable timing change (rows now populate a moment
  after expansion instead of already being in the cache). Confirmed shipped as written.
