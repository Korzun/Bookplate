# GraphQL server migration — design

**Date:** 2026-07-30
**Branch:** `graphql-migration`
**Status:** implemented — all five delivery steps shipped (`e586042a..48871ff2`); see
"Phase 4 outcome" below for the mutations/scan-subscription handoff to the client migration

## Context

Bookplate's app API is REST: roughly 39 endpoints across `routes/ui.ts` (1445 lines),
`routes/users.ts` and `routes/devices.ts`. The client consumes them through ~45
hand-written hooks calling `apiFetch`, with cache, loading and error state hand-rolled
in context providers — `provider/book/provider.tsx` holds eleven `useState`s doing the
work of a normalized cache.

The goal is to move the app API to GraphQL (graphql-yoga + Pothos) and the client to
Houdini. This document covers the server only. *(Superseded 2026-08-02 by the
pre-client-polish plan: the client target is now **Apollo Client**, not Houdini. Every
mention of Houdini below describes the original design rationale/history; the current
handoff for whoever writes the client is "Phase 2 (Apollo Client) inputs" further down.)*

## Scope

The migration is three specs. Each ships independently and leaves the app working:

1. **This spec.** Stand up graphql-yoga + Pothos covering the app API, running alongside
   the existing REST routes. No client changes.
2. **Client → Apollo Client** *(originally Houdini; superseded 2026-08-02, pre-client-polish
   plan)*. Migrate the data layer query by query.
3. **Cleanup.** Delete the REST routes and tests that nothing calls any more.

Specs 2 and 3 get their own brainstorm when spec 1 lands.

### Out of scope for this spec

- Any client change. `app/client` is untouched.
- Any REST deletion. `routes/ui.ts` and its 3743-line test suite stay exactly as they are.
- `/opds` and `/sync` (kosync). These are published protocols consumed by e-readers and
  KOReader; they stay REST permanently, not just for now.
- Authentication endpoints. `POST /api/login`, `/api/auth/refresh`, `/api/auth/logout` and
  `GET /api/public-config` stay REST — the client needs a token before it can send a query,
  and `public-config` is fetched pre-auth by the login page.
- Binary transfer. Cover images, thumbnails, EPUB downloads and multer uploads stay REST.
  GraphQL exposes URLs to them, not bytes.
- Query complexity/depth limiting. Every GraphQL field is authenticated and this is
  self-hosted. Revisit if the API is ever publicly exposed.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Slicing | Server first, then client, then cleanup | Server work is verifiable by tests alone, before any UI churn |
| API boundary | JSON app API only; auth and binaries stay REST | Cookie plumbing in resolvers buys nothing; bytes belong on plain HTTP |
| Schema shape | Graph-native, not a mirror of REST payloads | It's the version we'd end up at anyway; mirroring pays GraphQL's costs without its benefits |
| Data access | Prisma plugin for reads, stores for writes | Selection-derived selects and no N+1 on reads; 1580 lines of tested write logic stays put |
| Multi-tenancy | `Library` reached through its owning `User` | Ownership is part of the query, so a normalized client cache can't serve one library's list for another |
| Keying | User **id**, never username | REST is username-keyed and every handler's first act is `getUserIdByUsername`; ids delete that lookup and the rename failure mode |
| Errors | Typed unions for expected failures; throw the rest | The stores already throw seven structured domain errors |
| Validation | `@pothos/plugin-validation` (Standard Schema / zod) | Replaces hand-rolled `ISO_8601_RE`, `VALID_STATUSES`, take-clamping in `ui.ts`, and feeds the errors plugin |
| Scan updates | Subscription with live progress | See "Scan progress" below |
| Testing | Schema-level bulk + thin HTTP suite | Existing test harness already runs real SQLite, so schema-level tests are integration-depth |
| Style | Functional in new code; existing stores consumed as-is | One thin adapter seam between paradigms, and no risk to tested write logic |

## Implementation style

New code under `graphql/` is written functionally. Concretely:

**No classes.** Modules of exported functions. Dependencies arrive as arguments — resolvers
receive `context`, helpers receive what they need. No module-level mutable state and no new
singletons beyond the Prisma client and store instances already constructed in `index.ts`.

**No in-place mutation.** Values are derived, not modified.

**Errors are values, and there is exactly one `try`/`catch` per mutation.** It lives in a
`toResult` adapter that maps known store exceptions onto typed error values:

```ts
const toResult = async <T>(run: () => Promise<T>): Promise<Result<T, UserError>> => { ... };
```

The adapter converts only the seven known domain error classes; anything else is re-thrown so
it still reaches yoga's masking and the error log. Resolver bodies themselves contain no
`try`, no `catch` and no `throw`.

**Shared derivations are pure functions** — JSON-column parsing (`identifiers`, `subjects`,
`chapterSpineMap`, `chapterNames`), epoch-column conversion, and the CFI-to-chapter
derivation `GET /api/my/progress` performs. This is the same rule that keeps the GraphQL and
OPDS read paths from drifting, so purity and correctness point the same way here.

*(Corrected after implementation: this originally also listed "validity-from-threshold". No
such derivation exists or is needed — `Validation.valid` turned out to be a stored column,
written once at validation time, not computed at read time. `derive.ts` holds the JSON
parsers, `epochToDate`, `epochSecondsToDate` and `deriveCurrentChapter`.)*

**Two named exceptions, stated rather than pretended away:**

1. *Pothos's builder is side-effectful by design.* `builder.*` calls at module scope and the
   side-effect imports in `schema/**/index.ts` are the framework's registration model. Exempt.
2. *The existing store classes stay classes.* They are called directly from the `toResult`
   adapters. Refactoring `BookStore` and friends into function modules is an explicit
   non-goal of this spec — it would rewrite the most side-effect-heavy code in the project,
   and its 3702-line test suite, inside what is otherwise an additive migration.

## Dependencies

`graphql@^16` (yoga does not accept 17 yet), `graphql-yoga@^5`, `@pothos/core@^4`, and the
`plugin-relay`, `plugin-prisma`, `plugin-errors`, `plugin-scope-auth` and `plugin-validation`
plugins, plus `zod` and `graphql-scalars`. The Prisma plugin adds a `generator pothos` block
to `schema.prisma`.

## Architecture

Yoga mounts at `POST /graphql` in `server.ts`, before the SPA catch-all
(`router.get('*', serveSpa)`). Nothing else in `server.ts` changes: `/opds`, `/sync` and
`/api/*` keep working. The existing `requestTimeout(90_000)` and `requestLog()` middleware
wrap it, so timeouts and access logs apply unchanged.

### Layout

Modelled on `SplitSplit/api-service`: one entity per directory, one field per file, each
field self-registering via a side-effect import.

```
app/server/graphql/
  context.ts                    Context type + factory
  yoga.ts                       createYoga wiring, masking, GraphiQL (dev only), Express mount
  test-util.ts                  test harness: temp sqlite + migrations + real stores + execute()
  schema/
    builder.ts                  SchemaBuilder: plugins, scalars, auth scopes, defaults
    index.ts                    side-effect imports every entity → toSchema() → print()
    print.ts                    writes schema.generated.graphql (lexicographicSortSchema)
    error.ts                    UserError interface + typed domain error objects
    library/    index.ts  model.ts
                query/scan-status.ts
                mutation/scan.ts
                subscription/scan-progress.ts
    book/       index.ts  model.ts
                query/get.ts  query/get-all.ts  query/search-suggestions.ts  query/lineage.ts
                mutation/update-metadata.ts   mutation/delete.ts
                mutation/replace.ts           mutation/analyze-replace.ts
                mutation/regen-chapters.ts    mutation/validate.ts
                mutation/link-document.ts     mutation/unlink-document.ts
                mutation/clear-editions.ts    mutation/resolve-pending-fix.ts
    series/     index.ts  model.ts  query/get.ts  query/get-all.ts  query/next-index.ts
    validation/ index.ts  model.ts
    progress/   index.ts  model.ts  query/get-all.ts  mutation/set.ts  mutation/delete.ts
    device/     index.ts  model.ts  query/get.ts  query/get-all.ts
                mutation/create.ts  mutation/update.ts  mutation/delete.ts
                mutation/enable-user.ts  mutation/disable-user.ts
    user/       index.ts  model.ts  query/current.ts  query/get.ts  query/get-all.ts
                mutation/register.ts  mutation/delete.ts  mutation/change-password.ts
                mutation/reset-password.ts  mutation/regenerate-sync-password.ts
  schema.generated.graphql      committed; spec 2's Apollo codegen (graphql-codegen,
                                 client-preset) consumes it — Houdini codegen was the
                                 original plan, superseded 2026-08-02
```

`schema/<entity>/index.ts` re-exports `model` and side-effect-imports each field file, as in
the reference project.

Most `query/` files register onto `Library` rather than onto `Query`, using
`builder.objectField(Library, ...)` — `book/query/get-all.ts` defines `Library.entries`,
`series/query/get-all.ts` defines `Library.series`, and so on. This keeps the one-field-
per-file rule while leaving `library/model.ts` small: it holds only the fields that belong to
no other entity (`subjects`, `authors`, `user`). Only `user/query/current.ts`,
`user/query/get.ts` and the `node` field register onto `Query` itself.

### Builder defaults

`defaultInputFieldRequiredness: true`; non-null edges, nodes and fields;
`relay: { clientMutationId: 'omit', cursorType: 'String' }`. Unlike the reference project,
`Query.node` stays enabled — a normalized client cache (Apollo) can use it to refetch
individual entities directly.

### Layer boundaries

