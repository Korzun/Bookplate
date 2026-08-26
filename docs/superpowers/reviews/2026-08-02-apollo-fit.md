> Preserved 2026-08-02 from the pre-client-polish planning session scratchpad. Commit reviewed: `8aa685c5`. Covers: Apollo Client v4 fit assessment for the Bookplate GraphQL server — cache identity, unions/possibleTypes, error model/auth, SSE subscriptions, scalars, mutations/optimistic UI, and what Houdini gave for free that Apollo doesn't. Content below is verbatim from the source review.

# Apollo Client v4 fit assessment — Bookplate GraphQL server (`8aa685c5`, branch `graphql-migration`)

Scope: does the Houdini-designed schema/transport work well under Apollo Client v4? Everything below
was checked against the actual SDL (`app/server/graphql/schema.generated.graphql`), the yoga mount
(`app/server/graphql/yoga.ts`), the Pothos builder (`app/server/graphql/schema/builder.ts`), the
installed `graphql-yoga@5` source in `node_modules/graphql-yoga/cjs/`, `app/server/prisma/schema.prisma`,
and the existing client transport (`app/client/src/lib/api-fetch.ts`, `token.ts`).

**Headline: the schema is a good Apollo fit.** Nothing in it is Houdini-shaped in a way Apollo can't
express. There are **3 recommended server changes** (all additive, all small), 4 optional ones, and a
well-bounded list of client accommodations — the largest of which is the loss of Houdini's automatic
list mutation handling and automatic key-field injection.

---

## A. Server-change-recommended (do before the client starts)

### S1. `BookValidatePayload` must return `book: Book!` — **the one genuine schema bug for a normalized cache**

```graphql
type BookValidatePayload { validation: Validation! }   # today
union BookValidateResult = BookValidatePayload
```

`Validation` has no `id` and is deliberately not a `Node` — correct, it is a child of `Book`. But that
means Apollo (like Houdini) can only ever write a `Validation` into the cache *through its parent*.
`bookValidate` returns a bare `Validation` with no parent reference, so **the freshly-computed
validation cannot be merged into `Book.validation` at all** — the client must either refetch the book
or hand-write a `cache.modify` keyed on a book id it happens to still hold in a closure. Every other
mutation in the schema returns its entity; this one is the exception.

Fix (additive, non-breaking):

```graphql
type BookValidatePayload {
  book: Book!          # add — client selects `book { id validation { ... } }`
  validation: Validation!   # keep for parity if desired
}
```

Note this is *not* Apollo-specific — Houdini has the identical problem. Worth fixing regardless of
which client wins.

### S2. Expose `Progress.userId: ID!` — `document` alone is a colliding cache key

The spec's Phase-2 handoff says "`Progress` keys on `document`". That is **wrong as a cache key**, and
Prisma proves it:

```prisma
model Progress { userId String; document String; ...  @@id([userId, document]) }
```

The primary key is the pair. `document` is a KOReader document id — a content hash — so two users who
own the same book have *the same* `document` value. An admin screen that reads
`user(id: A).library.progress` and then `user(id: B).library.progress` would collapse both users' rows
onto one cache entity and show A's position under B's name. The GraphQL type exposes no tenant
discriminator at all (`deviceId` is the writing device, not the owner).

Fix (additive): add `userId: ID!` to `Progress` (the Prisma row already carries it — `progress/model.ts`
already reads `progress.userId` internally for `currentChapter`). Client then uses
`keyFields: ["document", "userId"]`.

Alternative without a server change: `Progress: { keyFields: false }` (never normalize), which costs
the live-update behaviour that made `progressSet` return the entity in the first place. Not recommended.

### S3. Resolve the open `PendingFix` cache-key question — **add `PendingFix.id: ID!`** (recommendation)

This is the decision the spec explicitly deferred ("Decide before fragments freeze on `PendingFix`").
Facts:

- `PendingFix`'s Prisma PK is composite: `@@id([userId, bookId])` — there is no single scalar to expose.
- The GraphQL type has no scalar identifier; only `book: Book!`.
- It is reachable from two places (`Book.pendingFix`, `Library.pendingFixes`), so without a key Apollo
  stores **two independent embedded copies** and `bookResolvePendingFix` updates neither reliably.
- Re-adding `bookId: String!` (the option the spec floated) would **undo the book-relay-id plan** — that
  plan's whole point was that no output field exposes a raw content hash.

Three options, ranked:

