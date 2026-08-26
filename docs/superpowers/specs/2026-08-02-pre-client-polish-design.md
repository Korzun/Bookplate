# Pre-Client Polish + Hardening — Design

Status: implemented — all five tasks shipped on branch `graphql-migration`
(`b7dff9a8..f13d12de`, 7 commits: Task 1 cache identity + payload parents, Task 2 ID bridge +
URL fields, Task 3 transport hardening, Task 4 admin staging + hygiene, Task 5 docs/Apollo
handoff). Suite 1802/1802 green (up from the 1698 base), lint clean, `graphql:schema:check`
clean throughout. Full ledger: `.superpowers/sdd/2026-08-02-pre-client-polish/progress.md`.
Depends on: `2026-07-30-graphql-server-design.md` (spec 1) and `2026-08-02-book-relay-id-design.md`, both complete at `8aa685c5` (suite 1698/1698).
Sources: the three pre-client reviews (schema-design, Apollo-fit, server-hygiene) run at
`8aa685c5`. This pass lands every Blocker/Should-fix/Fix-before-client finding that gates
the client migration; the client target is **Apollo Client** (supersedes Houdini).
Timing: before any client fragment freezes — every schema change here is breaking-for-free.

## User rulings

- All four scope groups in (cache identity + payloads; ID bridge + URLs; transport
  hardening; config-admin staging + hygiene).
- Book URLs route on the **global ID** — the schema stays one-dialect; no raw-hash
  re-exposure. *(Corrected 2026-08-02, Task 2 review (M-3): this bullet originally continued
  "admin deep links need no `?user=` plumbing because the gid encodes the owner." That is
  false as shipped — the gid encodes the book's *owner*, not the *viewer*, and REST's binary
  endpoints (`cover`/`download`/thumbnail) resolve the caller from session state, not from the
  URL's embedded owner. §3 below is what actually closes the admin-binary-URL gap: the server
  appends `?user=<owner username>` to `coverUrl`/`downloadUrl`/`thumbnailUrl` whenever the
  viewer is an admin. Admin deep links DO carry `?user=` — see §3 and the Apollo handoff's
  "URL fields" section.)*

## 1. Cache identity & mutation payloads

Every type a mutation returns must be normalizable by Apollo's default `__typename` + key:

- `Progress.userId: ID!` — new field exposing the PK's first half (Prisma PK is
  `(userId, document)`; `document` is a content hash that COLLIDES across users in admin
  views). Client keyFields: `["userId", "document"]`.
- `PendingFix.id: ID!` — valued as the owning Book's global ID
  (`encodeGlobalID('Book', JSON.stringify([userId, bookId]))`). Byte-identical to
  `Book.id`, tenant-unique, additive; follows Device's scalar-id-without-Node precedent
  (no Node interface, no `node()` door). Closes spec 1's open PendingFix cache-key
  decision.
- `Validation.id: ID!` — same construction (Validation is 1:1 with its book).
- `ScanStatus.jobId` → **renamed** `id: ID!` (SDL-breaking rename; subscription + scanStatus
  query + tests updated).
- `BookValidatePayload` gains `book: Book!` (fresh prismaField lookup, same pattern as
  BookUpdateMetadataPayload.book). The other five payload-parent gaps from the
  schema-design review are addressed the same way, each TRACED against what the mutation
  actually invalidates — the implementer reads the review's §payload table and the
  resolver, adds the parent(s) the cache genuinely needs, and justifies each addition
  (no blanket additions).

## 2. One ID dialect, bridged seams