Resolvers read via `context.prisma.<model>` (spreading Pothos's `query`) and write via
`context.stores.<store>`. The reference project's `business/` layer is deliberately not
copied: `services/*-store.ts` already fills that role, and adding it would mean a third
layer that forwards to both.

Read logic that more than one read path needs — parsing the JSON-string columns
(`identifiers`, `subjects`, `chapterSpineMap`, `chapterNames`), converting the epoch columns,
and deriving the current chapter from a reading CFI plus a spine map — moves into pure
functions in `derive.ts` that every path calls, so the read paths cannot drift.

*(Corrected after implementation: "deriving validity from the threshold" was listed here and
does not exist. `Validation.valid` is a stored column, so there was never anything to
derive. The list above is what `derive.ts` actually holds.)*

## Schema

### Entry points

A library hangs off the user who owns it. There is exactly one path to each.

```graphql
type Query {
  viewer: Viewer!
  user(id: ID!): User        # admin-only scope; id is typed to User
  node(id: ID!): Node
  nodes(ids: [ID!]!): [Node]!
  config: Config!            # server-wide, every authenticated viewer
}

type Config {               # GET /api/config; NOT /api/public-config, which stays REST
  libraryName: String!
  maxConcurrentUploads: Int!
}

type Viewer {
  username: String!
  isAdmin: Boolean!
  mustChangePassword: Boolean!    # always false for the config-based admin
  syncPassword: String       # null for the config-based admin (REST 403s it)
  user: User                 # null for the config-based admin, which has no User row
  library: Library           # null for admins — they have no library of their own
  users: [User!]!            # admin-only scope
  devices: [Device!]!        # NOT admin-only: REST's GET /api/devices is open
}

type User implements Node {
  id: ID!                    # global ID over User.id
  username: String!
  mustChangePassword: Boolean!
  progressCount: Int!        # the "N books synced" figure the admin list renders
  library: Library!          # traversal is scoped: self or admin
}

type Library implements Node {
  id: ID!                    # global ID over the owning user's id
  user: User!
  entries(first: Int, after: String, filter: LibraryFilter): LibraryEntriesConnection!
  book(id: String!): Book    # the RAW content hash, not a global ID
  series: [Series!]!
  seriesByName(name: String!): Series
  seriesNextIndex(name: String!): Int!
  subjects: [String!]!
  authors: [String!]!
  searchSuggestions(query: String!, filter: SearchSuggestionsFilter): [SuggestionGroup!]!
  progress(first: Int, after: String): LibraryProgressConnection!
  pendingFixes: [PendingFix!]!
  scanStatus: ScanStatus     # deferred to the scan-progress step
}
```

Four shapes here differ from the sketch this section originally carried, each for a reason
established during implementation:

- **`searchSuggestions` takes `SearchSuggestionsFilter`, not `LibraryFilter`.**
  `getSearchSuggestions` reads only three of `LibraryFilter`'s six fields, two of them typed
  enums it has no parameter for. Accepting the wider input would silently drop client input
  with no schema-visible signal.
- **`progress` is a connection, not a list.** REST already paginates it with a keyset cursor
  clamped to 1..100, and the list grows with every book opened on any device. It is the
  second connection; the "only `library.entries` is a connection" rule below still holds for
  everything else.
- **`pendingFixes` returns the merged `PendingFix` type, not a separate summary.**
  *(Corrected by the schema-cleanup pass, 2026-08-01: this originally read "`pendingFixes`
  returns `PendingFixSummary`, not `PendingFix`," because `getPendingFixes` returned a DTO
  structurally different from the Prisma row — no `userId`, `createdAt` or `updatedAt` — and
  reimplementing its TTL cleanup to read rows directly looked worse than keeping the split.
  That tradeoff was revisited: `PendingFixSummary` is deleted, `Library.pendingFixes` now
  resolves Prisma rows directly through a shared `isLivePendingFix` liveness predicate
  extracted from the store's own logic, and `PendingFix` gained `book: Book!` so the list
  stays navigable in one round trip. `Book.pendingFix` returns the same type. See
  `2026-08-01-schema-cleanup-design.md` §3.)*
- **`book(id:)` takes the raw content hash**, matching REST and the client's routing.
  *(Corrected by the book-relay-id plan, 2026-08-02: this bullet originally continued,
  "`Book.bookId` exposes the same value so the two can round-trip." `Book.bookId` is removed —
  Book's only identifier in the schema is now the Relay global `id` — so there is no longer a
  round-trip from a fetched `Book` back to the raw hash this argument takes. The argument
  itself is untouched: it is a `Library` field lookup, not a book mutation, and stayed out of
  that plan's scope. See `2026-08-02-book-relay-id-design.md`.)* *(Superseded by the
  pre-client-polish plan, 2026-08-02, Task 2: `Library.book(id: String!)` → `Library.book(id:
  ID!)` — the arg is now a `Book` global ID, not the raw content hash, closing the one-way
  street the schema-design review (`docs/superpowers/reviews/2026-08-02-schema-design.md`,
  B1) flagged: a client holding a `Book.id` from anywhere else in the schema can now feed it
  here directly, with the same decode/deny machinery the book mutations use. Denial (owner
  mismatch or malformed id) resolves `null`, never a permissions error.)*

`Viewer` is not a `Node`. The config-based admin has no `User` row — `RefreshToken.userId`
is nullable precisely for it, and `users.ts` refuses to reset "the built-in admin password" —
so a `User`-backed id is impossible for it. Houdini would normalize `Viewer` as a root
singleton automatically; Apollo needs the same effect from an explicit `keyFields: []`
typePolicy (see "Phase 2 (Apollo Client) inputs" below) — either way `Viewer` is correctly a
singleton, not a `Node`.

`Library` implements `Node` even though it is 1:1 with a `User`: its global ID is the user id
under a different type, which gives a normalized client cache (Apollo) a stable
normalization key and lets the library switcher refetch a library through `node(id:)`.

`seriesNextIndex` hangs off `Library` rather than being a field on `Series`, because the
client asks for it while assigning a book to a series that may not exist yet — there is no
`Series` node to hang it on.

The types not spelled out here — `LibraryFilter`, `SuggestionGroup`, `Identifier`,
`PendingFix`, `LinkedDocument`, `InputIssue`, `Progress`, `Series`, `Validation`,
`ValidationMessage`, `Device` — are direct translations of the existing REST payloads and
Prisma models. The implementation plan pins their exact fields.

### The reading model

```graphql
union LibraryEntry = Book | Series

type Book implements Node {
  id: ID!                    # the Relay global ID
  title: String!  titleSort: String!  author: String!  authorSort: String!
  description: String!  publisher: String!  publishDate: String!
  series: Series             # the relation, not the denormalized string column
  seriesIndex: Float!
  subjects: [String!]!
  identifiers: [Identifier!]!
  size: Int!  pageCount: Int!  chapterCount: Int!
  chapterNames: [String!]  chapterSpineMap: [Int!]!
  mtime: DateTime!  addedAt: DateTime!
  hasCover: Boolean!
  coverUrl: String!  thumbnailUrl(width: Int!): String!  downloadUrl: String!
  validation: Validation
  pendingFix: PendingFix
  progress: Progress
  deviceEditionCount: Int!
  lineage: [LinkedDocument!]!
}

type Progress {
  document: String!          # the raw book id this progress is keyed by
  position: String!  percentage: Float!
  device: String!  deviceId: String!
  timestamp: DateTime!       # stored in SECONDS; converted, not exposed raw
  currentChapter: Int        # derived from `position` + the book's chapterSpineMap
}

type Device {
  id: ID!  name: String!  slug: String!
  coverWidth: Int  coverHeight: Int  coverFit: CoverFit!
  bwCover: Boolean!  simplify: Boolean!
  createdAt: DateTime!  updatedAt: DateTime!
  enabledUsers: [User!]!     # admin-only scope, matching GET /api/devices/:id/users
}
```

*(Corrected by the schema-cleanup pass, 2026-08-01, in three places above: `Progress.progress`
is renamed `position` — the old name survives nowhere, so `derive.ts`'s CFI-to-chapter
derivation now reads it as `position` too. `Device.coverFit` is retyped from `String!` to the
new `CoverFit` enum (`CONTAIN COVER FILL SMART`), stored casing unchanged. And this block
originally also spelled out a `PendingFixSummary` type here — deleted along with its DTO
split: `Library.pendingFixes` and `Book.pendingFix` both return the single merged `PendingFix`
type, which gained `book: Book!` so the list stays navigable in one round trip.
`PendingFix`'s full shape, including the typed `PendingFixState` object graph that replaced
its JSON-string `state` field, is spelled out in `2026-08-01-schema-cleanup-design.md` §2–3,
not duplicated here. Further corrected by the book-relay-id plan, 2026-08-02: the `type Book`
block above originally also carried a `bookId: String!` field, commented "the raw content
hash — what every sibling id field carries." That field is removed — Book's only identifier in
the schema is now the Relay global `id`. See the note immediately below and
`2026-08-02-book-relay-id-design.md`.)*

Five notes:

**Raw content hashes still travel through the schema — just not via `Book` itself any more.**
*(Corrected by the book-relay-id plan, 2026-08-02: this note originally opened, "`Book.bookId`
is not redundant with `Book.id`," arguing the two fields coexisted because
`Progress.document`, `LinkedDocument.oldId`/`newId` and `Library.book(id:)` also speak raw
content hashes. `Book.bookId` is now removed — Book's only identifier in the schema is the
Relay global `id` — so that argument no longer applies to `Book` itself. It still applies to
the three sibling sites below, none of which are book mutations, so all three stayed out of
that plan's scope.)* `Progress.document`, `LinkedDocument.oldId`/`newId` and `Library.book(id:)`
all speak raw content hashes, and the client routes and builds binary URLs from them.
*(Corrected by the schema-cleanup pass, 2026-08-01: this list originally also named
`PendingFixSummary.bookId`. That field is gone along with the type — the merged `PendingFix`
reaches its book via `book: Book!` instead of a raw id.)* The Book global ID is base64 over
`JSON.stringify([userId, id])`, so the hash cannot be recovered from it client-side.

**`Progress.timestamp` is a `DateTime`, though the column is an `Int` of seconds.** KOReader's
sync protocol writes seconds; every other epoch column in the schema is milliseconds. Exposing
the raw number would put any client that trusted the schema's own convention in 1970. The
conversion is a separate named function (`epochSecondsToDate`) precisely so it cannot be
confused with the millisecond one at a call site where both take a bare number.

**Binaries are URLs.** `coverUrl`, `thumbnailUrl(width:)` and `downloadUrl` are strings
pointing at the REST endpoints, which are unchanged. The client keeps using `<img>` and
`use-authorized-src`.

**`Book.progress` is a real graph win.** `Progress` rows are keyed by KOReader `document`
hash and join to books through `BookIdHistory`. The client currently fetches both lists and
joins them by hand; here it is a field.

**`library.entries` is the one read that does not use the Prisma plugin.** It is a
`t.connection` with a manual resolver delegating to `bookStore.listBooksPage`, preserving its
existing base64 cursor. Its book/series interleaving and composite cursor are already written
and tested, and `prismaConnection` cannot span a union. Every other relation —
`Book.validation`, `Book.series`, `Series.books`, `Validation.messages` — uses
`prismaField`/relations so Pothos derives the selects.

### Pagination

`library.entries` and `library.progress` are connections. Subjects, authors, users and devices
stay plain lists: they are small and unpaginated today, and connections would be ceremony. The
Relay plugin earns its place through `Node` and global IDs, which a normalized client cache
(Apollo) needs, plus
these connections.

*(Corrected after implementation: this originally said "only `library.entries`". `progress`
was overlooked — REST paginates it too, with a keyset cursor clamped to 1..100, and it grows
with every book opened on any device, so it belongs in neither exemption.)*

*(Corrected by the schema-cleanup pass, 2026-08-01: this paragraph also used to list
"validation messages" among the plain lists and say "plus those two connections." Neither
holds any more. `Series.books` and `Validation.messages` became `t.relatedConnection`s —
validation output for a broken EPUB can run to hundreds of rows, the one list in the schema
with realistic hundreds-of-rows growth. There are four connections in the schema now, not two.
See `2026-08-01-schema-cleanup-design.md` §5.)*

`library.entries` and `library.progress` follow the same shape: the store owns the keyset and
mints `endCursor`, which is forwarded byte-for-byte rather than recomputed; `after` is decoded
by the very function REST's own handler calls; and `last`/`before` — which `t.connection` adds
to the SDL unconditionally — are rejected with `BACKWARD_PAGINATION_UNSUPPORTED` rather than
silently serving the leading page, since neither store has a backward keyset to walk. This is
a deliberate asymmetry with the two newer connections: `Series.books` and
`Validation.messages` wrap Prisma relations via `t.relatedConnection`, which supports
`last`/`before` natively, so those two genuinely honour backward pagination rather than
rejecting it. Documented at both sites (see the cleanup spec's Testing section).

## Auth, context and scopes

### Context

`context.ts` reads `Authorization: Bearer` and reuses the existing `verifyAccessToken` from
`services/jwt`. No new token logic.

```ts
type Context = {
  viewer: { userId: string | null; username: string; isAdmin: boolean } | null;
  prisma: PrismaClient;
  stores: { book; user; device; edition; validation; scanJob; thumbnailQueue };
  config: AppConfig;
};
```

`viewer.userId` is null for the config-based admin.

### Scopes

```ts
authScopes: (context) => ({
  authenticated: context.viewer !== null,
  admin: context.viewer?.isAdmin === true,
  ownerOf: (userId: string) =>
    context.viewer?.isAdmin === true || context.viewer?.userId === userId,
});
```

`authenticated` is the builder default with **no exceptions** — login and `public-config`
stay REST, so no unauthenticated GraphQL field exists. `admin` gates `Query.user`,
`Viewer.users`, and the device and user mutations. `ownerOf` gates one field: `User.library`.

### Why the security surface is small

`Library` is backed by an `Owner { userId, username }` that only two resolvers can mint:
`Viewer.library` (self, by construction) and `User.library` (scope-checked). Every field
beneath a `Library` reads the owner off its parent. So "can this viewer see this library?"
is decided in one place, rather than at every route that touches a library, which is how
`resolveOwner` works today.

The username is still resolved alongside the id, because the books directory on disk is
named by username (`deleteUser` does `rmSync(booksRoot/<username>)`). The stores keep their
current `Owner` signature untouched; only the direction of lookup changes, from
username→id to id→username.

### Errors and operations

Yoga runs with `maskedErrors` in production, and GraphiQL and introspection are disabled
there. Unexpected throws are logged through `logger('GraphQL')`. Typed domain errors are
ordinary return values, so masking does not touch them.

## Mutations

Named `<entity><Verb>`, one per file with their input types alongside.

*(Corrected after implementation, delivery step 4: this originally said "declared via
`builder.relayMutationField` with `clientMutationId: 'omit'`." Both plugin mechanisms were
tried and rejected at Task 1 — verified at plugin source, not by preference. `relayMutationField`
hard-sets the field's return type to the payload object *after* spreading the caller's
options, so there is no way to make it resolve to a typed error union. `@pothos/plugin-errors`
was tried too: `extractAndSortErrorTypes` keeps only *classes* passed to `errors.types`, and
this schema's error values are plain data shapes carrying a resolved `Owner` (e.g.
`collidingBook: Book!`), not exception instances. The plugin stays installed — it appears in
the plugin order below for its historical role in Phase 1's `dmmf`/ordering work — but no
mutation uses either mechanism. Every mutation is `builder.mutationField(name, ...)` with an
explicit, hand-authored `<Name>Input` and a `<Name>Result` union of hand-authored `<Name>Payload`
plus zero or more error types, every union member carrying a literal `__typename` so
graphql-js's default type resolver needs no `resolveType`/`isTypeOf`. The Relay plugin's
`relay.clientMutationId: 'omit'` builder default (see "Builder defaults" above) plays no role
here — it only affects `relayMutationField`, which nothing in this schema calls.)*

**Book** (11) — `bookUpdateMetadata`, `bookDelete`, `bookReplace`, `bookAnalyzeReplace`,
`bookRegenChapters`, `bookValidate`, `bookLinkDocument`, `bookUnlinkDocument`,
`bookClearEditions`, `bookClearEditLineage`, `bookResolvePendingFix`

**Progress** (2) — `progressSet`, `progressDelete`

**User** (5) — `userRegister`, `userDelete`, `userResetPassword`, `userChangePassword`,
`userRegenerateSyncPassword`

**Device** (5) — `deviceCreate`, `deviceUpdate`, `deviceDelete`, `deviceEnableUser`,
`deviceDisableUser`

**Library** (1) — `libraryScan`

Twenty-three in total — reconciled against `schema.generated.graphql`'s `Mutation` type
2026-08-02: the name list above is exactly the shipped set, unchanged from the original plan.
(`bookReplace`/`bookAnalyzeReplace` became staged-upload mutations rather than byte-carrying
ones — see "Seams that stay REST" below — but the mutation *names* and *count* were never in
question; only their argument shape changed.) *(Superseded 2026-08-03 by the lineage-gap
plan's Task 1: `bookClearEditLineage` was added — a distinct, REST-only-until-now operation
that clears `type = 'edit'` lineage rows, disjoint from `bookUnlinkDocument`'s `type = 'merge'`
rows — bringing the count to **twenty-four**, reconciled against `schema.generated.graphql`
after the lineage-gap plan's Task 2 removed the unreachable `BookAlreadyExistsError` type; see
"Error model" below.)* Series have no mutations: they are derived from
books, and the existing `/api/series/*` routes are all reads.

Every user-associated mutation takes a `User` global ID, never a username —
`deviceEnableUser(deviceId:, userId:)`, `userDelete(userId:)`, `userResetPassword(userId:)`,
`progressDelete(userId:, document:)`. (Corrected field name: the input field is `userId`
throughout, never the bare `id:` this paragraph originally showed for `userDelete`/
`userResetPassword`.) *(Added by the book-relay-id plan, 2026-08-02: book mutations are the
outlier — they take the `Book` global ID itself, not a separate `userId` arg. The owner rides
inside the ID's compound key, decoded at the resolver boundary exactly as `Query.node` already
does. Originally every book mutation took `bookId: String!` alongside an inconsistently
required `userId: ID`, matching the pattern this paragraph describes; the book-relay-id plan
collapsed both into one `id: ID!` per mutation across all ten — `bookUpdateMetadata(id:)`,
`bookDelete(id:)`, and the rest, see "Mutations and their result unions" below. See
`2026-08-02-book-relay-id-design.md`.)*

**Mutations return the entity they changed**, so the client's normalized cache (Apollo)
updates without a manual refetch: `bookUpdateMetadata` returns the `Book`, `bookValidate`
returns the `Book` (and the `Validation`, since the pre-client-polish plan's Task 1 added
`BookValidatePayload.book` — see "Phase 2 (Apollo Client) inputs" below). *(Corrected: "Deletes return `deletedId: ID!` alongside the parent `Library`"
overstated a single shape as universal. As shipped, deletes split on whether the deleted
entity implements `Node`: `bookDelete` and `userDelete` return both `deletedId: ID!` (a
Relay global ID, computable post-delete since the compound key is known) **and** a raw-key
field for REST parity (`deletedBookId`/`deletedUserId: String!`) — never omit `deletedId` for
a `Node`-backed delete, per the Task 2 review's adjudication. `progressDelete` and
`deviceDelete` return only the raw-key field (`deletedDocument`/`deletedDeviceId: String!`,
no `deletedId`), because `Progress` and `Device` are not `Node`s — there is no global ID to
mint. `bookDelete` and `progressDelete` also return the parent `Library` for cache
consistency; `userDelete` and `deviceDelete` do not, since neither has a `Library` parent to
report. See "Delete payload / cache-eviction shapes" in the phase-4 outcome below for the
Apollo-facing version of this table.)* *(Superseded for `Book` by the book-relay-id plan,
2026-08-02: `bookDelete`'s `deletedBookId: String!` is removed — `deletedId: ID!` alone is now
the eviction key for book deletes. The "never omit `deletedId` for a Node-backed delete, carry
both" rule stated just above still holds for `userDelete` (`deletedId` + `deletedUserId`,
unchanged); it no longer holds universally across every `Node`-backed delete, only for
`userDelete` now. The raw field served hypothetical REST-parity consumers; the only consumer
of this schema is the phase-2 client (Apollo, per the pre-client-polish plan, 2026-08-02 —
originally planned as Houdini), which evicts by `deletedId` via `cache.evict({ id:
cache.identify({ __typename: 'Book', id: deletedId }) })`. See
`2026-08-02-book-relay-id-design.md`'s "Output changes".)*

### Mutations and their result unions

Source of truth: `schema.generated.graphql`. Every mutation returns a `<Name>Result` union —
including the seven (`userDelete`, `userRegenerateSyncPassword`, `userResetPassword`,
`bookValidate`, `bookDelete`, `bookClearEditions`, plus any future single-error mutation) that
today declare only one non-payload-free member or none at all: a single-member union
fabricates no error that cannot happen, and keeps a future added member additive rather than a
breaking payload→union shape change (adjudicated at the Task 6 review, binding on every
mutation from Task 6 forward). *(Corrected by the book-relay-id plan, 2026-08-02: this
parenthetical originally read "the four (... plus any future single-error mutation)",
anticipating one more. The book-relay-id plan's honest union-member-drop discipline turned
three more mutations single-member — `bookValidate`, `bookDelete`, `bookClearEditions` — when
their only zod-validated input, `bookId`, was absorbed into the new `id: ID!` arg and their
reachable path to `InvalidInputError` disappeared with it. Seven now, not four; table
re-reconciled below against `schema.generated.graphql` at `b8fb8976`.)* *(Superseded 2026-08-03
by the lineage-gap plan's Task 1: the anticipated "future single-error mutation" arrived —
`bookClearEditLineage` throws none of the seven known store errors (a raw `$executeRaw`
DELETE), so `BookClearEditLineageResult` is single-member too. Eight now, one of them no
longer hypothetical.)*

| Mutation | Result union members |
|---|---|
| `bookAnalyzeReplace` | `BookAnalyzeReplacePayload` \| `InvalidInputError` \| `StagedUploadNotFoundError` |
| `bookClearEditLineage` | `BookClearEditLineagePayload` (single member) |
| `bookClearEditions` | `BookClearEditionsPayload` (single member) |
| `bookDelete` | `BookDeletePayload` (single member) |
| `bookLinkDocument` | `BookLinkDocumentPayload` \| `DocumentAlreadyLinkedError` \| `DocumentIsBookError` \| `InvalidInputError` \| `SelfLinkError` |
| `bookRegenChapters` | `BookHashCollisionError` \| `BookNotValidatedError` \| `BookRegenChaptersPayload` |
| `bookReplace` | `BookHashCollisionError` \| `BookReplacePayload` \| `EpubValidationError` \| `InvalidInputError` \| `StagedUploadNotFoundError` |
| `bookResolvePendingFix` | `BookHashCollisionError` \| `BookNotValidatedError` \| `BookResolvePendingFixPayload` \| `EpubValidationError` |
| `bookUnlinkDocument` | `BookUnlinkDocumentPayload` \| `EditLineageEntryError` \| `InvalidInputError` \| `LineageEntryNotFoundError` |
| `bookUpdateMetadata` | `BookHashCollisionError` \| `BookNotValidatedError` \| `BookUpdateMetadataPayload` \| `EpubValidationError` \| `InvalidInputError` \| `StagedUploadNotFoundError` |
| `bookValidate` | `BookValidatePayload` (single member) |
| `deviceCreate` | `DeviceCreatePayload` \| `DeviceSlugConflictError` \| `InvalidInputError` |
| `deviceDelete` | `DeviceDeletePayload` \| `InvalidInputError` |
| `deviceDisableUser` | `DeviceDisableUserPayload` \| `InvalidInputError` |
| `deviceEnableUser` | `DeviceEnableUserPayload` \| `InvalidInputError` |
| `deviceUpdate` | `DeviceSlugConflictError` \| `DeviceUpdatePayload` \| `InvalidInputError` |
| `libraryScan` | `LibraryScanPayload` \| `ScanAlreadyRunningError` |
| `progressDelete` | `InvalidInputError` \| `ProgressDeletePayload` |
| `progressSet` | `InvalidInputError` \| `ProgressSetPayload` |
| `userChangePassword` | `IncorrectPasswordError` \| `InvalidInputError` \| `UserChangePasswordPayload` |
| `userDelete` | `UserDeletePayload` (single member) |
| `userRegenerateSyncPassword` | `UserRegenerateSyncPasswordPayload` (single member) |
| `userRegister` | `InvalidInputError` \| `UserRegisterPayload` \| `UsernameAlreadyExistsError` |
| `userResetPassword` | `UserResetPasswordPayload` (single member) |

`bookAnalyzeReplace`/`libraryScan`/`bookRegenChapters`/`bookLinkDocument`/etc. resolve to
`null` (not an error) when the referenced entity does not exist for the resolved owner — see
each field's SDL doc comment for the exact wording; that is a distinct channel from the typed
union, matching how `Query.node` behaves for an unknown id.

### Error model

```graphql
interface UserError { message: String! }

type BookHashCollisionError implements UserError     { message: String!, collidingBook: Book! }
type DocumentAlreadyLinkedError implements UserError { message: String!, documentId: String!, book: Book! }
type DocumentIsBookError implements UserError        { message: String!, book: Book! }
type SelfLinkError implements UserError              { message: String! }
type DeviceSlugConflictError implements UserError    { message: String!, slug: String! }
type EpubValidationError implements UserError        { message: String!, messages: [EpubValidationMessage!]! }
type InvalidInputError implements UserError          { message: String!, issues: [InputIssue!]! }
```

*(Corrected: `EpubValidationError.messages` was originally typed `[ValidationMessage!]!` here
— the same type `Validation.messages` uses for stored, persisted findings. As shipped it is
`[EpubValidationMessage!]!`, a distinct, Prisma-free object type. Reason, from the Task 1
review: the store's `EpubValidationError` carries raw epubcheck message objects for an upload
that was *rejected* — there is no `ValidationMessage` row and no `seq` for a validation report
that was never persisted, so reusing the Prisma-backed type would fabricate a field. The two
types otherwise share `code`, `column`, `line`, `message`, `path`, `severity`.)*

The first eight — the seven map 1:1 onto error classes the stores already throw, plus
`ScanAlreadyRunningError` for `libraryScan`'s 409 precondition, listed under "Scan progress"
below — plus `InvalidInputError`, are the small set present at this spec's original writing.
*(Superseded 2026-08-03 by the lineage-gap plan's Task 2: `BookAlreadyExistsError` — one of
the seven that mapped 1:1 onto a store class — was removed from the GraphQL layer, since it
was referenced by zero result unions and no mutation could ever return it; the block above
reflects the current SDL. The first eight are now the first seven — six map 1:1 onto store
classes, plus `InvalidInputError` — and the "eight" figure below this paragraph, and the
"declared but not currently reachable" carried-debt entry near the end of this document, are
historical.)*
*(As shipped, delivery step 4 added seven more typed error members, one per genuinely honest
new case surfaced while building — none fabricated, each an adjudicated precondition or
REST-parity case a mutation's union needed and did not have:*

```graphql
type BookNotValidatedError implements UserError     { message: String!, validation: Validation }
type StagedUploadNotFoundError implements UserError { message: String! }
type UsernameAlreadyExistsError implements UserError { message: String!, username: String! }
type IncorrectPasswordError implements UserError    { message: String! }
type LineageEntryNotFoundError implements UserError { message: String! }
type EditLineageEntryError implements UserError     { message: String! }
type ScanAlreadyRunningError implements UserError   { message: String!, scanStatus: ScanStatus! }
```

*`BookNotValidatedError` guards `bookUpdateMetadata`/`bookRegenChapters`/`bookResolvePendingFix`
against editing a book that has never passed (or has failed) validation — REST's 409 for the
same precondition, given an honest distinct member rather than being folded into
`InvalidInputError`, which is reserved for malformed input, not valid input against an invalid
state. `StagedUploadNotFoundError` is one message covering four indistinguishable causes
(unknown/foreign/expired/kind-mismatched staged id — see "Seams that stay REST" below).
`UsernameAlreadyExistsError`/`IncorrectPasswordError` are `userRegister`/`userChangePassword`'s
REST-parity cases. `LineageEntryNotFoundError`/`EditLineageEntryError` distinguish
`bookUnlinkDocument`'s two REST-mirrored failure modes — no such lineage entry, versus an
organic edit-history entry that structurally cannot be unlinked this way — via a compile-time
exhaustive discriminated-union mapping over the store's string-literal outcomes, not a thrown
exception.)*

**`BookAlreadyExistsError` was declared and `toResult`-discharged but not a member of any
mutation's result union** — no shipped GraphQL mutation performed the import-time write that
throws it (import stays REST-only, via `POST /api/books/upload`); it existed only for
`toResult`'s exhaustive `instanceof` coverage of all seven original store error classes, with
no reachable path to actually return it. *(Superseded 2026-08-03: the lineage-gap plan's Task 2
removed the GraphQL model at `schema/book-already-exists-error/` — referenced by zero result
unions, it only polluted Apollo's generated `possibleTypes` with a branch that could never
execute. The **store** error class of the same name (`services/book-store.ts`, thrown by
`addBook`, reached from the scan pipeline and the REST upload seam) is untouched and still
named in `to-result.ts`'s `KnownStoreError` union — that union describes what the stores
genuinely throw, unchanged by this removal. Re-adding the GraphQL type later, should a mutation
ever need it, is mechanical.)*

`InvalidInputError` does **not** come from `@pothos/plugin-validation`'s declarative arg
mechanism, corrected from this section's original claim — see "Open questions" resolution #2
above: the plugin's declarative `validate` option requires `unsafelyHandleInputErrors`, which
bypasses auth, so every mutation instead runs its own zod schema at the top of the resolver
body and returns `InvalidInputError` as an ordinary union member. `@pothos/plugin-validation`
stays installed for zod/Standard-Schema interop only.

The common interface means the client can always render `message` and only special-case the
errors it acts on.

The graph upgrades these errors on the way out: the store throws
`BookHashCollisionError(collidingId: string)`, and the schema resolves that id into a `Book`,
so the UI can render "this matches *Dune*" with a working link instead of refetching to turn
an id into a title.

Genuinely unexpected failures — database errors, EPUB writes blowing up — are thrown and
land in the errors array, as today's 500s do.

### Seams that stay REST

**Upload.** `POST /api/books/upload` keeps multer and its XHR progress reporting, and keeps
returning `{ uploaded, results }` with applied and proposed metadata fixes. After it
completes the client refetches the affected GraphQL data. Cover writes carry image bytes but
now travel through the staging seam below *(amended 2026-08-01: `POST /api/books/cover-staging`
— a sibling of the replace-staging endpoint on the `coverUpload` multer config, since multer
binds per-route before body fields are readable — stages the image; `bookUpdateMetadata`
takes an optional `stagedCoverId` so metadata and cover land in one single-write mutation; a
staged kind is not fungible: a cover cannot be consumed as a replace EPUB or vice versa. The
REST multipart-cover branch of PATCH metadata stays until the client migrates)*.

**Replace staging.** *(Adjudicated 2026-08-01: the mutations list named `bookReplace` and
`bookAnalyzeReplace`, but both REST routes are pure multer uploads, which this section rules
stay REST — a genuine self-conflict. Ruling: staged-upload hybrid.)* A new REST endpoint,
`POST /api/books/replace-staging` (requireAuth + `epubUpload.single('file')`), writes the
EPUB bytes into `bookStore.getStagingDir()` and returns `{ stagedUploadId }`. The staged file
is keyed to the *authenticated* user (not the `?user=` target): only the user who staged the
bytes can consume them. `bookAnalyzeReplace(id, stagedUploadId)` reads the staged file
without consuming it; `bookReplace(id, stagedUploadId, acceptedFixKeys)` consumes and
deletes it — so the client uploads once and runs both steps against the same bytes, where
REST uploaded the file twice. *(Corrected by the book-relay-id plan, 2026-08-02: both
signatures originally read `bookId` here, matching that mutation's argument at the time. The
book-relay-id plan collapsed `bookId`/`userId` into a single `id: ID!` per book mutation; see
`2026-08-02-book-relay-id-design.md`.)* Abandoned files are swept lazily by TTL (30 minutes, checked
on each staging call); an unknown, expired, or foreign `stagedUploadId` surfaces as an honest
typed error member (`StagedUploadNotFoundError` — indistinguishable across the three cases),
never a fabricated validation error. The legacy `/api/books/:id/replace/analyze` and
`/api/books/:id/replace` routes remain untouched until the client migrates.

**CLOSED (2026-08-02, pre-client-polish plan, Task 4).** The known limitation recorded here
2026-08-01 — the config-file admin has no `userId`, so admin sessions could not stage files
and therefore could not analyze/replace through GraphQL at all, retaining the capability only
through the legacy REST routes — is resolved by `stagingIdentityOf(viewer)`
(`services/replace-staging.ts`): `viewer.userId ?? (viewer.isAdmin ? ADMIN_STAGING_ID : null)`.
An admin session now stages/resolves/consumes under the sentinel `ADMIN_STAGING_ID`
(`'__admin-staging__'`, unrepresentable by any real userId — see that constant's doc comment
for the collision argument, the same one `NO_MATCH_USER_ID` uses), a bucket distinct from
every real user's, so admin staging is neither a bypass onto another user's staged files nor
mixed into any user's own bucket. Both REST staging endpoints (`/api/books/replace-staging`,
`/api/books/cover-staging`) and the three GraphQL staged call sites
(`bookAnalyzeReplace`/`bookReplace`/`bookUpdateMetadata`'s `stagedCoverId` leg) use the same
helper. Book-TARGETING (the decoded-owner path, `authScopes`, owner resolution) is unchanged —
only the staging-file keying gained the admin identity. Three-way isolation re-proven
(bob cannot consume alice's staged file; alice cannot consume admin-staged; admin cannot
consume bob's), plus the end-to-end this closes: an admin can now stage a cover and apply it
to a named user's book via `bookUpdateMetadata`, with that user's cover bytes actually
changing — see Task 4's report for the full seen-to-fail evidence. The deletion this
limitation used to block (spec 3 cleanup of the legacy REST replace routes) is no longer
gated on an admin-replace decision.

## Scan progress

`libraryScan` starts the job; progress streams over a subscription.

### Store change

`scan(owner, importer, onProgress?)` — one optional parameter, so the REST route, the OPDS
path and the existing test suite are unaffected. The callback fires at points the loop
already branches on:

```ts
type ScanProgress =
  | { phase: 'importing'; total: number; processed: number; filename: string;
      outcome: 'imported' | 'renamed' | 'already-imported' | 'skipped'; bookId?: string }
  | { phase: 'pruning'; total: number; processed: number; bookId: string };
```

`scan()` has two countable phases: an import loop over `diskFilenames`, whose total is known
up front, and a prune pass over DB rows. `bookId` rides along on imports because the loop has
already computed it, letting the subscription resolve imported entries to real `Book`s.
`scan()`'s return value keeps its current `{ imported: string[], removed: string[] }` shape
(`imported` holds filenames, `removed` holds `<id>.epub`), so nothing downstream changes.

*(Clarified after implementation: the `pruning` progress event fires for **every DB row
visited** during the prune pass, not only the rows actually removed — a judgment call made and
upheld at review, consistent with `phase.total` meaning "rows to check," matching the
`importing` phase's own semantics, and the absence of an `outcome` discriminator on the
`pruning` variant. A client rendering "N of M checked" gets an accurate counter; a client
expecting one event per removal would undercount its own progress bar.)*

### Coalescing is required

The import loop `continue`s immediately on files already at their canonical path, so a large
library rips through thousands of iterations in milliseconds. `ScanJobStore` publishes at
most once per 250ms and always flushes terminal transitions. Without this the subscription
is a denial-of-service on the client.

### ScanJobStore

Gains `total`, `processed`, `phase` and `currentFile` on `ScanJob`, a `progress()` method,
and publishes on a per-user topic (`scan:${userId}`) from all four transition points
(`start`, `progress`, `complete`, `fail`). Single process, so no Redis.

*(Corrected after implementation: this originally said `ScanJobStore` itself "gains ... a yoga
`createPubSub()`." As shipped, `ScanJobStore` does not construct or import yoga's pubsub
directly — that would put a `services/` → `graphql/` import in the one class the
"services stay classes" exception covers, reopening exactly the layering violation the spec's
own layer-boundaries rule forbids. Instead `services/scan-publisher.ts` declares a structural
`ScanPublisher` contract (plus a genuine no-op default so every non-GraphQL caller of `scan()`
is unaffected) that `ScanJobStore` is constructor-injected with; `graphql/pubsub.ts`'s
`ScanPubSub`, built on yoga's `createPubSub()`, satisfies that contract structurally with no
adapter code. `grep -rn "from '\.\./graphql" services/` is zero occurrences, the discipline
this split exists to keep.)*

`ScanJobStore` is existing code, so it keeps its class shape — but its new logic goes into
two pure functions it delegates to, rather than into the class:

```ts
reduceScanJob(job: ScanJob, event: ScanEvent): ScanJob        // returns a new job, no mutation
shouldPublish(lastPublishedAt: number, now: number, event: ScanEvent): boolean
```

This replaces the current in-place mutation (`job.status = 'completed'`) and makes both the
state machine and the coalescing rule testable against a table of inputs, instead of against
a class holding a `Map` and a wall clock. The class becomes a thin holder that applies the
reducer and publishes when the predicate says to.

```graphql
type Subscription { scanProgress(libraryId: ID!): ScanStatus! }

type ScanStatus {
  jobId: ID!
  state: ScanState!          # RUNNING | COMPLETED | FAILED
  phase: ScanPhase!          # IMPORTING | PRUNING
  total: Int!  processed: Int!
  currentFile: String
  startedAt: DateTime!
  result: ScanResult
  error: String
}

type ScanResult {
  imported: [Book!]!
  importedFilenames: [String!]!
  removed: [String!]!
}
```

*(This sketch's `ScanStatus.jobId` is stale: the pre-client-polish plan, Task 1, 2026-08-02,
renamed it to `id: ID!` — the one SDL-breaking rename in that task — so the `scanProgress`
subscription's events normalize into an already-rendered `Library.scanStatus` with zero
client-side `keyFields` config. See "Phase 2 (Apollo Client) inputs" below.)*

`library.scanStatus` stays as a query returning the same type. It is the reconnect path — a
client joining mid-scan needs current state before the next event — and the fallback if the
client's SSE integration proves awkward in spec 2. *(Resolved 2026-08-02 by the
pre-client-polish plan's Apollo-fit review: Apollo has no first-class SSE link, but a
hand-rolled ~25-line `SSELink` over `graphql-sse` — the same transport this section
specifies — works against this server unmodified. See "Phase 2 (Apollo Client) inputs"
below.)*

### Auth and transport

The subscription field carries the same `ownerOf` scope: `libraryId` decodes to a user id,
checked before subscribing.

*(Corrected after implementation: this section originally continued, "The pubsub topic is
per-user, so the stream cannot leak across libraries even if the scope check were bypassed."
That sentence is **false as built** and is corrected in place rather than left standing. The
topic (`scan:${userId}`) is derived from **the requested library's owner**
(`context.loadOwner(args.libraryId.id).userId`) — necessarily so, or admin traversal into
another user's `scanProgress` would break — not from the caller's own `viewer.userId`. So a
bypass of the `ownerOf` check would hand the caller the victim's own topic directly, with
nothing left to stop it: `ownerOf` is the **sole** access control on this field, not a
belt-and-suspenders pair with the topic. The per-user topic is a real backstop against a
different failure it was never given credit for in the original sentence — one user's own
subscription accidentally observing a second, unrelated user's events because two jobs shared
one topic — just not the "scope check bypassed" scenario this sentence claimed.)*

*(Also load-bearing, not stated here originally: `builder.subscriptionType({ authScopes:
{ authenticated: true } })` alone does not enforce anything at subscribe time.
`@pothos/plugin-scope-auth` only re-checks auth per emitted event by default
(`wrapResolve`); the subscribe-time hook (`wrapSubscribe`) is left as the raw, unwrapped
`subscribe` function unless the builder also sets `scopeAuth.authorizeOnSubscribe: true`.
Without it, a denied cross-tenant caller still gets a live, standing `AsyncIterable` bound to
the victim's topic — no payload leaks, since events still never resolve for them, but it is a
real timing oracle and never an immediate refusal. `authorizeOnSubscribe: true` is set in
`builder.ts`, gated on `typeConfig.kind === 'Subscription'` with zero effect on Query/Mutation,
and any future subscription field in this schema inherits it automatically.)*

Transport is SSE on the existing `/graphql` endpoint via `Accept: text/event-stream`. No
WebSocket server, no HTTP upgrade handling, no change to how Express starts, and it passes
through Cloudflare. `requestTimeout` does not interfere: it returns early when
`res.headersSent`, and SSE writes headers immediately. graphql-yoga's SSE support needed no
extra plugin or config beyond the existing mount — `Accept: text/event-stream` alone triggers
it, and it frames both live async-iterable results and a single (error) `ExecutionResult`
identically, which is exactly what a subscribe-time auth denial produces.

### REST-scan visibility (scoped down from the original promise)

`libraryScan` and `POST /api/books/scan` share one `ScanJobStore` instance, so a scan started
through either transport is visible to a `scanProgress` subscriber or a `scanStatus` reader
regardless of which one started it — but not at the same granularity. Publish calls live at
`ScanJobStore`'s own `start`/`progress`/`complete`/`fail` transition points, constructor-injected
via the `ScanPublisher` contract above, which is what makes this cross-transport visibility
possible at all without touching `routes/`. But `routes/ui.ts`'s scan route calls
`bookStore.scan(owner)` with no `onProgress` callback — `routes/` is off-limits to this plan —
so a REST-initiated scan only ever produces the `start`/`complete`/`fail` transitions:
**start/terminal granularity**, not the per-file `total`/`processed`/`phase`/`currentFile`
updates a `libraryScan`-initiated scan produces. A client watching a REST-initiated scan sees
it begin and end, with no progress bar in between, unless a future change threads `onProgress`
through the REST route too.

## Testing

### Fidelity

`ui.test.ts` does not mock the database — it builds a real `PrismaClient` over
better-sqlite3 in a temp directory, runs `runMigrations`, and wires real stores against a
temp books directory. `test-util.ts` reuses that exact pattern, exporting a harness that
returns `{ execute, prisma, stores, owner, cleanup }`. Schema-level tests are therefore the
same integration depth as today's route tests, minus the HTTP hop.

### Layers

**Pure functions** (cheapest, and there should be a lot of them): the shared JSON-column
parsers, validity derivation, `reduceScanJob`, `shouldPublish`, and the `toResult` error
mapping. Table-driven, no database, no timers, no schema.

**Schema level** (the bulk): field resolution, the `entries` connection and its cursor,
typed error unions per mutation, validation failures, and the subscription event sequence
end to end over a known file set.

**HTTP level** (small, targeted): only what exists solely over the wire — bearer parsing into
a viewer, `authenticated` refusal, `admin` refusal on `Query.user`, a non-admin refused
traversing `user(id:).library`, error masking under production config, and SSE subscription
auth.

The REST suite stays untouched and green throughout spec 1. It is the regression net,
because REST still serves the live client until spec 3.

### Schema review gate

`schema.generated.graphql` is committed, and `npm run lint` fails if it drifts from the built
schema. No resolver change can alter the public schema without showing up as a reviewable
diff.

## Delivery

Five steps, each independently green.

1. **Spike (timeboxed).** Two unknowns: Pothos v4's Prisma generator against Prisma 7's
   legacy `prisma-client-js` provider, and `prismaNode` over `Book`'s compound
   `@@id([userId, id])` via the generated `userId_id` name. Fallback if either fails:
   hand-written `builder.node` with explicit id encode/decode and `findUnique`. Contained,
   and it does not change the schema.
2. **Foundation.** Dependencies, builder, context, scopes, yoga mount, `Query.viewer`, the
   print script and its lint check. Verified: an authenticated viewer query answers over
   HTTP; an unauthenticated one is refused.
3. **Read model.** User, Library, Book, Series, Validation, Progress, Device, and the
   `entries` connection. The largest step. Asserted against the same data the REST suite
   asserts on.
4. **Mutations.** All 23, with typed errors and the validation plugin. **DONE**
   (`e586042a..48871ff2`, this plan's Tasks 1–7; see "Mutations" and "Error model" above,
   reconciled against the SDL).
5. **Scan progress.** The `onProgress` callback, `ScanJobStore` pubsub with coalescing, and
   the subscription field. **DONE** (`e586042a..48871ff2`, Tasks 8–9; see "Scan progress"
   above and "Phase 4 outcome" below for the client handoff).

## Risks

| Risk | Mitigation |
|---|---|
| Pothos Prisma generator vs Prisma 7 | Step 1 spike; the plugin's peer range is open (`@prisma/client: *`) and the schema uses the still-supported legacy generator |
| `prismaNode` over a compound primary key | Step 1 spike; fallback is a hand-written `builder.node` |
| Two read paths (Prisma direct, stores) drifting | Shared pure functions in `derive.ts` for JSON-column parsing, epoch conversion and the CFI-to-chapter derivation |
| Scan progress touches the most side-effect-heavy method in the codebase | `onProgress` is optional, so every existing caller and test is unaffected |
| Client SSE support unverified (originally Houdini, now Apollo) | `library.scanStatus` query retained as a guaranteed fallback; resolved 2026-08-02 by the Apollo-fit review — `graphql-sse`'s distinct-connections mode matches this server's wire format, verified against the installed yoga source |

## Definition of done

- Every existing REST test still passes.
- The GraphQL suite covers both layers.
- `schema.generated.graphql` is committed and enforced by lint.
- The server serves both APIs; the client still runs entirely on REST.

---

# Phase 1 outcome — settled facts and open questions

Delivery steps 1–2 shipped on branch `graphql-migration` (`db4035f8..28deb010`, 12 commits, 1123
tests). This section is the handoff: read it before planning the read model.

## Settled by experiment — do not re-litigate

| Question | Answer |
|---|---|
| `prismaNode` over `Book`'s composite `@@id([userId, id])` under Prisma 7 | **Works.** `id: { field: 'userId_id' }` encodes and decodes, round-tripped through `Query.node`. Kept as a regression test at `app/server/graphql/prisma-node.spike.test.ts`. No hand-written `builder.node` fallback needed. |
| Pothos Prisma generator vs Prisma 7 | Works with the legacy `prisma-client-js` provider. **But** `dmmf: getDatamodel()` must be passed explicitly whenever `prisma.client` is a context function — the plugin cannot resolve the datamodel otherwise. |
| Dual CJS/ESM `graphql` breaking `instanceof` under Vitest | Fixed at the cause with a `resolve.alias` pinning the bare `graphql` specifier to `require.resolve('graphql')`. Seven narrower/alternative approaches were tried and recorded; `ssr.noExternal` enumeration is **not** the answer and was removed. |
| Plugin order | `[RelayPlugin, ScopeAuthPlugin, ErrorsPlugin, PrismaPlugin, ValidationPlugin]`. Two documented constraints: errors **before** prisma (else `errors` misbehaves on prisma field-builder methods), relay **before** scope-auth (else `authScopes` receive raw rather than parsed global IDs). |
| Field nullability | Pothos v4 defaults `DefaultFieldNullability` to **true**. Both the type param and the runtime option are set to `false`; do not remove either as redundant. |
| Auth error contract | `UNAUTHENTICATED` + HTTP 401 when there is no viewer, `FORBIDDEN` + HTTP 403 otherwise, via `extensions: { code, http: { status } }`. Yoga honours `extensions.http.status`. The client can reuse `api-fetch`'s existing 401 refresh-and-retry. |
| `mustChangePassword` | Folded into the `authenticated` scope, mirroring REST's `passwordChangeGate`. A second scope, `passwordChangeAllowed`, exists for the change-password mutation. |
| Production hardening | Derived fail-safe: `NODE_ENV !== 'development'`. GraphiQL, introspection and field suggestions are all disabled unless development is explicitly opted into. |

## Open questions the next plan must answer

**1. `Query.node` bypasses the `Library` traversal — RESOLVED: owner-scoped `findUnique` per node type.**

*The hole.* "Why the security surface is small" holds for *traversal*: an `Owner` can only be minted
by `Viewer.library` or the scope-checked `User.library`. But `node(id:)` reaches an entity directly.
Verified in `@pothos/plugin-prisma/esm/schema-builder.js:74,96-105`: `prismaNode` registers a
`loadWithoutCache` whose clause is `where: rawFindUnique ? rawFindUnique(id, context) : { [fieldName]: idParser(id) }`.
With no custom `findUnique`, the `userId` half of the compound key comes from **the caller's own
global ID** — so any authenticated user can fetch any other user's row by ID. The `Query`-level
`authenticated` scope only proves someone is logged in.

*The fix.* `prismaNode` accepts `findUnique?: (id: string, context) => Model['WhereUnique']`
(`@pothos/plugin-prisma/dts/types.d.ts:102`). Supplying it replaces the clause entirely, so ownership
becomes part of the query rather than a check after fetching. Note this is `findUnique`, **not**
`loadOne`/`loadMany` — those are for plain `builder.node`, and while they do receive context (the
published docs omit that parameter; `@pothos/plugin-relay/dts/types.d.ts:146-149` confirms it), they
are not the hook `prismaNode` uses.

*The rule.* Allow when `viewer.isAdmin || viewer.userId === <userId encoded in the global ID>`.
Otherwise return a clause that cannot match, so the field resolves to **null — indistinguishable
from a nonexistent ID**.

*Why null rather than a thrown `FORBIDDEN`.* `Book.id` is a 32-char partial MD5 of the file, which
is exactly why the primary key is composite: two users legitimately hold the same ID for the same
EPUB. Confirming the row exists would therefore leak "another user has this exact file." For the
same reason, do **not** implement the denial by substituting the viewer's own `userId` — where both
users own the file, that silently returns a different, valid row.

*Consequences to honour when implementing.*
- The node type must be **nullable**; otherwise `prismaNode` uses `findUniqueOrThrow` and Prisma
  raises instead of returning null (`schema-builder.js:94`). Check what `defaultFieldNullability: false`
  does to the generated `node` field and set `relay.nodeFieldOptions` accordingly.
- Write **one shared helper**, not the rule copied per type. Book, Series, Validation, PendingFix and
  DeviceEdition all need it identically; five copies is the verbatim-duplication pattern reviews
  flag, and a stale copy is a breach rather than a bug.
- Per-type files (`schema/book/node-loader.ts`) call the helper — keeping the layout convention while
  the rule has a single point of truth.
- The durable test is **generic**, following `root-auth.test.ts`: walk every type implementing `Node`,
  attempt a cross-tenant fetch, assert null. A per-type test does not cover the sixth node type
  someone adds later.
- Decide per type whether it needs `Node` at all. Fewer node types is a smaller surface; a
  normalized client cache (Apollo) can use `node` for entity refetch, but mutations already
  return the mutated entity by design.

**2. `InvalidInputError` — RESOLVED: validate inside resolvers, return it as a union member.**
Surfacing validation-plugin failures through the errors plugin's typed unions requires
`unsafelyHandleInputErrors`, which the plugin's own documentation warns bypasses other plugins'
hooks — including auth. That collides directly with "every field authenticated, no exceptions."

Resolution: keep zod schemas, but run them at the top of each mutation resolver and return
`InvalidInputError` as an ordinary member of the result union. Auth runs first, unchanged, and input
errors reach the client through the same typed-union mechanism as every other expected failure —
one channel, exhaustively checked by codegen, rather than a second untyped one.

Consequence: `@pothos/plugin-validation`'s declarative field-level integration goes largely unused.
It stays installed for its zod interop, but the arg-level `validate` option is deliberately not the
mechanism. Do not "simplify" this back to declarative arg validation without re-reading the
auth-bypass warning above.

**3. `builder.objectField` on a non-root type is untested.**
The layout assumes most `query/` files register onto `Library` via `builder.objectField`. Phase 1
only exercised `builder.queryField`. A one-field spike would de-risk it cheaply.

**4. Per-request memoization has nowhere to live.**
Nearly every `Library` field needs the `userId → username` lookup (the books directory is named by
username). `Context` is the right home for a request-scoped loader; adding it before ~30 resolvers
exist is far cheaper than threading it through afterwards.

**5. `root-auth.test.ts` has an argument-coercion trap.**
It executes root fields with no arguments to assert they reject a null viewer. graphql-js coerces
arguments *before* calling the resolver, so the first root field with a required argument — e.g.
`userChangePassword(input:)` — fails with a coercion error rather than `UNAUTHENTICATED`. It fails
closed and loudly, but the phase-4 author will hit it. Build a minimal arg map from `field.args`, or
relax the assertion.

**6. The change-password mutation needs `skipTypeScopes`.**
If phase 4 declares `builder.mutationType({ authScopes: { authenticated: true } })`, Pothos ANDs
type- and field-level scopes — so the type-level `authenticated` would block the very user
`userChangePassword` exists for. Use `skipTypeScopes` on that field.

**7. Field-suggestion concealment does not cover variable coercion.**
The production concealment plugin rewrites *validation* errors. Variable-value coercion happens
inside `execute`, so messages like `Value "TYPO" does not exist in "SomeEnum" enum. Did you mean …`
bypass it. Unreachable today (no arguments, enums or input types); phase 2's read model introduces
all three.

**8. The CI hardening checks assert only absences.**
`docker-smoke-test` verifies GraphiQL and introspection are *not* served. If `/graphql` stopped being
mounted, both checks would pass vacuously. Add one positive assertion — an unauthenticated
`{ viewer { username } }` returning 401 / `UNAUTHENTICATED` — so the job proves the endpoint is live
and gated rather than merely absent.

## Carried minor debt

- Auth-rejection assertions in `yoga.test.ts` for introspection pin third-party English prose (the
  error carries only the generic `GRAPHQL_VALIDATION_FAILED` code, so there is nothing better to pin).
- `app/server/vite.config.ts` is excluded from `tsc`. Necessary to keep it out of `dist/`; the
  in-file comment's stated reason is inaccurate and should be corrected in passing.
- `print-schema.ts`'s drift message names the fix command but shows no diff.
- `zod` is installed but unused until the validation plugin lands in phase 4.

---

# Phase 3 outcome — the read model

Delivery step 3 shipped on branch `graphql-migration` (`28deb010..e04181fa`, 29 commits, 1285
tests). Read this before planning the mutations phase.

## The rule that matters most: a self-read cannot discriminate owner-derivation

When a user reads their own library, `owner.userId` and `viewer.userId` hold the **same value**.
So a resolver that correctly reads the owner off its parent `Library` and one that wrongly
re-derives it from the viewer produce *identical results*. Breaking the scoping changes nothing
observable, and a single-tenant test passes either way.

Only an **admin traversing into another user's library** separates them: `adminViewer.userId` is
`null`, while `User.library` mints its `Owner` from `parent.id`.

This was discovered the hard way — a fix wave's first-pass tests for `Library.progress` and
`Progress.currentChapter` passed a fully green suite *with the owner-scoping deliberately broken*.

**Required test shape for any field beneath `Library`:** an admin-traversal assertion checking
**contents**, not counts. Where the field is keyed by book id, also seed a second user a book with
an identical content hash — `Book.id` is a partial MD5, so two users legitimately share ids, and
that is a second, independent axis a break can fall along.

**Currently proven for 5 of 12 `Library` sub-fields.** `entries`, `book`, `series`, `seriesByName`,
`seriesNextIndex`, `pendingFixes` and `searchSuggestions` have no admin-traversal assertion.
Structurally they must read the owner off the parent — `builder.objectField(library, …)` hands
them the `Owner` and nothing else is in scope — so this is regression risk, not a live defect. Worth
closing early in phase 4.

## Settled

| Question | Answer |
|---|---|
| Ownership model | Holds. An `Owner` has exactly three minting paths — `Viewer.library` (self), `User.library` (`ownerOf`-gated), `Library`'s `loadOne` (`isOwnerOrAdmin`) — and no fourth. Every tenant-scoped Prisma call under `graphql/` carries `owner.userId`. |
| Node guards | Every `Node` type has a working owner-scoped guard. `node-scope.test.ts` walks the live type map filtered on the `Node` interface, so a new node type joins automatically; `seedNodeFor` **throws** rather than silently skipping. Both `Query.node` and `Query.nodes` are covered. |
| Not nodes, deliberately | `ValidationMessage`, `Progress` (sub-objects of an already-scoped parent — a global ID would be a second door) and `Device` (global record, no tenant to scope against). `Device` has an `id` without implementing `Node`: Apollo keys and normalizes on it (as Houdini would have), but there is no ungated `node()` door. *(Extended by the pre-client-polish plan, 2026-08-02, Task 1: `Validation` and `PendingFix` followed the same precedent — each gained a scalar `id: ID!` (`PendingFix.id` valued as the owning Book's global ID; `Validation.id` the same construction, since `Validation` is 1:1 with its `Book`) without becoming `Node`s, so Apollo normalizes both with zero typePolicy config. `PendingFix`/`Validation` moved out of this row into the previous one implicitly — see "Phase 2 (Apollo Client) inputs" below for the cache-key table.)* |
| The shared admin-or-self rule | One definition (`isOwnerOrAdmin`), four delegating call sites including the `ownerOf` scope-auth callback. `Series` is a documented exception: its opaque id carries no claimed owner, so `isOwnerOrAdmin(viewer, viewer.userId)` would be a tautology. Documented from both sides. |
| Cursor parity with REST | By construction, not by agreement. `Library.entries` forwards the store's own `endCursor` unmodified; `Library.progress` decodes with the same `decodeProgressCursor` REST calls and re-mints via a shared `encodeProgressCursor`. |
| `Progress.timestamp` | `DateTime!`, converted from **seconds** via `epochSecondsToDate` — deliberately a separate function from `epochToDate` (milliseconds), with a test pinning their disagreement so collapsing them requires deleting it. |

## Phase 2 (Apollo Client) inputs — cache identity (read model)

*(Renamed 2026-08-02 by the pre-client-polish plan: the client target is Apollo Client, not
Houdini. This section covers the read-model types delivered by this spec's first steps; the
full client handoff — typePolicies table, connections, transport, mutation cache-update
inventory — lives in "Phase 2 (Apollo Client) inputs" under "Phase 4 outcome" below, and is
the one to read end to end before writing client code.)*

- **Configure non-`id` keys** or the normalized cache will not update after mutations:
  `Progress` keys on the composite `["userId", "document"]` (`Progress.userId` was added by
  the pre-client-polish plan, Task 1, 2026-08-02 — `document` alone collides across users, see
  the Apollo-fit review §S2). `Validation` is embedded under `Book` and inherits its parent
  correctly. *(Corrected by the schema-cleanup pass, 2026-08-01: this bullet originally also
  named `PendingFixSummary` keyed on `bookId`. That type is deleted; the merged `PendingFix`
  has no scalar `bookId` of its own — only `book: Book!` — so the same keying guidance does not
  carry over unchanged. Phase 2 planning owes `PendingFix` a keying decision of its own.)*
  *(Resolved 2026-08-02 by the pre-client-polish plan, Task 1: `PendingFix` and `Validation`
  both gained a scalar `id: ID!` — `PendingFix.id` valued as the owning Book's global ID,
  `Validation.id` the same construction — so Apollo normalizes both with the default `id` key
  and zero typePolicy config. The "decide before fragments freeze" deferral is closed.)*
- **`Book` keys on `id` alone.** *(Corrected by the book-relay-id plan, 2026-08-02: this bullet
  originally read, "`Book.bookId` exposes the raw content hash alongside the Relay global `id`
  — the client routes on raw ids and builds cover/download URLs from them." `Book.bookId` is
  removed; the schema's only `Book` identifier is the Relay global `id`, and no output field
  anywhere exposes a `Book`'s raw content hash — `coverUrl`/`downloadUrl` are server-computed
  strings, not raw ids. Apollo needs no special key config for `Book` — it is a `Node`, so the
  default `id` key applies, unlike `Progress` above. See `2026-08-02-book-relay-id-design.md`.)*
- **`Library.entries` is a union connection** that bypasses the Prisma plugin's query planning, so
  `Series.books`, `Book.validation` and `Book.series` on a page each take the plugin's per-row
  fallback. It works (tested); nothing measures its cost. This is the most likely real
  phase-2 performance complaint.
- **Backward pagination is rejected, not ignored.** `Library.entries` throws
  `BACKWARD_PAGINATION_UNSUPPORTED` for `last`/`before`; the store's keyset cursor is forward-only.
  `apollo/client/utilities`'s `relayStylePagination` supports both directions, so only ever call
  `fetchMore` forward on `Library.entries`/`Library.progress` — `Series.books` and
  `Validation.messages` do support backward paging (`t.relatedConnection`); don't let a shared
  "paginate" hook assume uniformity.
- **RESOLVED 2026-08-02 by the pre-client-polish plan, Task 3:** this bullet originally read "A
  shape decision is owed: `Viewer.users` and `Device.enabledUsers` are non-null fields carrying
  admin scopes, so a non-admin selecting either alongside anything else nulls the *whole*
  operation rather than returning a partial answer. Defensible — REST 403s the request too —
  but it is the mirror image of the argument made for `Viewer.syncPassword`'s nullability.
  Decide deliberately before fragments are written." Both fields are now **nullable**
  (`[User!]`, list nullable, members non-null; SDL-breaking rename): a scope denial nulls the
  field, not the whole operation. See "Phase 2 (Apollo Client) inputs" below for the
  Apollo `errorPolicy` consequence this still carries.

## Phase 4 (mutations) inputs

- Every mutation the spec names returns an entity that exists here with a global ID.
- **`userChangePassword` needs `skipTypeScopes`** — the type-level `authenticated` scope excludes
  users with a pending password change, which would block the very user the mutation exists for.
- **`root-auth.test.ts` probes root fields with placeholder arguments**; `placeholderLiteral` throws
  for argument kinds it does not handle, so a mutation taking a required input object fails the
  suite loudly rather than being skipped. Extend it rather than working around it.
- **`NO_MATCH_USER_ID` is a magic value**, not a type-level impossibility. It cannot collide today
  (user ids come from a 62-character alphanumeric alphabet with no hyphen), but write paths taking
  user ids should not assume that.
- Input validation runs **inside resolvers**, returning `InvalidInputError` as a union member — see
  resolved open question #2. Do not switch to the validation plugin's declarative arg option.

## Carried debt

- `routes/ui.ts` still duplicates the CFI-to-chapter derivation that `derive.ts` now owns; REST was
  off-limits. Both sides are independently tested over the same cases, so a drift surfaces as one
  suite failing — but a single test asserting the two agree on one shared fixture would make the
  parity load-bearing rather than coincidental.
- **Resolved by the schema-cleanup pass, 2026-08-01:** this originally read
  "`PendingFixSummary.book` issues one query per fix with no loader, unlike its
  `currentChapter` sibling. Lists are small today." `PendingFixSummary` is deleted; the merged
  `PendingFix.book` is `t.relation('book')` — a real Prisma relation the plugin selects/batches
  like any other, not a per-row lookup. No debt remains here.
- `Library.entries` clamps `first` inline (default 20); `Library.progress` uses a shared
  `clampProgressTake` (default 50). Different defaults are correct — they match their respective
  REST routes — but the two clamps are expressed two different ways.
- A stale comment at `book/query/search-suggestions.ts:19` still names `LibraryEntryKind` after the
  rename to `LibraryEntryType`.
- `Library.scanStatus` remains deliberately deferred to the subscription phase.

---

# Phase 4 outcome — mutations & scan subscription (client handoff)

Delivery steps 4–5 shipped on branch `graphql-migration` (`e586042a..48871ff2`, 9 tasks — 7
mutation-entity tasks plus scan machinery and the subscription — 1709 tests, up from 1326 at
this plan's start). This section is the handoff to phase 2, the **Apollo Client** migration
*(originally planned as Houdini; superseded 2026-08-02 by the pre-client-polish plan — see
`docs/superpowers/specs/2026-08-02-pre-client-polish-design.md` and the three reviews it ran,
preserved at `docs/superpowers/reviews/`)*: read it before writing the first mutation call or
subscribing to `scanProgress`.

## Settled by delivery — do not re-litigate

| Question | Answer |
|---|---|
| Mutation declaration mechanism | `builder.mutationField` + explicit `<Name>Input`/`<Name>Result`, not `relayMutationField`/the errors plugin. See "Mutations" above. |
| Error-union exhaustiveness discipline | Every mutation returns a `<Name>Result` union, even a single-member one — additive-safe, never a bare payload type. Task 6 review, binding. |
| `Query.node`/root-auth coverage | Every mutation walks `root-auth.test.ts`'s auth-refusal probe automatically; the subscription field required a separate, non-obvious `authorizeOnSubscribe: true` flag to get the same guarantee at subscribe time (see "Auth and transport" above) — Query/Mutation did not need it. |
| `services/` → `graphql/` layering | Held throughout, including under scan-publish pressure: the `ScanPublisher` structural-contract split (see "ScanJobStore" above) is the precedent for any future services-needs-a-graphql-collaborator situation. |
| Admin-vs-owner precedent | `ownerOf` is used only where a REST admin path genuinely exists (a second admin route, or `resolveOwner`'s `?user=`); a mutation with no such REST counterpart (`progressSet`) gets a bespoke self-only scope instead of an over-granting `ownerOf`. Checked per-mutation, not assumed. |

## Phase 2 (Apollo Client) inputs

**Rewritten 2026-08-02 by the pre-client-polish plan — replaces the Houdini-specific version
of this section entirely.** The client target is now **Apollo Client v4**, not Houdini. This
is the checklist; the deep reference is the Apollo-fit review
(`docs/superpowers/reviews/2026-08-02-apollo-fit.md`, run at `8aa685c5` — read it for the "why"
behind every item below), plus its two siblings `2026-08-02-schema-design.md` and
`2026-08-02-server-hygiene.md`. All findings below are current as of `f13d12de` (suite
1802/1802), i.e. after the pre-client-polish plan's own Tasks 1–4 landed on top of what the
review saw at `8aa685c5` — items the review flagged as open are marked resolved below where
this plan closed them.

### A. typePolicies — cache identity

Apollo's default is `keyFields: ["id"]` when `id`/`_id` is present, else the object is stored
inline under its parent (not normalized). Walking the SDL, only these types need explicit
config; everything else (`Book`, `Library`, `Series`, `User` — all `Node`s — plus `Device`,
`PendingFix`, `Validation`, `ScanStatus`, which all now carry a scalar `id` without
implementing `Node`) normalizes with **zero** typePolicy configuration:

| Type | typePolicy | Why |
|---|---|---|
| `Viewer` | `keyFields: []` | Root singleton, no `id` field at all — Houdini normalized this automatically; Apollo needs the explicit empty-array key to get the same `Viewer:{}` singleton entity. Without it, `Viewer.devices`/`Viewer.users`/`Viewer.syncPassword` live inline under `ROOT_QUERY.viewer` and every list mutation (`deviceCreate`/`Delete`, `userRegister`/`Delete`, `userRegenerateSyncPassword`) has to reach into a nested object via a `ROOT_QUERY` modify instead of the addressable singleton. |
| `Config` | `keyFields: []` | Same shape, lower stakes (static, no mutations touch it) — harmless either way but keep it consistent with `Viewer`. |
| `Progress` | `keyFields: ["userId", "document"]` | Prisma PK is `(userId, document)`; `document` alone is a KOReader content hash and **collides across users** — two users who own the same book have the same `document` value, so an admin screen reading `user(A).library.progress` then `user(B).library.progress` would collapse both onto one cache entity. `Progress.userId` was added by this plan's Task 1 specifically to make this key possible (Apollo-fit review §S2). |

*(Nit, final pre-client-polish review wave: "everything else normalizes with zero config" below
is bounded by its own next paragraph, but spelled out explicitly — the **id-less** types
(`SuggestionGroup`, `Suggestion`, `MetadataFix`, `PendingFixState`, `UndoSnapshot`,
`Identifier`, `LinkedDocument`, `ValidationMessage`, `ScanResult`) are not in either bucket
above: they store **inline** under their parent and cannot be evicted or read independently —
"zero config" for them means "no normalization at all," not "normalizes automatically.")*

Everything else that needed a decision is now zero-config, closed by this plan's Task 1:
`PendingFix.id` (valued as the owning Book's global ID — same construction as `Book.id`,
tenant-unique, follows the `Device` scalar-id-without-`Node` precedent) and `Validation.id`
(same construction, `Validation` being 1:1 with its `Book`) both normalize on the default `id`
key. `ScanStatus.jobId` was **renamed** to `id: ID!` (the one SDL-breaking rename in that
task) so the `scanProgress` subscription's events merge into an already-rendered
`Library.scanStatus` with no `keyFields` override at all.

**Cache-key VALUE sharing — `PendingFix.id`/`Validation.id` equal the owning `Book`'s global
ID.** *(Added, final pre-client-polish review wave.)* Not a bug: Apollo's normalized store key
is `` `${__typename}:${JSON.stringify(id)}` ``, so `Book:<gid>`, `PendingFix:<gid>` and
`Validation:<gid>` are three distinct cache entities that happen to carry the same `id` string —
`__typename` namespacing keeps them from colliding. Two practical consequences:

- **Evicting a `PendingFix`/`Validation` needs its OWN `cache.identify` call, not the book's.**
  `cache.evict` takes an already-normalized key — `cache.evict({ id: cache.identify({
  __typename: 'PendingFix', id }) })`. Passing the bare `id` string, or hand-building
  `` `Book:${id}` ``, silently evicts the **`Book`**, not the `PendingFix`. See §E's
  `bookResolvePendingFix` row below for the concrete call site this applies to.
- **`Query.node(id:)` fed a `PendingFix.id`/`Validation.id` resolves a `Book`**, by design (it
  genuinely is the book's gid) — do not use either as a per-type refetch handle via `node(id:)`.

**Field-level pagination policies — every connection field in the SDL, enumerated:**

```ts
Library: {
  fields: {
    entries:  relayStylePagination(['filter']),   // Library.entries — union connection Book | Series
    progress: relayStylePagination(),             // Library.progress
    book:     { keyArgs: ['id'] },                // Library.book(id:) — not a connection, but arg-keyed
  },
},
Series:     { fields: { books:    relayStylePagination() } },  // Series.books
Validation: { fields: { messages: relayStylePagination() } },  // Validation.messages
```

That is all four `*Connection` types the SDL defines (`LibraryEntriesConnection`,
`LibraryProgressConnection`, `SeriesBooksConnection`, `ValidationMessagesConnection` —
confirmed by grepping `schema.generated.graphql` for `type.*Connection {`; no fifth exists).
`Library.entries`/`Library.progress` **throw `BACKWARD_PAGINATION_UNSUPPORTED`** on
`last`/`before` (forward-only keyset cursor) — only call `fetchMore` forward on those two.
`Series.books`/`Validation.messages` support backward paging (`t.relatedConnection`). Don't
let a shared "paginate" hook assume uniformity across all four.

### B. `possibleTypes` + typed documents

Generate both from the **committed SDL file** (`app/server/graphql/schema.generated.graphql`),
not runtime introspection — **production introspection is disabled**
(`NoSchemaIntrospectionCustomRule`, installed whenever `isProduction`, plus a "Did you mean"
suggestion stripper), so an introspection-based generator only ever works against a dev
server. The SDL file is already a first-class build input (lint-enforced to match the built
schema via `npm run graphql:schema:check`), so pointing GraphQL Code Generator at it keeps
codegen runnable in CI with no server running:

```yaml
# app/client/codegen.ts
schema: ../server/graphql/schema.generated.graphql
documents: src/**/*.{ts,tsx}
generates:
  src/gql/:                  { preset: client-preset }        # typed documents + fragment masking
  src/gql/possible-types.ts: { plugins: [fragment-matcher] }   # possibleTypes for InMemoryCache
  src/gql/type-policies.ts:  { plugins: [typescript-apollo-client-helpers] }
```

`possibleTypes` matters here specifically because the schema has ~24 result unions, the
`LibraryEntry` union (`Book | Series`), the `Node` interface and the `UserError` interface —
without it Apollo falls back to heuristic fragment matching and logs "Missing field ... while
writing result." Wire the same schema-drift lint check on the client side (mirroring the
server's `graphql:schema:check`) so a stale generated file fails CI.

### C. Auth transport — `SetContextLink` + `ErrorLink` refresh contract

The existing client transport is a direct fit, unchanged: `app/client/src/lib/api-fetch.ts`'s
`refreshAccessToken()`/`ensureFreshToken()` (single-flight in-tab and cross-tab via
`navigator.locks`), a Bearer token from `lib/token.ts`, refreshed against
`POST /api/auth/refresh` using the existing httpOnly cookie. Reuse it — don't reimplement.

```ts
const authLink = new SetContextLink(({ headers }) => {
  const token = getToken();
  return { headers: token ? { ...headers, authorization: `Bearer ${token}` } : headers };
});

const refreshLink = new ErrorLink(({ error, operation, forward }) => {
  const isAuth =
    (CombinedGraphQLErrors.is(error) && error.errors.some(e => e.extensions?.code === 'UNAUTHENTICATED')) ||
    (ServerError.is(error) && error.statusCode === 401);   // defensive fallback
  if (!isAuth || operation.getContext().retried) return;
  operation.setContext({ retried: true });                 // one-shot, mirrors apiFetch
  // CORRECTED — see the correction note below; the original line here did not compile.
  return observableFrom(refreshAccessToken()).pipe(
    mergeMap(ok => (ok ? forward(operation) : throwError(() => error)))
  );
});

const link = from([refreshLink, authLink, new HttpLink({ uri: '/graphql' })]);
```

**CORRECTED 2026-08-03 by the Apollo-client-migration plan
(`2026-08-03-apollo-client-migration-design.md` §10, C1) — the `refreshLink` body originally
read:**

```ts
return Observable.from(refreshAccessToken()).flatMap(ok => (ok ? forward(operation) : throwError(error)));
```

**That line does not compile against Apollo Client v4.** Probed against the installed
`@apollo/client@4.2.9`: Apollo v4 re-exports **rxjs's** `Observable` verbatim
(`Observable === rxjs.Observable` is `true`), and rxjs has no static `Observable.from`
(`undefined`) and no `.flatMap` operator method (`undefined`) — rxjs 7 uses the standalone
`from()` plus `.pipe(mergeMap(...))`. rxjs 7's `throwError` also takes a **factory**, not a
value. The corrected form above is verified working end to end (one `UNAUTHENTICATED` → one
refresh → one retry → success), and needs `import { from as observableFrom, mergeMap,
throwError } from 'rxjs'`.

**Also corrected: `rxjs` (`^7.3.0`) is a REQUIRED peer dependency of `@apollo/client@4`** — not
optional, and named nowhere in this section or the Apollo-fit review. A client installed from
either document's dependency list alone fails to resolve.

`refreshLink` **before** `authLink`, so the retry re-reads the freshly stored token. No
`credentials` setting needed — same-origin in production, and the Vite proxy handles dev (§J).

**The server half of this contract is `app/server/graphql/content-negotiation.test.ts`**,
added by this plan's Task 3 specifically to pin it: `Accept:
application/graphql-response+json` gets that Content-Type back; an unauthenticated request
gets HTTP 401 with `body.errors[0].extensions.code === 'UNAUTHENTICATED'`; a validation error
or malformed query from an *authenticated* caller gets HTTP 400 with a different
`extensions.code` (`GRAPHQL_VALIDATION_FAILED`/`GRAPHQL_PARSE_FAILED`) — proving an `errorLink`
that treats every non-200 as "refresh the token" would loop forever on a plain typo. Apollo v4's
`parseAndCheckHttpResponse` branches on the **response** Content-Type: `application/
graphql-response+json` parses the body and surfaces `CombinedGraphQLErrors` with `extensions`
intact even on non-2xx; `application/json` throws an opaque `ServerError` with the body
unparsed. This server already answers Apollo's negotiated `Accept` header with the former —
that's what the test locks down.

### C2. Login rate limit — a client contract, not just a server detail

*(Added, final pre-client-polish review wave — the pre-client-polish plan's Task 4 added this
behavior but nothing documented it as something the client must handle; this closes that gap.)*
`POST /api/login` (REST, unrelated to `/graphql` itself, but the client's login form talks to
it directly — see `lib/api-fetch.ts`) now rate-limits: **10 attempts per minute per client IP**,
fixed window. The 11th attempt in a window gets `429` with a `Retry-After` header (seconds until
the window resets), not the `401` a bad-credentials attempt gets. **The client's login form must
distinguish the two**: today it treats any non-200 as "bad credentials" and shows a generic
error — a `429` should render as "too many attempts, try again in `Retry-After`s", not "wrong
password" (which would be actively misleading, and would not go away on retry with the correct
password either — see `routes/ui.ts`'s doc comment: a successful login does NOT reset the
counter, deliberately). Successful logins still count against the same window.

One deployment caveat: the limiter keys on client IP resolved via `X-Forwarded-For` and a
`TRUST_PROXY_HOPS` config value (server-side, `config.ts`/`config.yaml`) — a reverse-proxied or
Cloudflare-Tunnel deployment that leaves `TRUST_PROXY_HOPS` at its conservative default (`0`)
will key every visitor on one shared IP (the proxy's), so 10 attempts from ANY user exhausts the
window for EVERYONE behind that proxy. This is an operator/deployment concern, not something the
client can detect or work around — documented here so a client-side bug report of "everyone got
locked out after a few failed logins" is recognized as a `TRUST_PROXY_HOPS` misconfiguration, not
a client defect.

### D. Subscriptions — `SSELink` over `graphql-sse`

Yoga's SSE result processor emits the GraphQL-over-SSE **distinct-connections mode** wire
format (`:\n\n` opening, `event: next`/`data:` frames, terminal `event: complete`, a `:\n\n`
ping every 12s). Distinct-connections is `graphql-sse`'s **default** (`singleConnection:
false`) and needs no `/graphql/stream` endpoint — confirmed against the installed
`graphql-yoga@5` source, not assumed.

- **`@graphql-sse/apollo-client` is dead** (latest `0.0.19`, published 2022-11, pins
  `@apollo/client: "3x"` and `graphql@^15`) — **do not use it.**
- The supported path is graphql-sse's own documented Apollo recipe: a ~25-line `SSELink
  extends ApolloLink` wrapping `createClient()` from `graphql-sse`, combined with `split()` on
  `OperationTypeNode.SUBSCRIPTION`.
- **Apollo v4 gotcha, must not be missed:** Apollo v4 attaches an `operationType` property to
  the `operation` object. The stock recipe spreads `{ ...operation }` into
  `client.subscribe`, which puts `operationType` in the request body — and yoga **rejects
  unknown body parameters** (`expectedParameters = ['query','variables','operationName',
  'extensions']`), surfacing as a confusing 400. **Destructure explicitly** — `{ variables,
  operationName, extensions }` plus `print(operation.query)` for `query` — never spread the
  whole operation.
- Auth is a non-problem: graphql-sse uses `fetch`, not `EventSource`, so a real
  `Authorization: Bearer` header works and the `headers` callback may be async (call
  `ensureFreshToken()` from it directly).
- Add `/graphql` to the Vite dev proxy (§J) or dev subscriptions 404 against the Vite server.
- Read `Library.scanStatus` right after `subscribe()` resolves and again on every reconnect
  (unchanged from the read-model mitigation above) — `ScanStatus` now keys on `id`, so the
  event merges into the already-rendered `Library.scanStatus` without any typePolicy override.

### E. Mutations needing hand-written `update` functions

Apollo does not have Houdini's `@list`/`@append`/`@prepend`/`@allLists` directives. Enumerated
from `schema.generated.graphql`'s 23 mutations (post this plan's Tasks 1–3 — the counts below
are current, not the Apollo-fit review's `8aa685c5` snapshot, which predates `BookValidatePayload
.book` and the `Progress`/`PendingFix`/`Validation`/`ScanStatus` id work). *(Superseded
2026-08-03 by the lineage-gap plan's Task 1: `bookClearEditLineage` shipped, bringing the total
to 24 — see "Mutations" above. It joins the "free" list just below, same shape as its closest
sibling `bookClearEditions`: it returns `book` and a `clearedCount`, no separate collection for
Apollo to reconcile.)*

**Need a hand-written `update` (10):**

| Mutation | Cache work |
|---|---|
| `bookDelete` | `cache.evict` the `Book`; connection edges (`Library.entries`) are arrays of edge *objects*, not bare references, so Apollo does not auto-filter them — write one shared "filter dangling edges" helper and reuse it here and for `progressDelete` below |
| `bookResolvePendingFix` | select `book { id pendingFix { id } }` so the `Book` side self-heals automatically; separately evict the resolved `PendingFix` via `cache.evict({ id: cache.identify({ __typename: 'PendingFix', id }) })` — **not** the bare `id` or a hand-built `` `Book:${id}` ``, either of which evicts the `Book` instead (§A's cache-key-sharing note) — `Library.pendingFixes` is a plain array of references, which Apollo *does* auto-filter once the referenced entity is evicted, so no manual edge-filter is needed here, only the one `cache.evict` call (lighter than the Apollo-fit review's `8aa685c5` guidance, written before `PendingFix.id` existed) |
| `deviceCreate` | append to `Viewer.devices` (needs the `Viewer` singleton policy, §A) |
| `deviceDelete` | evict `Device` + remove from `Viewer.devices` |
| `progressDelete` | evict `Progress` via the composite key (`cache.identify({ __typename: 'Progress', userId, document: deletedDocument })`) + filter `Library.progress`'s connection edges (same edge-object wrinkle as `bookDelete`) |
| `progressSet` | append to `Library.progress` when the document is new — the payload returns `library` + `progress`, but a returned parent does not re-materialize its own connection |
| `userChangePassword` | not a cache update at all — see §H, silent-logout contract |
| `userDelete` | evict `User` + remove from `Viewer.users` |
| `userRegenerateSyncPassword` | explicit `cache.modify` on the `Viewer` singleton — the field the UI reads is `Viewer.syncPassword`, not anything on `User` |
| `userRegister` | append to `Viewer.users` |

**Free — normalize automatically, no `update` function (14):** `bookClearEditLineage`,
`bookClearEditions`, `bookLinkDocument`, `bookRegenChapters`, `bookReplace`, `bookUnlinkDocument`,
`bookUpdateMetadata`, `deviceDisableUser`/`deviceEnableUser` (free *if* the mutation selects
`device { id enabledUsers { id } }`), `deviceUpdate`, `libraryScan`, `userResetPassword` — all
return the entity they changed, so normalization updates every screen with no extra code.
**`bookValidate` moved into this list** by this plan's Task 1 (`BookValidatePayload` gained
`book: Book!`, and `Validation` gained `id: ID!`): the Apollo-fit review's `8aa685c5` snapshot
called this mutation "blocked" because a bare `Validation` had no parent reference and no key
of its own — both are fixed, select `book { id validation { id ... } }` and it self-heals like
any other book mutation. `bookAnalyzeReplace` returns no entity at all (pure preview payload —
`autoFixes`/`messages`/`proposals`/`valid`) and has nothing to normalize; it isn't "free," it's
simply cache-irrelevant.

Write **one shared connection-edge-filter helper** (Houdini's `@list`/`delete` did this for
free) and reuse it across `Library.entries` and `Library.progress`. Every mutation result is
also nullable (`Resolves to null when the ... does not exist`) except `deviceCreate`,
`progressSet`, `userRegister` — every call site branches `null` / typed error / payload, a
third branch Houdini's compiler doesn't force but Apollo's does not either; keep it in the
shared "unwrap a mutation result" helper.

### F. Global IDs — `encodeURIComponent` caveat + the ID-bridge fields this plan added

Pothos global IDs are standard base64 and may contain `+`, `/`, `=` — **always
`encodeURIComponent` a global ID before embedding it in a URL** (route params, query strings).
This plan's ruling: **book URLs route on the Book global ID**, not the raw content hash — the
schema stays one-dialect, no raw-hash re-exposure. The global ID encodes the owner
(`base64('Book:' + JSON.stringify([userId, bookId]))`), so the same book has a *different*
global ID for its owner than for an admin viewing it — that is expected, not a bug, and both
resolve correctly through `Library.book(id:)` / `node(id:)` under their respective viewer.

This plan's Task 2 also bridged the raw-hash/global-ID seams the schema-design review (B1)
flagged:
- **`Library.book(id: String!)` → `Library.book(id: ID!)`** — now takes a Book global ID
  directly (was the raw content hash). Denial (owner mismatch or malformed id) resolves
  `null`, never a permissions error — book ids are content hashes shared across tenants, so
  this is the schema's "not found," never "forbidden," convention.
- **`LinkedDocument.oldBook: Book` / `.newBook: Book`** — nullable edges beside the raw
  `oldId`/`newId` (which remain, described as "raw content-hash for display; resolve
  `newBook`/`oldBook` to navigate"). Nullable because lineage can reference a deleted book.
- **`Suggestion.book: Book`** — nullable, populated only for `type: BOOK` suggestion groups
  (traced against `BookStore.getSearchSuggestions`; every other suggestion type's `value` is
  not a book id, so `Suggestion.book` is `null` there by construction, not by omission).

### G. URL fields — admin `?user=` + floored `v=` cache token

**New in this plan (Task 2) — the client must not re-derive these URLs, use the server's
verbatim.** `Book.coverUrl`, `Book.downloadUrl`, `Book.thumbnailUrl(width:)` now build the
whole URL server-side:
- Admin viewers get `?user=<owner username>` appended — closes a real REST bug (`resolveOwner`
  400s an admin session with no `?user=` param), verified with an integration test that runs
  GraphQL and REST in one HTTP server and fetches a GraphQL-minted `coverUrl` back through REST.
- Every viewer gets `v=<mtime epoch>` appended (floored — `Math.floor`, matching the REST
  client's own immutable-caching token) for cache-busting; `coverUrl`/`downloadUrl` have no
  base query string while `thumbnailUrl` already has `width`, so ordering is `user` then `v`,
  joined with `&`/`?` correctly by the server — a client appending its own `v` on top would
  have to branch on that, so don't: read the URL fields as opaque.
- Self-reads (non-admin) get **no** `user` param — a client discriminator test should assert
  its absence, not just the presence of `v`, since an admin param leaking into a self URL is
  the failure mode that matters.

### H. Silent logout — `userChangePassword` — CORRECTED

`userChangePassword` revoking the caller's own refresh tokens still means: **on success, log
the user out and navigate to `/login` — do not attempt to silently continue the session.**
That client contract is unchanged. *(Corrected 2026-08-02 by the pre-client-polish plan's
server-hygiene review §1.2: this section previously stated "`createContext` only ever sees the
fetch `Request`, never a `Response` to set cookies on, so there is no cookie-reissue path" —
that premise is **wrong**. The yoga mount goes through `@whatwg-node/server`'s
`requestListener` path (Express middleware), whose own typings state the server context is
`{ req: IncomingMessage, res: ServerResponse }` — Express's `res` **is** reachable from the
context factory, and `res.cookie()` before yoga serializes its response should survive (Node
merges `setHeader` calls into a later `writeHead`). **The limitation is a deliberate design
choice — keeping the context Response-free so resolvers cannot write transport-level state —
not a hard constraint of the transport.** Cookie reissue over GraphQL is therefore possible
future work, not something to design the client around as permanent. Until/unless that lands,
the client contract above holds exactly as stated.)*

### I. Nullability — `Viewer.users` / `Device.enabledUsers` — Apollo `errorPolicy` note

**New in this plan (Task 3):** both fields are now **nullable** (`[User!]` — list nullable,
members non-null; this was an SDL-breaking rename from non-null). A scope denial (non-admin
selecting either) now nulls **just that field**, not the whole operation. This matters more
under Apollo than it would have under Houdini: Apollo's default `errorPolicy: "none"`
**discards `data` entirely** whenever `errors` is present, so under the old non-null shape one
accidentally-included admin field in a shared fragment would have blanked an otherwise-good
screen and written nothing to the cache. With the nullable shape, that failure mode is gone by
construction for these two fields — but keep the general rule in mind for any other
admin-scoped field a future schema change adds: prefer nullable-on-denial over
whole-operation nulling, and where non-null admin fields are unavoidable, set `errorPolicy:
"all"` client-side and never colocate them with non-admin data.

### J. Transport hardening the client must account for

All added or pinned by this plan's Task 3, SDL-invisible except where noted:

- **Depth limit: 12.** *(Recalibrated, final pre-client-polish review wave, finding F-1 —
  supersedes this bullet's original "9, +3 margin for fragment-composed queries" claim, which
  was wrong in effect: three real screen shapes sat exactly ON that limit with zero margin, and
  a fourth — the grid rendering `LibraryEntry`'s `Series` arm with a book card rich enough to
  show a pending-fix banner — measured 11 and was REJECTED. "+3 margin" never existed once the
  union's other arm was accounted for.)* Measured with the shipped `measureOperationDepth`
  against every real screen shape (see `depth-limit.ts`'s own doc comment for the full,
  up-to-date table and `depth-limit-integration.test.ts` for the HTTP-level fixtures):

  | shape | depth |
  |---|---|
  | flat grid, thin card | 6 |
  | flat grid, card w/ `pendingFix.state.autoFixes` | 8 |
  | grid + `Series` arm, thin card | 9 |
  | **grid + `Series` arm, full card (incl. `pendingFix.state.autoFixes`)** | **11** |
  | series detail, thin card or w/ `pendingFix.state.autoFixes` | 9 |
  | series detail + full `validation.messages` per book | 10 |
  | book detail (`pendingFix.state.autoFixes` + `validation.messages` together) | 7 |
  | admin `user(id:) { library { … } }` + `Series` arm, full card | 11 |
  | one hop of `Book.series ↔ Series.books` (legitimate "sibling books") | 7 |
  | **two-hop `Book.series ↔ Series.books` cycle, rooted at `Library.entries`** (the amplification shape the rule exists to stop) | **13** |

  Worst legitimate shape: **11**. `MAX_DEPTH = 12` (legitimate max + a 1-level margin) still
  rejects the amplification shape (13 > 12 — a **1-level gap**, not generous headroom). A query
  exceeding depth 12 is rejected with a validation error, not silently truncated. **This is a
  narrow corridor, not a comfortable one** — if a future screen needs a book card one level
  deeper than the grid+Series+pendingFix shape above (e.g. adding `validation.messages` to a
  grid card, not just a summary), re-measure against this table before assuming it fits; do not
  assume any fixed "margin" carries over. **Keep fragment-composed queries under this
  ceiling** — the depth walk counts a fragment spread's contribution once per named fragment
  (memoized) and fragments are depth-transparent (a shared `BookCard` fragment reused across
  both `LibraryEntry` union arms costs nothing extra beyond what its own fields cost), so a
  document with many small fragments is not automatically safe just because no single operation
  looks deep on the page — depth is about NESTING, not fragment count.
- **`/graphql` POSTs must send `Content-Length`.** A POST with no `Content-Length` (e.g. a
  naive chunked-encoding client) now gets `411 Length Required` before the body is read. `HttpLink`
  sets `Content-Length` for a JSON body by default — this only bites a custom fetch
  implementation that streams without it. GET requests (GraphiQL's own page load) are
  unaffected.
- **100kb body cap on `/graphql`**, matching `express.json()`'s own default — the largest
  legitimate operation in this schema is text-only and far under it. A larger body gets `413`
  before the resolver runs.
- **CORS is `cors: false`** (same-origin only) and **`/graphql` was added to the Vite dev
  proxy** alongside `/api` — do these together; pointing the dev client at
  `http://localhost:3000/graphql` directly would otherwise "work" only because CORS used to be
  wide open, which is exactly the configuration this plan closed.

### K. Scalars

No client-side scalar marshalling — `DateTime` arrives as the ISO-8601 string
`DateTimeResolver` serializes; `JSON` arrives already parsed. Codegen config:
`scalars: { DateTime: 'string', JSON: 'unknown' }`, parsed/typed at the display edge. Do not
add `apollo-link-scalars` — it needs the executable schema in the browser bundle to walk every
response, and production introspection is disabled, so that would mean bundling the SDL and
running `makeExecutableSchema` client-side for the convenience of `Date` objects. `JSON` is
narrowed at its one real render site (`MetadataFix.changes` and its `PendingFixState`/
`UndoSnapshot`/`BookAnalyzeReplacePayload` equivalents) rather than typed `any`.

### L. Staged-upload client flow (replace + cover)

Both `bookReplace`'s EPUB and `bookUpdateMetadata`'s optional cover go through a
stage-then-mutate flow, not a byte-carrying mutation:
   - Stage first over plain REST multipart: `POST /api/books/replace-staging` (EPUB,
     `epubUpload`) or `POST /api/books/cover-staging` (image, `coverUpload`'s MIME/size limits)
     — each returns `{ stagedUploadId }`. The two kinds are **not fungible**: a cover id cannot
     be consumed as a replace EPUB or vice versa (`StagedUploadNotFoundError`, same message,
     covers kind-mismatch alongside unknown/foreign/expired — all four causes are
     indistinguishable by design, so the client cannot branch on which one happened).
     Staged ids are **`String` scalars, not `ID`** (`stagedUploadId`, `stagedCoverId`): they
     are opaque service tokens, not Relay global ids — the client must not run them through
     global-id decoding or treat them as cache keys (Task 3b adjudication).
   - `bookAnalyzeReplace(id, stagedUploadId)` reads the staged EPUB without consuming it —
     safe to call repeatedly against the same staged id while the user reviews proposed fixes.
     *(Corrected by the book-relay-id plan, 2026-08-02: both mutation signatures in this bullet
     originally read `bookId` here; the book-relay-id plan collapsed `bookId`/`userId` into a
     single `id: ID!` per book mutation — see `2026-08-02-book-relay-id-design.md`.)*
   - `bookReplace(id, stagedUploadId, acceptedFixKeys)` and `bookUpdateMetadata(...,
     stagedCoverId)` **consume the staged file only on success.** A typed-error result
     (`BookHashCollisionError`, `EpubValidationError`, `BookNotValidatedError`,
     `InvalidInputError`) leaves the staged file in place — **retry without re-uploading**,
     the whole reason the staging seam exists (REST's legacy `/replace/analyze` + `/replace`
     pair uploads the file twice).
   - Staged files are swept lazily by a 30-minute TTL, checked on each staging call (evict-on-
     read at the same cutoff) — a client that lets a user sit on a review screen past 30 minutes
     should expect `StagedUploadNotFoundError` on submit and re-prompt for upload, not treat it
     as a different failure class.
   - **CLOSED (2026-08-02, pre-client-polish plan, Task 4):** the config-file admin gap recorded
     here — no `userId`, so admin-driven replace/analyze had no GraphQL path and survived only
     through the legacy REST routes — is resolved by `stagingIdentityOf(viewer)`, which maps an
     admin session to the sentinel `ADMIN_STAGING_ID` instead of `null`. See "Seams that stay
     REST" above for the full ruling; deleting the legacy REST replace routes in spec 3's cleanup
     no longer requires a separate admin-replace decision.

### M. Delete payload / cache-eviction shapes

Not one universal shape — branch on whether the deleted entity is a `Node`, and (as of the
book-relay-id plan, 2026-08-02) further branch within `Node`-backed deletes on whether the
entity is `Book`:
   - `bookDelete` returns **only** `deletedId: ID!` (a Relay global ID — feed directly to
     `cache.evict({ id: cache.identify({ __typename: 'Book', id: deletedId }) })`).
     *(Superseded by the book-relay-id plan, 2026-08-02: this bullet originally grouped
     `bookDelete` with `userDelete` under "return both `deletedId: ID!` ... and a raw-key
     field ... (`deletedBookId`/`deletedUserId: String!`)." `BookDeletePayload.deletedBookId`
     is removed — the only consumer of this schema is the phase-2 client (Apollo), which
     evicts by `deletedId`, so the REST-parity raw field served no one. `userDelete` is
     untouched, see next bullet. See `2026-08-02-book-relay-id-design.md`'s "Output changes".)*
   - `userDelete` (the other `Node`-backed delete) still returns **both** `deletedId: ID!`
     **and** a raw-key field for REST-parity call sites (`deletedUserId: String!`) — the
     "never omit `deletedId` for a Node-backed delete, carry both" rule from the Task 2 review
     adjudication (stated above under "Mutations") still holds here; it no longer holds
     universally across every `Node`-backed delete, only for `userDelete` now.
   - Non-`Node` deletes return **only** the raw-key field, no `deletedId`, because there is no
     global ID to mint: `progressDelete` → `deletedDocument: String!` (`Progress` keys on the
     composite `["userId", "document"]`, §A — evict by that compound key, not an id),
     `deviceDelete` → `deletedDeviceId: String!` (`Device` has an `id` field for display/keying
     but does not implement `Node`).
   - `bookDelete`/`progressDelete` also return the parent `Library` in the same payload (cache-
     consistency precedent carried from the read model); `userDelete`/`deviceDelete` do not —
     neither has a `Library` parent to report.

### N. `progressSet`/`progressDelete` asymmetry — deliberate, not a bug

`progressSet` is self-only; `progressDelete` is `ownerOf` (admin-capable) — REST has no admin
*write* path for progress (`PUT /api/my/progress/:document` 403s admins outright, and
`routes/users.ts` has no `PUT`/`POST` progress route at all) but does have an admin-capable
`DELETE .../progress/:document` in `routes/users.ts`. `progressSet`'s input keeps a `userId`
field (REST-parity shape) but the resolver rejects any non-self value regardless of admin
status; `progressDelete` accepts an admin acting on another user's `userId`. Client-side: an
admin "clear this user's progress" UI is valid; an admin "set this user's progress" UI is not
representable through this API and should not be built.

### O. Admin-replace — CLOSED, not a limitation to design around

*(Corrected 2026-08-02, pre-client-polish plan, Task 4 — this bullet previously said to "build
the analyze/replace UI assuming it is unavailable when `Viewer.user` is null.")* **That
limitation is closed.** `stagingIdentityOf(viewer)` maps an admin session (`viewer.userId ===
null`) to the sentinel `ADMIN_STAGING_ID` instead of `null`, so an admin can now stage,
analyze, and apply a replace/cover through GraphQL exactly like any user — book-*targeting*
(the decoded-owner path, unchanged) still requires the admin to name the target book's global
ID, same as any book mutation. Build the replace/analyze/cover UI for admins the same as for
self, with no `Viewer.user`-null special case. See "Seams that stay REST" above for the full
ruling and Task 4's report for the three-way isolation proof (bob cannot consume alice's
staged file; alice cannot consume admin-staged; admin cannot consume bob's).

### P. REST-scan visibility scoping

Already documented above under "REST-scan visibility" — pointed to here for completeness: a
scan started via `POST /api/books/scan` (still reachable today, since REST is untouched) is
visible to a `scanProgress` subscriber or `scanStatus` reader, but only at start/terminal
granularity, never with intermediate `total`/`processed`/`phase`/`currentFile` updates. Build
any GraphQL scan-progress UI assuming it is driven by `libraryScan`, not by whatever else might
trigger a scan.

### Q. Query budget — breadth and complexity, read this BEFORE writing fragments

*(Added 2026-08-03 by the query-cost-control plan, Task 5; corrected 2026-08-03 by the plan's
final fix wave (final-review.md, I-1 and I-2) — suite 1928/1928. Full design history and Task
2's plugin-rejection verdict: `docs/superpowers/specs/2026-08-02-query-cost-control-design.md`,
its "Outcome" section. **Re-synced 2026-08-03 by the cost-calibration-suite plan's Task 4**
(`docs/superpowers/specs/2026-08-03-cost-calibration-suite-design.md` §5, commits
`51ead6d0..71d9b7f7`, suite 1933/1933 + `npm run test:cost -w app/server` 30/30) — every number
below now reflects the raised `COMPLEXITY_BUDGET` (33,000, up from 30,000) and is
cross-referenced to a named fixture in `app/server/graphql/cost-calibration.test.ts` where one
exists; the fixture corpus that used to live in `cost-limit.test.ts` moved there in that plan's
Task 2.)*

In addition to Layer 1's per-connection page-size bounds (below) and the depth limit (§J),
two more request-shape budgets are enforced at the GraphQL validation stage, before any
resolver runs — same "no `data` on rejection" contract §J already established, now covering
repetition and fan-out, which depth structurally cannot see.

**The two budgets** (`app/server/graphql/cost-limit.ts`):

| Budget | Value | What it counts |
|---|---|---|
| `BREADTH_BUDGET` | **100** | Node count of the fully-EXPANDED selection tree — fragments and aliases expanded, siblings SUM. The only one of the two that prices repetition. |
| `COMPLEXITY_BUDGET` | **33,000** | Field cost + an args-aware multiplier × sub-selection complexity; connections are priced by their effective `first`/`last`, clamped to that field's own `maxSize` below. |

**Connection bounds** (`app/server/graphql/schema/pagination.ts`'s `CONNECTION_LIMITS` —
maxSize/defaultSize), enumerated so client authors can size pages correctly up front:

| Field | maxSize | defaultSize |
|---|---|---|
| `Library.entries` | 100 | 20 |
| `Library.progress` | 100 | 50 |
| `Series.books` | 100 | 20 |
| `Validation.messages` | 100 | 20 |
| `Query.nodes(ids:)` | 100 (id-batch cap — not a connection, no `defaultSize`) | — |

Every one of these **rejects an oversize page outright — it never silently clamps it.** A
`first`/`last` past a field's `maxSize` is a validation error, not a smaller page returned
quietly. Both `first` and `last` are checked independently everywhere a field accepts both,
and whichever direction is actually supplied is what the complexity walk prices (reading only
`first` here was a real, since-fixed bypass — see the code's own history). **`last:`
precedence:** `Library.entries`/`Library.progress` are forward-only and reject **any** `last`
argument at all, regardless of its size, as `BACKWARD_PAGINATION_UNSUPPORTED` — that error
wins even when the supplied `last` value would itself have fit under `maxSize`. `Series.books`/
`Validation.messages` genuinely support backward pagination and only reject an *oversize*
`last` (`PAGE_SIZE_EXCEEDED`).

**The client trap — read this before writing a nested connection under an already-maxed parent.
An earlier version of this section gave a single "safe" number here (`first: 13` or fewer). A
whole-branch independent review (final-review.md, I-1) proved that number both over-restrictive
in one direction and, for a card just one field richer than the fixture it was measured against,
genuinely unsafe in the other. There is no fixed safe number — what follows is the actual model,
not a replacement magic number.**

**(a) The cost model, in two sentences.** Complexity is computed bottom-up: every selected field
costs 1 plus (its own multiplier × the summed complexity of its children); a *scalar* leaf field
(no sub-selection) always costs exactly 1. Only a handful of fields carry a multiplier greater
than 1 — the five bounded connections (`Library.entries`, `Library.progress`, `Series.books`,
`Validation.messages`, `Query.nodes(ids:)`) and a short list of unbounded-but-priced plain lists
(`cost-limit.ts`'s `FIELD_MULTIPLIER_LIMITS`) — and each one's multiplier is its EFFECTIVE page
size (the literal `first`/`last` supplied, or that field's own `defaultSize` if omitted, clamped
to `maxSize`). Critically, that multiplier applies to the field's ENTIRE sub-selection, and
multipliers COMPOUND across nesting: a request holding `entries(first: 100)` and, inside it, a
`Series.books` connection, prices every field selected inside `books` at (`entries`'s multiplier)
× (`books`'s multiplier) times its base cost — so the cost of adding one more field to a shared
card scales with the PRODUCT of every enclosing connection's page size, not with the field alone.

**(b) A worked example — same outer page size, thin selection passes, rich selection fails.**
All four rows hold `entries(first: 100)` fixed (the server's documented maximum for that
connection) and vary only the `Series` arm's nested selection and its own `first`. The rows that
use the "app's shared `BookCard` fragment" mean exactly this fragment — printed here verbatim
(`app/server/graphql/cost-calibration.test.ts`'s `BOOK_CARD_FRAGMENT`) so a reader reconstructing
it from memory doesn't land 5,700 short, the way an earlier version of this section did (18,503
vs. the true 24,203):

```graphql
fragment BookCard on Book {
  series { id name }
  progress { percentage }
  validation { id valid }
  pendingFix { state { autoFixes { field kind from to } } }
}
```

Every number below was reproduced directly against this repo's HEAD using the exact helper named
in (d), so it is independently checkable, not transcribed from a report. The last column
cross-references the named, committed fixture each row is generated from, where one exists —
run `npm run test:cost -w app/server` to see it measured live:

| Selection on the `Series` arm's nested node | `Series.books` argument | Measured complexity | Verdict (current budget, 33,000) | Named fixture (`cost-calibration.test.ts`) |
|---|---|---|---|---|
| thin (`id title author`, 3 scalar fields, both arms — **and no `pageInfo` on either connection**; adding `pageInfo { hasNextPage }` costs 200 more → 10,803, and `{ hasNextPage endCursor }` costs 300 → 10,903) | none (server default 20) | 10,603 | ADMITTED, comfortably — 32.1% of budget | **None** — not a committed corpus fixture; reproduced by hand via `costOf()` for this table only (flagged in task-4-report.md) — this row is exactly why the follow-up to fixture it matters: an earlier draft of this parenthetical stated the wrong delta, and no test would have caught it |
| the app's shared `BookCard` fragment | `first: 13` | 24,203 | ADMITTED — 73.3% of budget (81% was the figure at the pre-raise 30,000 budget; the query itself is unchanged) | `BOUNDARY_FIXTURES`, "THE BOUNDARY" |
| `BookCard` + one more field (`title`) on the nested node only | `first: 13` | 25,503 | ADMITTED at the CURRENT budget (33,000) — 77.3% of budget. **This exact shape was REJECTED before the FIRST recalibration** (the budget then was 25,000; a whole-branch review found a real, unrelated screen sitting at 91% of that budget and unmeasured — final-review.md, I-2 — and raising the budget to give that screen headroom is what moved this shape from reject to accept, with zero change to the query itself) | **None** — not a committed corpus fixture; reproduced by hand via `costOf()` for this table only (flagged in task-4-report.md) |
| the app's shared `BookCard` fragment | none (server default 20) | 36,103 | REJECTED — 109.4% of budget, still over budget after both subsequent raises (25,000→30,000, then 30,000→33,000) | `BOUNDARY_FIXTURES`, "THE TRAP" |

(THE BOUNDARY and THE TRAP also have a dedicated falsifiable adjacency proof, not just a single
pinned value: `cost-calibration.test.ts`'s "THE BOUNDARY adjacency proof" test asserts
`Series.books(first: 18)` — 32,703 — ADMITS and `first: 19` — 34,403 — REJECTS, the TRUE current
wall at this budget; per `cost-limit.ts`'s own `COMPLEXITY_BUDGET` doc comment this wall has moved
13→16→18 across the three successive raises, which is exactly why no single "safe `first`" number
survives a recalibration. THE TRAP's own value, 36,103, is also the cost-calibration suite's
measured *ceiling* of the usable budget window plus one — the suite's Task 2 block records the
full window as `[32,289, 36,102]`: raising `COMPLEXITY_BUDGET` to 36,103 or above would flip THE
TRAP itself from reject to accept, which is why 36,102 is the highest budget value the suite's own
separation check still allows.)

Read the middle two rows together: the identical query, at the identical outer page size, moved
from REJECTED to ADMITTED the moment this project's own complexity budget was recalibrated for an
unrelated reason (a different screen entirely) — with zero change to the query itself. That is the
whole argument against a fixed number: any number this section could print is only accurate
against one specific `COMPLEXITY_BUDGET` value, and that value is not a constant of the schema —
it moves whenever a real screen's shape changes the calibration (`COMPLEXITY_BUDGET` has moved
17,000 → 25,000 → 30,000 → 33,000 across this project's history so far, most recently the
cost-calibration-suite plan's Task 3 raise, 2026-08-03 — see
`docs/superpowers/specs/2026-08-02-query-cost-control-design.md`'s "Outcome" section for the
17,000→25,000→30,000 history, and `app/server/graphql/cost-limit.ts`'s own `COMPLEXITY_BUDGET`
doc comment for the 30,000→33,000 derivation: worst measured legit anchor 22,602 (the admin
user-list mirror, below) / 0.70 = 32,288.57, rounded up to 33,000). A number copied out of this
section into client code or into an engineer's memory goes stale on the NEXT recalibration,
silently — the model does not.

**(c) The practical rule.** Page size and selection richness are the same budget, spent two
ways — a nested connection sitting under an already-maxed parent connection has LESS room for
extra fields than the same connection standing alone, because every field it selects is being
multiplied by the parent's page size too. Concretely: **the more fields a shared card carries,
the smaller its own `first` needs to be when nested under a maxed-out parent connection** — do
not assume a page size that was safe for a thinner selection stays safe once the card grows, and
do not assume omitting an argument (falling back to the server's own default) is the conservative
choice — the thin-card/no-argument row above admits comfortably while the full-`BookCard`/
no-argument row rejects outright, at every budget this project has shipped. When a shared
fragment grows, re-measure; do not extrapolate from an old accepted shape.

**(d) How to find out for real, instead of guessing — point at the suite, not this document.**
`app/server/graphql/cost-limit.ts` exports `measureOperationCost(operation, fragments, schema)` —
the exact function this section's own numbers were measured with, and the one `costLimitRule`
itself calls before enforcing either budget. `app/server/graphql/cost-test-support.ts`'s
`costOf()` helper is a three-line, copy-paste-ready wrapper around it (`parse` the query, pull the
operation/fragments out of the document, call `measureOperationCost`), shared by `cost-limit.test.ts`
(rule-behaviour unit tests — memoization, cycles, introspection, arg pricing) and by
**`app/server/graphql/cost-calibration.test.ts`** — the dedicated, CI-run suite
(`npm run test:cost -w app/server`, also `.github/workflows/ci.yml`'s `Cost calibration` job) that
now owns the full fixture corpus (moved out of `cost-limit.test.ts` by the cost-calibration-suite
plan's Task 2). Its `LEGIT_FIXTURES` array and "Headroom — every legit/near-future fixture stays
under 70% of both budgets" `describe` block — including the admin-user-list mirror originally
added by final-review.md, I-2 — is a library of real, committed, currently-passing examples to
copy and adapt for a candidate query, and the suite prints the FULL table (every fixture's
breadth/complexity/% of each budget, attacks and boundary cases included) on every run, pass or
fail — that table, not this section, is this project's authoritative, current-as-of-HEAD source
for these numbers. Before shipping a client query that nests a nontrivial selection under an
already-maxed connection, copy the nearest fixture's pattern, paste in the real query, and read
the number back — against `BREADTH_BUDGET`/`COMPLEXITY_BUDGET` exported from `cost-limit.ts` —
rather than trusting any number printed in this document, including the ones two paragraphs up.

**Rejection shapes a client sees:**

| `extensions.code` | HTTP status | Fires when | How Apollo should treat it |
|---|---|---|---|
| `QUERY_COMPLEXITY` | 400 | `COMPLEXITY_BUDGET` (33,000) exceeded | Not retryable unchanged — the query itself must shrink (smaller `first`, fewer nested connections, less fragment/alias reuse). Surface distinctly from a plain validation typo so `errorLink` doesn't loop retrying an oversized query verbatim. |
| `QUERY_BREADTH` | 400 | `BREADTH_BUDGET` (100) exceeded | Same treatment as `QUERY_COMPLEXITY`, but the fix is different: reduce aliasing / repeated fragment spreads, not page size — breadth is about selection-TREE SHAPE, not row counts, and a smaller `first` does nothing to it. |
| `PAGE_SIZE_EXCEEDED` | 400 | a connection's `first`/`last` exceeds that field's `maxSize` | Retryable after clamping the requested page size client-side to the field's `maxSize` (table above). |
| `BACKWARD_PAGINATION_UNSUPPORTED` | 400 | `last`/`before` supplied on `Library.entries` or `Library.progress` | Not a size problem — switch to forward-only pagination (`first`/`after`) for these two fields specifically; retrying with a smaller `last` still fails. |
| `GRAPHQL_VALIDATION_FAILED` | 400 | the pre-existing depth limit (`MAX_DEPTH = 12`, §J) rejects a query, OR any ordinary validation error (unknown field, missing fragment, etc.) | **Known gap, not a client workaround:** `depth-limit.ts` sets no `extensions.code` of its own (only `cost-limit.ts`'s two budgets do), so a depth rejection is indistinguishable, by code alone, from a plain field typo. Both need a human to look at the query — do not attempt an automatic "back off and retry" keyed on this code. |

Note what is deliberately absent: **there is no `QUERY_DEPTH` code in this schema.**
`@pothos/plugin-complexity` — the plugin evaluated and REJECTED for this schema (see the
query-cost-control spec's "Outcome" section) — used that name on its own validation seam;
this codebase's own `depth-limit.ts` predates that convention and was left untouched (its
rejections still surface as the generic `GRAPHQL_VALIDATION_FAILED` above), so don't code an
`errorLink` branch expecting `QUERY_DEPTH` to ever appear.

**Fragment composition is depth-transparent but NOT breadth-transparent:**

- **Depth** (§J) is a max-over-siblings walk with a per-fragment-name memo: a named fragment's
  contribution to depth counts once no matter how many places spread it, and fragments/inline
  fragments add no level of their own. A shared fragment is free on the depth axis.
- **Breadth is a SUM over the expanded selection tree** — every spread of a fragment adds that
  fragment's full node count again, once per spread site. A fragment reused across N places
  costs N× its own breadth, not once. **Aliasing has the identical effect**: each aliased copy
  of a field is a separate node in the expanded tree, so 200 aliased copies of a query cost
  200× that query's breadth. This is deliberate: breadth is the only one of the two budgets
  that prices repetition at all, and repetition (not nesting) is what the alias-fan-out attack
  family exploits — the pagination-cycle attacks this rule also catches measure breadth only
  10–14 and are caught by `COMPLEXITY_BUDGET` instead; breadth's own sole, load-bearing job is
  the alias-repetition family, the smallest of which measures breadth 120.
- **Concretely:** reusing the app's own shared `BookCard` fragment across BOTH sides of a
  `Book.lineage` edge (`oldBook`/`newBook`) measured breadth 44 against the query-cost-control
  plan's own Task 3's interim 41-shape calibration ceiling — the shipped committed fixture,
  after `Book.lineage` was repriced, measures **38** — 38% of the shipped `BREADTH_BUDGET` of
  100 (cross-referenced: `cost-calibration.test.ts`'s `LEGIT_FIXTURES`, "near-future shape 1:
  BookCard-on-lineage"). **Correction (this doc-sync, 2026-08-03):** an earlier version of this
  sentence called 38 "the single largest breadth consumer among every near-future card shape
  measured for this schema" — false as of the current corpus: the near-future richer-grid shape
  (`cost-calibration.test.ts`, "near-future shape 2: the richer grid") measures breadth **56**,
  larger than lineage's 38. Lineage is the largest consumer that reuses `BookCard` specifically
  across two union arms of the *same* connection; it is not the largest breadth figure in the
  near-future class overall. Do not assume fragment reuse is free just because
  `COMPLEXITY_BUDGET` has a per-field multiplier that can absorb the equivalent complexity
  growth — that multiplier does nothing for breadth, which has no per-field knob at all; a
  shared-fragment-on-both-arms shape is a breadth problem no complexity fix can touch.

**The honest limitation — this rule does not discriminate by intent.** Complexity-only attack
shapes (an unbounded-fan-out root like `Query.nodes(ids:)` or `Library.series` feeding into a
maxed-out `Series.books(first: 100)`) and ordinary legitimate paginated traffic **overlap
continuously across roughly complexity 15,000–23,000** (this project's own admin user-list screen,
final-review.md I-2, is a real, shipping example inside that band — 22,602 — not just a
hypothetical one; cross-referenced: `cost-calibration.test.ts`'s `LEGIT_FIXTURES`, "the admin
user-list mirror (final-review.md, I-2)" — 68.5% of the current budget, the worst-measured legit
anchor and the number `COMPLEXITY_BUDGET` itself was derived from) — the identical AST shape (a
bounded connection nested under another, both near their own per-hop maximum) reads as "legit" or
"attack" purely depending on which root field it happens to hang off, not on any structural
difference this walk can see. No complexity threshold in that band cleanly separates the two;
`COMPLEXITY_BUDGET = 33,000` sits above the band, not below it, so some
attack-shaped-but-individually-bounded queries in that range are admitted by design, not by
oversight — **and the 30,000→33,000 raise widened this admitted range further, as an explicit,
acknowledged consequence, not a silent one**: a constructible complexity-only attack
(`library { series { books(first: 100) … } }`) sat ~0.3% ABOVE the pre-raise budget (rejected,
barely) and now sits ~8.8% BELOW the raised one (ADMITTED) — never a committed reject-asserting
fixture, only documented overlap-band prose, and still capped in real row count by Task 1's own
`CONNECTION_LIMITS` regardless of verdict (`cost-limit.ts`'s own `COMPLEXITY_BUDGET` doc comment
has the full arithmetic). **What
makes that acceptable is Task 1's own per-hop row cap** (the `CONNECTION_LIMITS` table above)
— every individual connection hop is capped at 100 real rows no matter how the complexity math
scores the whole document, so the worst a mid-band-admitted query can actually do is bounded by
that per-hop cap compounded across a budget-limited number of hops, not unbounded. Complexity's
real, proven job is stopping unbounded COMPOUNDING across many hops (the million-plus-
complexity multi-hop cycles this plan exists to close), not fine-grained legit/attack
classification within that band — treat both budgets as coarse ceilings against amplification,
never as a substitute for server-side authorization or rate limiting.

## Carried debt

- ~~`BookAlreadyExistsError` is declared, `toResult`-discharged, and codegen-visible in the error
  type map, but is not a member of any mutation's result union today (see "Error model" above) —
  harmless dead weight until/unless a future mutation performs an import-time write.~~
  **RESOLVED 2026-08-03** by the lineage-gap plan's Task 2: the orphan GraphQL type is removed
  (the store class stays, untouched, for the REST upload seam). See "Error model" above.
- The eight remaining `../<entity>` (not `../<entity>/model`) entity-index imports flagged
  across Tasks 1–8's ledger entries were deferred to "the final wave," a wave this doc-sync task
  does not perform (docs-only scope) — still open for whoever picks up the next code task on
  this branch.
- `Library.entries` (forward-only, rejects `last`/`before`) and `Series.books`/
  `Validation.messages` (native backward pagination via `t.relatedConnection`) remain a
  documented asymmetry from the schema-cleanup pass; unaffected by this plan, restated here only
  because phase 2 will hit both connection styles while building the same screens.
- **A ~72KB deeply-nested query 500s at graphql-js's own PARSE stage** (final pre-client-polish
  review wave, T3 N-1 — reproduced, ruled accept-as-documented-debt, not merge-blocking).
  graphql-js's recursive-descent parser overflows the call stack on pathologically deep,
  syntactically-valid input before this schema's own `depthLimitRule`/`MAX_DEPTH` (§J) or any
  auth/context work ever runs — a 66,012-byte nested query returns HTTP 500
  `{"errors":[{"message":"Maximum call stack size exceeded"}]}`, and it is
  **unauthenticated-reachable** (parse precedes context). Not a standing risk: the process stays
  healthy afterward (the next request succeeds normally), there is no memory retention, the cost
  is one parse of a body already bounded by the 100kb cap (§J), and production masks the raw
  message. Fixing it properly needs a pre-parse size/complexity guard, not a depth-rule change
  (depth-rule validation runs AFTER parse succeeds). Related observability gap: a parse-stage
  failure happens before `onValidate`, so `useOperationLogging` (yoga-plugins.ts) emits **no**
  operation-log line for it at all — an attacker probing this specific failure mode leaves no
  trace in the operations log (distinct from a validation-stage rejection, which does log, per
  T3 N-3's fix).