1. **(Recommended) Server adds `PendingFix.id: ID!` = the owning Book's global ID.** Purely additive,
   exposes zero new information (it is byte-identical to `Book.id`, already public), and follows the
   *existing precedent in this schema*: `Device` has an `id` and deliberately does **not** implement
   `Node` ("Houdini keys and normalizes on it, but there is no ungated `node()` door" — spec, read-model
   ledger). Apollo then normalizes `PendingFix` with **zero typePolicy config and zero fragment
   discipline**, and `bookDelete`/`bookResolvePendingFix` evictions become mechanical.
   Cache key: `PendingFix:<book global id>` — tenant-unique, because `Book.id` is
   `base64("Book:" + JSON.stringify([userId, bookId]))`.
2. Client-only: `PendingFix: { keyFields: ["book", ["id"]] }` (Apollo's nested-key syntax). Works, no
   server change — but it is **fragile**: every single selection of a `PendingFix` anywhere must include
   `book { id }` or Apollo silently falls back to non-normalized and logs a cache-write warning. Needs a
   lint rule to be safe.
3. `keyFields: false` (never normalize) + manual invalidation of both parents after
   `bookResolvePendingFix`. Simplest to write, worst to live with; this is exactly the "invalidate both
   copies by hand" outcome the spec warned about.

Take option 1. It costs ~6 lines in `pending-fix/model.ts` and removes an entire class of client bugs.

---

## B. Server changes — optional / worth a deliberate decision

### S4. Decide `Viewer.users` / `Device.enabledUsers` nullability (the spec's own open "shape decision")

`defaultFieldNullability: false` + an `admin` auth scope on these two fields means a non-admin selecting
either **nulls the entire operation** (non-null propagation reaches the root). Under Apollo the
consequence is sharper than under Houdini: Apollo's default `errorPolicy: "none"` **discards `data`
entirely** when `errors` is present, so one accidentally-included admin field in a shared fragment
blanks an otherwise-good screen and writes nothing to the cache. Recommend making both nullable
(`[User!]`), so the failure is local. If they stay non-null, set `errorPolicy: "all"` client-side and
never colocate those fields with non-admin data.

### S5. Add a regression test pinning HTTP content negotiation (cheap, high value — see §E)

The whole Apollo auth-refresh story depends on yoga answering
`Accept: application/graphql-response+json,application/json;q=0.9` **with**
`Content-Type: application/graphql-response+json`. Verified true today by reading
`plugins/use-result-processor.js` + `result-processor/accept.js`, but nothing in the repo pins it, and
`yoga.test.ts` only exercises the supertest default (`*/*` → `application/json`). One test:

```ts
it('answers Apollo's Accept header with application/graphql-response+json and keeps error extensions', ...)
// assert: status 401, content-type startsWith 'application/graphql-response+json',
//         body.errors[0].extensions.code === 'UNAUTHENTICATED'
```

If this ever regresses to `application/json`, Apollo v4 throws an opaque `ServerError`, `extensions` is
gone, and silent-refresh dies. See §E for the mechanism.

### S6. Optional: give `ScanStatus` an `id: ID!` alongside `jobId: ID!`

`ScanStatus` is the one type where the *subscription* depends on cache identity. Today it has `jobId`,
not `id`, so Apollo won't normalize it by default and a `scanProgress` event will **not** update the
`Library.scanStatus` a screen already rendered. A one-line client typePolicy
(`ScanStatus: { keyFields: ["jobId"] }`) fixes it completely, so this is optional — but exposing `id`
(same value) makes it zero-config and consistent with `Device`/`PendingFix`.

### S7. Optional: `batching: true` in `createYoga` if you want `BatchHttpLink`

Yoga's request batching is **off** by default and it is off here. Apollo's `BatchHttpLink` would send a
JSON array body and get a 400. Not needed for v1 — flagged so nobody reaches for it and gets confused.

### S8. Non-issue, noted: `__typename` is always available

`__typename` is a graphql-js meta-field; nothing in the yoga config or the production
`useSchemaConcealment` plugin (which only installs `NoSchemaIntrospectionCustomRule` and strips
"Did you mean" suggestions) blocks it. Apollo v4 always injects `__typename` into every selection set
(the v3 `addTypename: false` escape hatch is gone), and the typed-error unions' literal `__typename`
discrimination works exactly as designed. **No change needed.**

---

## C. Cache identity — every object type in the SDL

Apollo default: `keyFields: ["id"]` if `id` (or `_id`) is present, otherwise the object is **not
normalized** and is stored inline inside its parent. Walking the whole SDL:

### Normalize cleanly, zero config

| Type | Key | Notes |
|---|---|---|
| `Book` | `id` (Relay global) | `base64("Book:[userId,bookId]")` → tenant-unique. Safe. |
| `Library` | `id` (Relay global) | Needs field-level `keyArgs`, see below — identity itself is fine. |
| `Series` | `id` (Relay global) | Prisma `Series.id` is a standalone `@id` (not composite), so the global ID is tenant-unique despite carrying no owner. Safe. |
| `User` | `id` (Relay global) | Safe. |
| `Device` | `id` (raw DB id, `t.exposeID('id')`) | Not a `Node` but has `id` → Apollo normalizes. `deviceDelete`'s `deletedDeviceId: String!` is the *same* value, so `cache.evict({ id: cache.identify({ __typename: 'Device', id: deletedDeviceId }) })` works directly. |

### Need explicit `typePolicies`

| Type | Problem | Recommendation |
|---|---|---|
| `Progress` | No id; real key is `(userId, document)` but `userId` is not exposed | **S2** + `keyFields: ["document", "userId"]`. Without S2: `keyFields: false`. |
| `PendingFix` | No scalar key at all (composite PK) | **S3** (`id`) → zero config. Else `keyFields: ["book", ["id"]]`. |
| `ScanStatus` | Has `jobId`, not `id` | `keyFields: ["jobId"]` (or S6). Required for the subscription to update `Library.scanStatus` in place. |
| `Viewer` | No id — a root singleton | `keyFields: []` → normalizes as the singleton entity `Viewer:{}`. **Do this.** Without it, `Viewer.devices` / `Viewer.users` / `Viewer.syncPassword` live inline under `ROOT_QUERY.viewer`, and every list mutation (deviceCreate/Delete, userRegister/Delete, userRegenerateSyncPassword) has to reach into a nested object via a `ROOT_QUERY` modify. This is one of the things Houdini did for free ("Houdini normalizes `Viewer` as a root singleton" — spec). |
| `Config` | No id, static singleton | `keyFields: []` (or leave inline; harmless either way). |

### Should stay unnormalized (correct as-is — no action)

`Validation`, `ValidationMessage`, `PendingFixState`, `UndoSnapshot`, `MetadataFix`, `Identifier`,
`LinkedDocument`, `EpubValidationMessage`, `InputIssue`, `Suggestion`, `SuggestionGroup`, `ScanResult`,
`PageInfo`, all `*Connection` / `*ConnectionEdge` types, all 23 `*Payload` types, and all 14
`UserError` implementors.

These are value objects owned by a parent, and inline storage is the right answer. Two notes:
- Error types that embed entities (`BookAlreadyExistsError.existingBook`, `BookHashCollisionError.collidingBook`,
  `DocumentAlreadyLinkedError.book`, `DocumentIsBookError.book`, `BookNotValidatedError.validation`,
  `ScanAlreadyRunningError.scanStatus`) hold **references** to normalized entities — so an error result
  still hydrates the cache usefully. Good design, keep it.
- `Validation` being inline is exactly why **S1** matters.

### Field-level `keyArgs` / pagination policies required on `Library` and `Series`

```ts
Library: {
  fields: {
    entries: relayStylePagination(["filter"]),      // union connection Book | Series
    progress: relayStylePagination(),
    book:     { keyArgs: ["id"] },
    seriesByName:      { keyArgs: ["name"] },
    seriesNextIndex:   { keyArgs: ["name"] },
    searchSuggestions: { keyArgs: ["query", "filter"] },
  },
},
Series:     { fields: { books:    relayStylePagination() } },
Validation: { fields: { messages: relayStylePagination() } },
Book:       { fields: { thumbnailUrl: { keyArgs: ["width"] } } },  // default already does this
```

`@apollo/client/utilities`'s `relayStylePagination` matches the schema's `edges { cursor node } pageInfo`
shape exactly (no `totalCount` needed). Caveat: it supports both directions, but `Library.entries` and
`Library.progress` **throw `BACKWARD_PAGINATION_UNSUPPORTED`** on `last`/`before` — only ever call
`fetchMore` forward on those two. `Series.books` and `Validation.messages` do support backward paging
(`t.relatedConnection`). Nothing to change server-side; just don't let a shared "paginate" hook assume
uniformity.

---

## D. Unions, interfaces, `possibleTypes`

Apollo needs a `possibleTypes` map to match fragments on the ~21 result unions, the `LibraryEntry` union
(`Book | Series`), the `Node` interface, and the `UserError` interface. Without it, Apollo falls back to
heuristic matching and logs "Missing field ... while writing result" / can mis-match.

**Recommended generation approach: GraphQL Code Generator against the committed SDL file** — *not* a
runtime introspection script. Reasons:

- `app/server/graphql/schema.generated.graphql` is committed and lint-enforced to match the built schema
  (`print-schema.test.ts` + `npm run lint`), so it is a first-class build input already.
- **Production introspection is disabled** (`useSchemaConcealment` installs `NoSchemaIntrospectionCustomRule`
  when `isProduction`), so an introspection-based generator would only ever work against a dev server.
  Pointing codegen at the file sidesteps that entirely and keeps codegen runnable in CI with no server.

Concretely, in `app/client`:

```yaml
# codegen.ts
schema: ../server/graphql/schema.generated.graphql
documents: src/**/*.{ts,tsx}
generates:
  src/gql/:                       { preset: client-preset }        # typed documents + fragment masking
  src/gql/possible-types.ts:      { plugins: [fragment-matcher] }  # possibleTypes for InMemoryCache
  src/gql/type-policies.ts:       { plugins: [typescript-apollo-client-helpers] } # typed TypePolicies
```

Wire the same `graphql:schema`-style lint check on the client side so a stale generated file fails CI,
mirroring what the server already does.

**Server changes to simplify: none.** `__typename` is always emitted (§S8), every union member is a
concrete object type, and the "always a `<Name>Result` union, even single-member" discipline means
codegen can branch on `__typename` uniformly — that discipline pays off more under Apollo than Houdini,
because Apollo has no compiler to warn about a non-exhaustive switch.

---

## E. Error model + auth: 401 + extensions + the cookie-refresh flow

### What the server does today (verified in source)

`builder.ts`'s `scopeAuth.unauthorizedError` emits
`GraphQLError('Not authenticated', { extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } } })`
(and `FORBIDDEN`/403). `graphql-yoga`'s `getResponseInitByRespectingErrors` (`cjs/error.js:93-136`)
honours `extensions.http.status` — it takes the **max** status across errors, and the
`isApplicationJson && error.extensions.http.spec` skip does **not** apply here (these errors set no
`spec` flag). So the response really is HTTP 401/403 with a full GraphQL body, in both content types.
`yoga.test.ts` pins the 401 + `UNAUTHENTICATED` code.

### What Apollo v4 does with that — the load-bearing detail

Apollo Client v4's `HttpLink` sends `Accept: application/graphql-response+json,application/json;q=0.9`,
and `parseAndCheckHttpResponse.ts` branches on the **response** content type:

- `application/graphql-response+json` → `parseGraphQLResponseJsonEncoding`, which **skips the
  `status >= 300` check** and parses the body. Errors arrive as `CombinedGraphQLErrors` with
  `extensions` intact.
- `application/json` → `parseJsonEncoding`, which **throws `ServerError` for any `status >= 300`** and
  (new in v4) **does not parse the body**. `extensions.code` is unreachable; you get `bodyText`.

Now trace yoga's negotiation for that exact Accept header (`use-result-processor.js` +
`accept.js#getMediaTypesForRequestInOrder`): the accept list is parsed, `q=0.9` is ignored, the list is
**reversed**, and `setResultProcessor` is called on every match with **last-write-wins**. Order becomes
`["application/json", "application/graphql-response+json"]` → the final assignment is
**`application/graphql-response+json`**.