- `Library.book(id: String!)` → `id: ID!` (Book globalID arg; same decode/deny machinery
  as the mutations: parseCompoundId, owner check consistent with how `Library.book`
  currently scopes — read the existing resolver and keep its denial shape, it already
  runs under the Library's owner context).
- `LinkedDocument` gains nullable `oldBook: Book` / `newBook: Book` edges beside the raw
  `oldId`/`newId` (nullable — lineage can reference deleted books; a resolved edge uses the
  parent book's owner). The raw ids REMAIN as display/diagnostic data, their descriptions
  updated to say exactly that ("raw content-hash for display; resolve `newBook` to
  navigate").
- `Suggestion`: only where a suggestion value is semantically a book id does it gain a
  resolvable edge — the implementer verifies against the suggestion-group machinery which
  suggestion types carry book ids (the schema-design review flags `Suggestion.value`);
  if none does after tracing, record that and change nothing (honest no-op, SC-Task-5
  precedent).
- Client-handoff caveat (docs, not server): Pothos global IDs are standard base64 and may
  contain `+/=` — URL embedding requires `encodeURIComponent`.

## 3. URL fields: admin + caching

`Book.coverUrl`, `Book.downloadUrl`, `Book.thumbnailUrl(width:)`:

- When `context.viewer.isAdmin`, append `?user=<owner username>` — owner resolved via the
  existing request-scoped `loadOwner(book.userId)` (promise-cached; no N+1). Verified
  broken today: REST's `resolveOwner` 400s admin sessions without the param (ui.ts:153).
- Always append the `v=<mtime epoch>` cache token (matches the REST client's current
  immutable-caching behavior; combine with `&` when both params present, `?` ordering
  user-then-v for determinism).
- Discriminating tests: admin-traversal asserts the URL CONTAINS the owner's username and
  the v token; self-read asserts NO user param (admin param must not leak into self
  URLs); seen-to-fail against the bare-path version.

## 4. Transport hardening

- **CORS**: `cors: false` in the yoga config (same-origin SPA; kills the default
  reflect-any-origin + allow-credentials behavior). Test: an OPTIONS/POST with a foreign
  Origin gets no `Access-Control-Allow-Origin` header.
- **Body size**: limit `/graphql` request bodies to REST's 100kb (whatever mechanism fits
  the current mount — express.json on the graphql path or yoga fetch options — measured
  against the largest legitimate operation, which is text-only).
- **Depth/complexity**: validation rules via yoga's existing rules seam. Calibration
  procedure (the plan pins numbers): measure the deepest legitimate screen query (library
  grid with entries connection + nested series/progress/validation), set depth = that + 2;
  complexity via a simple field-count rule with connection multipliers, set from the same
  measurement + margin. Explicit test: the `Book.series ↔ Series.books` amplification
  cycle at depth N is REJECTED while every real screen query passes.
- **Per-operation logging**: a yoga plugin logging operation name, viewer id (or anon),
  duration, and error count — errors at WARN (today they demote to debug because
  everything is a 200 to `requestLog`). No query text/variables in logs (may contain
  user data).
- **Content negotiation test**: pins that `Accept: application/graphql-response+json`
  returns that content type, and an unauthenticated request yields HTTP 401 with
  `extensions.code: UNAUTHENTICATED` in the body — the contract Apollo's silent-refresh
  errorLink flow depends on. (Behavior believed correct today; the test makes it a
  contract.)
- **Vite dev proxy**: add the `/graphql` entry alongside the existing `/api` proxy in the
  client's vite config (dev-only file; sanctioned client-side exception, config-only).
- **Nullability ruling**: `Viewer.users` and `Device.enabledUsers` become NULLABLE
  (`[User!]` — list nullable, members non-null). A scope denial nulls the field instead
  of the whole operation (Apollo's default errorPolicy discards everything otherwise).
  SDL-breaking; tests updated to assert null-on-denial rather than operation error.

## 5. Config-admin staging + hygiene

- **Staging for admins**: `services/replace-staging.ts` keys entries by caller identity;
  admin sessions (viewer.userId === null) get the sentinel `ADMIN_STAGING_ID`
  (`'__admin-staging__'` — cannot collide with real ids: 62-char alphanumeric alphabet,
  same reasoning as `NO_MATCH_USER_ID`). The REST staging endpoints accept admin sessions
  (drop/adjust the userId-required gate); GraphQL staged mutations resolve staging with
  the same sentinel for admin callers. The staged-mutation book-targeting (decoded owner)
  is UNCHANGED — only the staging-file keying gains the admin identity. Cross-tenant
  property preserved and re-proven: bob still cannot consume alice's staged files, alice
  cannot consume admin-staged files, admin cannot consume bob's (three-way seen-to-fail).
  Spec 1's admin-replace decision gate CLOSES (update that paragraph); the client needs
  no REST fork.
- **Unused plugins**: remove `ErrorsPlugin` and `ValidationPlugin` from the builder's
  plugin list and dependencies. A comment at the list states why they're absent (errors:
  classes-only types can't hold our data-shape errors; validation: declarative option
  bypasses auth — zod runs inside resolvers instead), so nobody "helpfully" re-adds them.
  SDL must be byte-identical after removal (they contribute nothing).
- **REST progress derivation**: `routes/ui.ts` progress GET switches its inline
  currentChapter computation to the shared `deriveCurrentChapter` (the "cannot drift"
  guarantee is currently false). REST behavior change ONLY if the inline version already
  drifted — the implementer diffs the two on the route's own test fixtures first; if
  outputs differ, STOP and report (that's a live bug to surface, not silently fix).
- **Upload limits**: multer `fileSize` limits — `/api/books/upload` and the EPUB staging
  endpoint capped at 200MB (matching the staging memoryStorage bound that already exists);
  cover staging capped at 20MB. 413-shaped rejection tested. If the implementer finds the
  existing cover multer already carries a limit, align rather than duplicate.
- **Login rate limit**: fixed-window limiter on `POST /api/login` (e.g. 10 attempts/min
  per IP, in-memory — single-process server; 429 with Retry-After). Sync-password (OPDS)
  endpoints excluded (device clients retry aggressively; their bcrypt cost is the
  existing mitigation — document this exclusion).

## 6. Testing & SDL discipline

- SDL diff is the review artifact: the enumerated surface is §1's additions + rename,
  §2's arg change + edges, §4's nullability changes — and NOTHING from §5 (plugin
  removal, staging, REST changes are SDL-invisible; gate proves it).
- Seen-to-fail on every property-protecting test; cross-tenant staging three-way proof;
  admin-URL discrimination; depth-rule rejection test.
- REST suite: the only intended REST-visible changes are the staging-endpoint admin
  acceptance, upload limits, login limiter, and (only-if-identical) the derivation swap.
  Every other REST test byte-unchanged.

## 7. Docs

- Spec 1's phase-2 handoff REWRITTEN for Apollo (replaces Houdini specifics):
  typePolicies table (Viewer/Config keyFields:[], Progress composite, ScanStatus id,
  relayStylePagination entries), possibleTypes + codegen-from-committed-SDL (prod
  introspection stays off), SSELink guidance (graphql-sse, distinct-connections mode,
  strip Apollo v4's `operationType` body field), ErrorLink refresh-flow contract (the
  §4 content-negotiation test is its server half), the ~10 mutations needing hand-written
  `update` functions, gid `encodeURIComponent` caveat, silent-logout note (with the
  correction: Express `res` IS reachable via yoga context — cookie reissue is possible
  future work, the limitation is a choice not a constraint).
- The admin-replace decision gate paragraph in spec 1 updated to CLOSED (resolved by §5).
- The three review files copied from the session scratchpad into `docs/superpowers/reviews/`
  (gitignored like the rest of docs/) so they survive the session.

## Out of scope (recorded, not gated)

REST scan `onProgress` enrichment (per-file progress for REST-initiated scans); Series
progress aggregate; schema-wide description-coverage sweep; `MetadataFix.key` exposure
(client can keep deriving until the replace-flow screens are rebuilt); Device-as-Node.

## Delivery

One plan. Task shape roughly: (1) cache identity + payload parents; (2) ID bridge +
URL fields; (3) transport hardening; (4) staging admin + hygiene (REST-touching, its own
reviewer gate); (5) docs + Apollo handoff rewrite. Subagent-driven execution as before.