**Conclusion: this works today, unmodified.** Apollo will see the 401 as `CombinedGraphQLErrors` with
`err.extensions.code === 'UNAUTHENTICATED'`, which is precisely what `ErrorLink` needs. No always-200
mode required, no `maskedErrors` change. But it hinges on a negotiation detail nobody wrote down —
hence **S5** (pin it with a test). Belt-and-braces: the client's error handler should *also* check
`ServerError.is(error) && error.statusCode === 401` so a regression degrades instead of breaking.

### Link chain the client needs (matches the existing REST refresh machinery)

The existing client is a *perfect* fit: `app/client/src/lib/api-fetch.ts` already exposes
`refreshAccessToken()` — single-flight in-tab **and** cross-tab via a `navigator.locks` mutex — plus
`ensureFreshToken()`. Auth is a Bearer token from `localStorage` (`lib/token.ts`), refreshed against
`POST /api/auth/refresh` using an httpOnly cookie. Nothing about that needs to change.

```ts
const authLink = new SetContextLink(({ headers }) => {
  const token = getToken();
  return { headers: token ? { ...headers, authorization: `Bearer ${token}` } : headers };
});

const refreshLink = new ErrorLink(({ error, operation, forward }) => {
  const isAuth =
    (CombinedGraphQLErrors.is(error) && error.errors.some(e => e.extensions?.code === 'UNAUTHENTICATED')) ||
    (ServerError.is(error) && error.statusCode === 401);          // defensive fallback
  if (!isAuth || operation.getContext().retried) return;
  operation.setContext({ retried: true });                        // one-shot, mirrors apiFetch
  // CORRECTED — the original line did not compile; see the note below.
  return observableFrom(refreshAccessToken()).pipe(
    mergeMap(ok => (ok ? forward(operation) : throwError(() => error)))
  );
});

const link = from([refreshLink, authLink, new HttpLink({ uri: '/graphql' })]);
```

> **CORRECTION 2026-08-03** (Apollo-client-migration plan,
> `../specs/2026-08-03-apollo-client-migration-design.md` §10, C1). This review is preserved
> verbatim apart from this note and the two corrected lines above. The original read
> `Observable.from(refreshAccessToken()).flatMap(ok => …)`, which **does not compile against
> Apollo Client v4**: v4 re-exports rxjs's `Observable` verbatim, and rxjs has no static
> `Observable.from` and no `.flatMap` operator method — use the standalone `from()` with
> `.pipe(mergeMap(...))`, and note rxjs 7's `throwError` takes a factory, not a value.
> Additionally, **`rxjs@^7.3.0` is a required peer dependency of `@apollo/client@4`** and is
> missing from §J's client-accommodation list below.

Order matters: `refreshLink` **before** `authLink`, so the retry re-reads the freshly stored token.
`credentials` needs no setting — everything is same-origin (Vite proxies in dev), and the refresh call
is plain REST outside Apollo. No CORS involved.

Two behavioural contracts to carry over from the spec: a successful `userChangePassword` means
**log out and navigate to `/login`** (no cookie reissue path exists over GraphQL); and `apiFetch`'s
one-shot semantics should be preserved so a permanently-dead refresh doesn't loop.

---

## F. Subscriptions over SSE

### Protocol compatibility — verified, they match

Yoga's SSE result processor (`cjs/plugins/result-processor/sse.js`) emits the GraphQL-over-SSE
**distinct-connections mode** wire format: an opening `:\n\n`, then `event: next` / `data: {...}` frames
and a terminal `event: complete`. Headers: `text/event-stream`, `Connection: keep-alive`,
`Cache-Control: no-cache`, `Content-Encoding: none`. **A `:\n\n` ping every 12 s is built in** — so
proxy/keepalive is already handled; no server config change for heartbeats.

Distinct-connections mode is `graphql-sse`'s **default** (`singleConnection: false`) and needs no
`/graphql/stream` endpoint. Single-connection mode would require `@graphql-yoga/plugin-graphql-sse`,
which is not installed — **don't enable `singleConnection`**.

### Apollo has no first-class SSE link — you write ~25 lines

> **CORRECTION 2026-08-03** (Apollo-client-migration plan,
> `../specs/2026-08-03-apollo-client-migration-design.md` §7.1 and §10 C5). This heading is
> **imprecise**. Tested against real `graphql-yoga@5.21.2`: Apollo's official `GraphQLWsLink`
> (`@apollo/client/link/subscriptions`), constructed with graphql-sse's `createClient()`,
> subscribes successfully, coexists with `HttpLink` under `split()`, and sends exactly
> `["extensions","operationName","query","variables"]` — **no `operationType` leak**.
> `GraphQLWsLink` names the graphql-ws client *interface*, not a WebSocket transport.
> Hand-rolling is still the right call, but for a narrower reason: graphql-sse's `Client<false>`
> lacks `on`/`terminate`, so the constructor is a type error requiring `as unknown as Client`
> plus a phantom `graphql-ws` dependency. **The practical consequence: model the hand-rolled
> link on Apollo's implementation (which is this recipe with the `operationType` bug already
> absent), not on the graphql-sse README recipe reproduced below.**

- `@graphql-sse/apollo-client` **exists but is dead**: latest `0.0.19`, published 2022-11, peer
  dependency `@apollo/client: "3x"`, and it pins `graphql@^15`. **Do not use it.**
- The supported path is graphql-sse's own documented Apollo recipe: a small `SSELink extends ApolloLink`
  wrapping `createClient()` from `graphql-sse`, combined with `split()` on `OperationTypeNode.SUBSCRIPTION`.

**Apollo v4 gotcha, must not be missed:** Apollo v4 attaches an `operationType` property to the
`operation` object. The stock recipe spreads `{ ...operation }` into `client.subscribe`, which puts
`operationType` in the request body — and yoga **rejects unknown body parameters** outright
(`plugins/request-validation/use-check-graphql-query-params.js`:
`expectedParameters = new Set(['query','variables','operationName','extensions'])` →
`Unexpected parameter "operationType" in the request body.`). It surfaces as a confusing 400. Destructure:

```ts
class SSELink extends ApolloLink {
  private client = createClient({
    url: '/graphql',
    headers: async () => {
      const token = await ensureFreshToken();          // reuse the existing helper
      return token ? { authorization: `Bearer ${token}` } : {};
    },
  });
  request(operation: Operation) {
    const { variables, operationName, extensions } = operation;
    const query = print(operation.query);
    return new Observable(sink =>
      this.client.subscribe({ query, variables, operationName, extensions }, {
        next: sink.next.bind(sink), complete: sink.complete.bind(sink), error: sink.error.bind(sink),
      }));
  }
}
```

Auth is a non-problem here **because graphql-sse uses `fetch`, not `EventSource`** — real
`Authorization` headers work, and the `headers` callback may be async, so it can call the existing
`ensureFreshToken()`. (This matters: the client today has no `EventSource` anywhere, and has already
built blob-URL and XHR workarounds precisely because `EventSource`/`<img>` can't carry a Bearer token —
none of that is needed here.)

### Server config: no changes required

CORS: none (same-origin). Credentials: not needed (header auth). Heartbeats: already emitted.
`authorizeOnSubscribe: true` is already set, so an unauthorized subscribe is refused at subscribe time
and arrives at graphql-sse as a network error, not a silent no-op stream.

### Client accommodations for the subscription

1. **Add `/graphql` to the Vite dev proxy** — `app/client/vite.config.ts` currently proxies only `/api`
   and `/logout`. Without it, dev queries 404 against the Vite server.
2. **Read `Library.scanStatus` right after `subscribe()` resolves**, and again on every reconnect — the
   spec's designed mitigation for yoga's lazy-`subscribe` startup race, unchanged under Apollo.
3. `ScanStatus: { keyFields: ["jobId"] }` (§C) so events update the already-rendered `Library.scanStatus`
   instead of writing an orphan.
4. Retire the existing 2 s polling loop in
   `app/client/src/provider/book/hook/use-scan-library.ts` only once the SSE path is proven — it is a
   perfectly good fallback while migrating.

---

## G. Scalars — `DateTime` and `JSON`

Houdini's `scalars` config would have unmarshalled these automatically. Apollo has **no scalar
marshalling** — `DateTime` arrives as the ISO-8601 string the `DateTimeResolver` serialized, `JSON`
arrives as an already-parsed value.

**Recommendation: codegen type mapping + parse at the display edge. Do not add `apollo-link-scalars`.**

```ts
// codegen.ts
config: { scalars: { DateTime: 'string', JSON: 'unknown' } }
```

Rationale for rejecting `apollo-link-scalars`: it needs the **executable schema in the browser bundle**
to walk each response — and since production introspection is disabled, that means bundling the SDL and
running `makeExecutableSchema` client-side (significant bundle + per-response traversal cost) for the
convenience of `Date` objects. A `formatDate(iso: string)` helper (or a branded `type ISODateString =
string`) is cheaper and more explicit. Every `DateTime` in the schema is display-only:
`Book.addedAt`/`mtime`, `Device.createdAt`/`updatedAt`, `PendingFix.createdAt`/`updatedAt`,
`Progress.timestamp`, `ScanStatus.startedAt`, `Validation.validatedAt`, `LinkedDocument.timestamp`.

For `JSON`: only `MetadataFix.changes` uses it, reached via `PendingFixState.autoFixes` / `.proposals` /
`.appliedFixes`, `UndoSnapshot`, and `BookAnalyzeReplacePayload`. Type it `unknown` and narrow at the one
render site rather than `any`.

**Server should emit nothing differently.** One nit worth knowing: `Progress.timestamp` is converted from
**seconds** (`epochSecondsToDate`) while every other timestamp is **milliseconds** (`epochToDate`) — both
serialize to correct ISO strings, so the client never sees the difference. No action.

---

## H. Mutations, optimistic UI, and what Houdini's list directives cost under Apollo

### Delete payloads are sufficient — with one wrinkle

- `bookDelete → { deletedId: ID!, library: Library! }`: `cache.evict({ id: cache.identify({ __typename: 'Book', id: deletedId }) })` works directly, because `Book`'s cache key *is* the global ID. Good.
- `userDelete → { deletedId, deletedUserId }`: same; `deletedUserId` is unused by Apollo, harmless.
- `progressDelete → { deletedDocument, library }`: with **S2**, evict via `cache.identify({ __typename: 'Progress', document: deletedDocument, userId })` — the client knows the `userId` because it passed it in the input.
- `deviceDelete → { deletedDeviceId }`: evict via `Device.id`. Good.

**Wrinkle — dangling refs inside connection edges.** Apollo automatically filters dangling references out
of arrays *of references*, but `LibraryEntriesConnection.edges` is an array of **edge objects** each
containing a `node` ref — those are **not** auto-filtered. After a `bookDelete` you must also:

```ts
cache.modify({
  id: cache.identify(library),
  fields: { entries: (conn, { readField, canRead }) =>
    ({ ...conn, edges: conn.edges.filter(e => canRead(readField('node', e))) }) },
});
```

Houdini's `@list` + `delete` directive did this for you. This helper is worth writing **once** and
reusing across `Library.entries`, `Library.progress`, `Library.pendingFixes`, and `Series.books`.

### The full manual-`update` inventory (the real Apollo workload)

| Mutation | Cache work Apollo needs |
|---|---|
| `bookDelete` | evict `Book` + filter `Library.entries` edges (+ `Library.pendingFixes`) |
| `progressDelete` | evict `Progress` + filter `Library.progress` edges |
| `progressSet` | **append** to `Library.progress` when the document is new (payload returns `library` + `progress`, but a returned parent does not re-materialize its connection) |
| `deviceCreate` | append to `Viewer.devices` (needs the `Viewer` singleton policy) |
| `deviceDelete` | evict `Device` + remove from `Viewer.devices` |
| `userRegister` | append to `Viewer.users` |
| `userDelete` | evict `User` + remove from `Viewer.users` |
| `userRegenerateSyncPassword` | payload returns `syncPassword` + `user`, but the field the UI reads is **`Viewer.syncPassword`** — needs an explicit `cache.modify` on the `Viewer` singleton |
| `userChangePassword` | update `Viewer.mustChangePassword`, then **log out** (spec contract) |
| `bookResolvePendingFix` | select `book { id pendingFix { ... } }` so the `Book` side self-heals; `Library.pendingFixes` still needs a manual filter |
| `bookValidate` | **blocked without S1** |
| `deviceEnableUser` / `deviceDisableUser` | free *if* you select `device { id enabledUsers { id } }` in the mutation |
| `bookReplace`, `bookUpdateMetadata`, `bookRegenChapters`, `bookClearEditions`, `bookLinkDocument`, `bookUnlinkDocument`, `libraryScan` | **free** — they return the mutated entity, Apollo normalizes and every screen updates |

That last row is the payoff of the "mutations return the entity they changed" rule — it translates to
Apollo 1:1. Roughly **10 of 23 mutations** need a hand-written `update`; the rest are automatic.

### Optimistic UI

Fully available (`optimisticResponse` + the same `update` function). Requirement: an optimistic response
must name a concrete union member's `__typename` (e.g. `{ __typename: 'BookDeletePayload', ... }`) and
supply every field the mutation selects. The single-member unions
(`bookDelete`, `bookClearEditions`, `bookValidate`, `userDelete`, `userResetPassword`,
`userRegenerateSyncPassword`) are the easy optimistic candidates.

### Every mutation result is nullable — a third branch

Most mutation fields are `Result` **without** `!` ("Resolves to null when the book does not exist"). Every
call site therefore branches three ways: `null` (entity gone) → typed error member → payload. Applies to
Houdini equally; just make sure the shared "unwrap a mutation result" helper models it.

---

## I. What Houdini gave for free that Apollo won't

1. **Automatic key-field injection.** Apollo injects `__typename` into every selection set but **never
   injects `id`**. Any query or fragment that omits `id` on a normalizable type silently produces an
   un-normalized object. Mitigate with `@graphql-eslint`'s `require-id-when-available` (or codegen's
   equivalent) configured for `id`, plus `jobId` on `ScanStatus` and `document`/`userId` on `Progress`.
   **This is the single highest-value client guardrail to set up on day one.**
2. **List directives** (`@list` / `@append` / `@prepend` / `@allLists`). Replaced by the ~10 manual
   `update` functions inventoried in §H, plus one shared edge-filtering helper.
3. **`Viewer` as an automatic root singleton** → an explicit `keyFields: []` typePolicy.
4. **Scalar unmarshalling** → §G.
5. **Persisted queries / operation manifest.** Houdini ships them; Apollo needs `PersistedQueryLink`
   *and* server support (`@graphql-yoga/plugin-apq`, not installed). Given `NoSchemaIntrospectionCustomRule`
   already conceals the schema in production, persisted queries would be a natural hardening follow-up —
   but it is net-new work under Apollo, not free.
6. **`Query.node` cache redirects.** Houdini uses `node()` to refetch individual entities automatically.
   Apollo won't — though you *can* write a `Query.fields.node` read policy that decodes the global ID
   client-side (`atob(id).split(':')[0]` → `__typename`) and returns `toReference(...)`. Optional polish;
   `Query.node` stays useful for explicit refetches regardless.
7. **Compiler-verified fragment/document typing.** Apollo's equivalent is the codegen `client-preset`
   (typed documents + fragment masking), which is close enough that fragment colocation is a wash — but
   it is a build step you must wire and CI-check yourself (§D).

---

## J. Ranked summary

### Server-change-recommended (before the client starts)
1. **S1** — `BookValidatePayload` gains `book: Book!`; a bare `Validation` cannot be written to the cache at all.
2. **S2** — expose `Progress.userId: ID!`; the Prisma PK is `(userId, document)` and `document` alone collides across users in admin views.
3. **S3** — add `PendingFix.id: ID!` (= owning `Book.id`; non-`Node`, the `Device` precedent) to close the open cache-key decision.
4. **S5** — pin the `application/graphql-response+json` negotiation + 401 `extensions.code` with a test; Apollo's silent-refresh depends on it.
5. **S4** — decide `Viewer.users` / `Device.enabledUsers` nullability (recommend nullable).
6. **S6/S7** (optional) — `ScanStatus.id` alias; `batching: true` only if `BatchHttpLink` is wanted.

### Client-accommodation (document, no server change)
- `typePolicies`: `Viewer`/`Config` `keyFields: []`; `ScanStatus` `keyFields: ["jobId"]`; `Progress` composite key; `relayStylePagination` on 4 connection fields; `keyArgs` on `Library`'s argument-taking fields.
- `possibleTypes` + typed documents via graphql-codegen against the **committed SDL** (production introspection is disabled).
- Lint rule forcing `id` (and `jobId`/`document`) into every selection — Apollo does not add them.
- Hand-rolled `SSELink` over `graphql-sse` (distinct-connections default), **destructuring `operation`** to avoid yoga's unknown-parameter 400; the dead `@graphql-sse/apollo-client` package must not be used.
- `ErrorLink` → `SetContextLink` → `HttpLink`, reusing the existing `refreshAccessToken()` / `ensureFreshToken()` and their `navigator.locks` single-flight; one-shot retry.
- `/graphql` added to the Vite dev proxy.
- ~10 mutations need hand-written `update` functions + one shared connection-edge filter helper.
- Scalars typed as `string`/`unknown`, parsed at the display edge.
- Every mutation result is nullable — three-way branching.

### No-issue
- Typed error unions + literal `__typename` discrimination — transport-agnostic, and `__typename` is always emitted (Apollo v4 always requests it).
- Relay `Node` / global IDs / connections — exactly what Apollo's normalized cache wants; `Book`/`Series`/`User`/`Library` global IDs are all tenant-unique.
- Cookie/`credentials`, CORS, SSE heartbeats — all already correct; same-origin Bearer auth needs nothing.
- Binary transfers staying on REST (`coverUrl` / `downloadUrl` / `thumbnailUrl` as server-computed strings, staged-upload REST endpoints) — Apollo-neutral, and the existing blob-URL helper keeps working unchanged.
- `maskedErrors` in production, the schema-concealment plugin, and `authorizeOnSubscribe` — no Apollo interaction.
