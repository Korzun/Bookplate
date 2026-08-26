# Pre-Client Polish + Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land every review finding that gates the Apollo client migration — cache identity, one-ID-dialect bridging, admin-correct URL fields, transport hardening, admin staging, and the Apollo handoff rewrite — while breaking schema changes are still free.

**Architecture:** Additive schema fields + two breaking reshapes (ScanStatus.jobId→id, Library.book arg) on the existing Pothos v4 layer; yoga-level hardening via its plugin/validation seams; one sentinel extension to the staging service; docs rewritten Houdini→Apollo.

**Tech Stack:** Pothos v4, graphql-yoga v5, zod, vitest, Express 4, multer.

Spec: `docs/superpowers/specs/2026-08-02-pre-client-polish-design.md` — its rulings bind. The three source reviews live at `/private/tmp/claude-501/-Users-korzun--supacode-repos-Bookplate-graphql-migration/16a95ff5-d3fb-4499-b590-db06c8eec376/scratchpad/` (`review-schema-design.md`, `review-apollo-fit.md`, `review-server-hygiene.md`) until Task 5 preserves them under `docs/superpowers/reviews/`.

## Global Constraints

- Base: `8aa685c5`, suite 1698/1698, lint clean. Branch `graphql-migration`.
- All established pattern rules bind: `builder.mutationField`/explicit unions, literal `__typename`, no Prisma refs in unions, zero try/catch/throw in resolver bodies, `../<entity>/model` imports, seen-to-fail + cross-tenant (FORBIDDEN + victim unchanged) + admin-traversal-contents disciplines.
- SDL diff (cumulative) = exactly: §1 additions (`Progress.userId`, `PendingFix.id`, `Validation.id`, payload-parent fields) + `ScanStatus.jobId`→`id` rename + §2 (`Library.book` arg type, `LinkedDocument.oldBook/newBook`, any traced Suggestion edge) + §4 nullability changes (`Viewer.users`, `Device.enabledUsers` → nullable) + URL-field description updates. Tasks 4's changes are SDL-INVISIBLE (gate proves it).
- REST-visible changes limited to: staging-endpoint admin acceptance, upload fileSize caps, login rate limiter, and the deriveCurrentChapter swap ONLY if provably identical (stop-on-drift rule). Every other REST test byte-unchanged.
- Tests from `app/server`, lint from repo root. Commits end with:
  `Claude-Session: https://claude.ai/code/session_01DUA8zt35fR6gXqxiT7S5f3`

## File Structure

- Modify: `schema/progress/model.ts`, `schema/pending-fix/model.ts`, `schema/validation/model.ts`, the ScanStatus type file (locate: `grep -rn "jobId" app/server/graphql/schema/`), `schema/book/mutation/validate.ts` (+ the payload files the review's table names)
- Modify: `schema/library/model.ts` (book field), `schema/linked-document/model.ts` (+ its parent-feeding `Book.lineage` resolver in `schema/book/model.ts`), `schema/book/model.ts:60-62` (URL fields)
- Modify: `app/server/graphql/yoga.ts` (cors/body/rules/logging plugins), `app/client/vite.config.ts` (proxy entry — config-only client exception), `schema/viewer/model.ts` + `schema/device/model.ts` (nullability), `schema/builder.ts` (plugin removal)
- Modify: `app/server/services/replace-staging.ts` (+ its REST endpoints in `routes/ui.ts` — sanctioned), `routes/ui.ts` (progress derivation + login limiter), upload multer configs
- Docs: both specs + new `docs/superpowers/reviews/` copies

---

### Task 1: Cache identity + payload parents

**Files:**
- Modify: `app/server/graphql/schema/progress/model.ts`, `schema/pending-fix/model.ts`, `schema/validation/model.ts`, ScanStatus type file, `schema/book/mutation/validate.ts`, plus payload files per the schema review's §3/§payload table
- Test: each model/mutation test file alongside

**Interfaces:**
- Produces: `Progress.userId: ID!`; `PendingFix.id: ID!` and `Validation.id: ID!` both valued `encodeGlobalID('Book', JSON.stringify([userId, bookId]))` (the exact construction `BookDeletePayload.deletedId` uses — copy that call shape); `ScanStatus.id: ID!` (renamed from `jobId`, same value); `BookValidatePayload.book: Book!`.

- [ ] **Step 1**: Read the schema review's payload table (§3 + Should-fix 1) and enumerate the payload-parent additions with a one-line trace each (what the mutation invalidates → which parent the cache needs). `BookValidatePayload.book: Book!` is mandatory (fresh `t.prismaField` lookup — copy `BookUpdateMetadataPayload.book`'s exact shape from `update-metadata.ts`); the other five are add-if-traced, honest-no-op-if-not (record which).
- [ ] **Step 2**: Failing tests first: `Progress.userId` returns the owner's id (assert on an admin-traversal read so it discriminates owner-derivation); `PendingFix.id`/`Validation.id` equal the owning Book's `id` field byte-for-byte (query both in one selection, assert equality); `ScanStatus.id` present + `jobId` GONE (schema-level assertion); `bookValidate` payload carries the book with matching `id`.
- [ ] **Step 3**: Implement. For PendingFix/Validation the parent shapes already carry `userId` + `bookId` (verify — if a parent lacks either, thread it from the resolver that builds the parent, NOT from context.viewer). Rename `jobId` field + update the subscription/scanStatus tests and `library/mutation/scan.ts` references.
- [ ] **Step 4**: Seen-to-fail: substitute `context.viewer!.userId` for the parent's userId in `PendingFix.id`'s resolver — the admin-traversal equality test must go red (the ??-fallback class). Revert.
- [ ] **Step 5**: Regenerate SDL; diff = exactly these additions + the rename. Suite + lint. Commit `feat(graphql): normalizable cache keys and payload parents`.

### Task 2: One ID dialect + URL fields

**Files:**
- Modify: `schema/library/model.ts` (book field arg), `schema/linked-document/model.ts`, `schema/book/model.ts` (lineage resolver parent shape + URL fields :60-62)
- Test: `library/model` tests, `linked-document` tests, `book/model` URL tests

**Interfaces:**
- Consumes: `parseCompoundId`, `NO_MATCH_USER_ID` (node-scope.ts), `context.loadOwner(userId)` (request-scoped, promise-cached).
- Produces: `Library.book(id: ID!)`; `LinkedDocument.oldBook: Book | null` / `newBook: Book | null`; URL fields appending `?user=<username>` (admin viewers) and `v=<mtime-epoch>` (always).

- [ ] **Step 1**: `Library.book` — read the current resolver first; it resolves under the parent Library's owner. New arg `id: t.arg.globalID({ required: true, for: book })`; the DECODED compound id's userId must MATCH the parent Library's owner (mismatch → null, the not-found convention — a gid for bob's copy of the same hash asked through alice's library is a different row). Tests: match/mismatch/malformed arms; wrong-type gid test NOT duplicated (validate.test.ts owns the class).
- [ ] **Step 2**: `Book.lineage`'s resolver extends the entries it builds with the parent book's `userId` (internal shape change: `{ oldId, newId, timestamp, type, userId }`); `LinkedDocument` gains:
```ts
oldBook: t.prismaField({
  type: book, nullable: true,
  resolve: (query, entry, _args, context) =>
    context.prisma.book.findUnique({ ...query, where: { userId_id: { userId: entry.userId, id: entry.oldId } } }),
}),
// newBook identical over entry.newId
```
  Tests: resolved edge for a live book; null for a deleted/unknown old id; descriptions on `oldId`/`newId` updated to the display-only wording the spec gives.
- [ ] **Step 3**: Suggestion trace: find where suggestion values are built (suggestion/suggestion-group machinery); determine whether any suggestion type's `value` is semantically a book id. If yes → add the traced edge (same nullable prismaField shape); if no → record the honest no-op in the report with the trace. Do not guess.
- [ ] **Step 4**: URL fields (book/model.ts:60-62): resolvers become async, `const suffix = await urlSuffix(book, context)` where a small local helper returns `?v=<mtime>` for self viewers and `?user=<encodeURIComponent(username)>&v=<mtime>` for admin viewers (owner username via `context.loadOwner(book.userId)`; loadOwner null → omit user param, keep v — the book row's owner vanished mid-request; not worth failing the URL). `thumbnailUrl` keeps its width param first: `?width=…&user=…&v=…` — match its existing shape, read it first.
- [ ] **Step 5**: Tests: admin-traversal asserts URL contains owner username AND v token (seen-to-fail against bare-path); self-read asserts NO user param; the URL remains REST-fetchable in an integration test (supertest GET of the produced coverUrl under an admin session returns 200 — this is the test that would have caught the original bug).
- [ ] **Step 6**: SDL diff = Library.book arg + LinkedDocument edges (+ traced Suggestion edge) + description updates. Suite + lint. Commit `feat(graphql): bridge raw-id seams and fix admin binary URLs`.

### Task 3: Transport hardening

**Files:**
- Modify: `app/server/graphql/yoga.ts`, `app/client/vite.config.ts:16` (proxy), `schema/viewer/model.ts` + `schema/device/model.ts` (nullability)
- Create: none (plugins live in yoga.ts unless it grows past ~200 lines — then split `yoga-plugins.ts`)
- Test: `yoga`-level integration tests (find the existing transport test file — the SSE tests show the harness), model tests for nullability

**Interfaces:**
- Consumes: yoga's `plugins`/`onValidate` seams (the `useSchemaConcealment` plugin at yoga.ts:46-55 is the in-repo exemplar).

- [ ] **Step 1 — CORS**: add `cors: false` to the createYoga options. Test: POST with `Origin: https://evil.example` → response has NO `Access-Control-Allow-Origin` header (seen-to-fail: remove the option, header reflects).
- [ ] **Step 2 — body limit**: reject bodies > 100kb before execution (mechanism: check `Content-Length` in a small Express middleware mounted on `/graphql` ahead of yoga in server.ts, or yoga plugin `onRequest` — pick whichever the mount order makes cleanest; read `server.ts` first). Test: 101kb body → 413 (or yoga's equivalent), no resolver runs (spy).
- [ ] **Step 3 — depth/complexity**: calibrate FIRST: write the library-grid screen query (entries connection + nested book{series, progress, validation} + pageInfo) as a fixture, measure its depth (count nesting), set MAX_DEPTH = that + 2; add a depth validation rule via `addValidationRule` (hand-rolled ~20-line rule walking selection-set depth — no new dependency). Complexity: skip unless depth alone fails to reject the amplification fixture — the explicit test is `book { series { books(first: 50) { edges { node { series { books … } } } } } }` nested to MAX_DEPTH+1 → REJECTED with a clear error, while the grid fixture and every mutation in the repo's test corpus PASS. Record the measured numbers in the code comment.
- [ ] **Step 4 — per-operation logging**: yoga plugin logging `{operationName, viewerId|anon, durationMs, errorCount}` at info for success / warn when errorCount > 0; NO query text or variables (may contain user data). Wire real logger; test with a spy logger: one success line, one warn line for an errored operation.
- [ ] **Step 5 — content negotiation contract**: supertest — `Accept: application/graphql-response+json` gets that Content-Type back; unauthenticated query → HTTP 401 AND body `errors[0].extensions.code === 'UNAUTHENTICATED'`; authenticated bad-field query → 200-class with errors (validation errors are not auth failures). These pin the Apollo errorLink contract.
- [ ] **Step 6 — Vite proxy**: add `'/graphql'` entry mirroring the existing `/api` proxy target in vite.config.ts:16 (config-only; no client code).
- [ ] **Step 7 — nullability**: `Viewer.users` and `Device.enabledUsers` → `nullable: true` (list nullable, members stay non-null). Update their tests: denial now asserts field-null-with-FORBIDDEN-error rather than whole-operation error; seen-to-fail by reverting nullable.
- [ ] **Step 8**: SDL diff = the two nullability changes only (this task). Suite + lint. Commit `feat(graphql): harden transport — cors, limits, logging, contracts`.

### Task 4: Admin staging + hygiene

**Files:**
- Modify: `app/server/services/replace-staging.ts`, `routes/ui.ts` (staging endpoints admin-gate + login limiter + progress derivation), `schema/book/mutation/{analyze-replace,replace,update-metadata}.ts` (staging caller identity), `schema/builder.ts` (plugin removal), upload multer configs (locate: `grep -n "epubUpload\|coverUpload\|multer" routes/ui.ts`)
- Test: staging service + endpoint + mutation tests; login/upload route tests

**Interfaces:**
- Produces: `ADMIN_STAGING_ID = '__admin-staging__'` exported from `replace-staging.ts`; staging caller-identity helper `stagingIdentityOf(viewer): string | null` (null = unauthenticated only).

- [ ] **Step 1 — sentinel**: export `ADMIN_STAGING_ID` with the collision argument in its doc comment (real ids: 62-char alphanumeric; `__` prefix unrepresentable — same reasoning as `NO_MATCH_USER_ID`, cite it). `stagingIdentityOf(viewer)` returns `viewer.userId ?? (viewer.isAdmin ? ADMIN_STAGING_ID : null)`. REST staging endpoints: replace the userId-required rejection with `stagingIdentityOf`; GraphQL staged mutations (analyze-replace, replace, update-metadata's cover leg): same helper replaces the raw `context.viewer.userId` staging key. Book-TARGETING (decoded owner) unchanged — do not touch authScopes or owner resolution.
- [ ] **Step 2 — three-way isolation tests** (seen-to-fail each arm): bob cannot consume alice's staged file; alice cannot consume admin-staged; admin cannot consume bob's. Plus: admin stages cover → admin applies it to alice's book via `bookUpdateMetadata` with alice's book gid → alice's cover BYTES change (the end-to-end that was impossible before). Update spec 1's admin-replace gate paragraph: CLOSED, resolved here (docs edit rides in Task 5's commit-free zone but make the edit now while context is loaded).
- [ ] **Step 3 — plugin removal**: remove ErrorsPlugin + ValidationPlugin from builder.ts's list and package.json deps; comment at the list per the spec's wording (why each is absent). SDL must be BYTE-IDENTICAL (`git diff` on schema.generated.graphql empty + `graphql:schema:check`). Suite green proves nothing consumed them.
- [ ] **Step 4 — derivation swap with stop-on-drift**: locate REST's inline currentChapter computation (`routes/ui.ts:303-312` region); write a comparison test FIRST running both implementations over the route's existing fixtures + edge rows (empty spine, out-of-range). IDENTICAL outputs → swap route to `deriveCurrentChapter`, keep the comparison test as the drift guard. DIFFERENT → STOP, report the divergence with inputs (live-bug surface, spec's explicit stop rule).
- [ ] **Step 5 — upload caps**: `fileSize` limits — book upload + EPUB staging 200MB (`200 * 1024 * 1024`), cover staging 20MB; align (don't duplicate) if a limit already exists on the cover multer. Tests: oversize → 413-shaped rejection per endpoint (multer's LIMIT_FILE_SIZE mapped to whatever error shape the routes' asyncHandler produces — read how multer errors surface first; assert the actual shape).
- [ ] **Step 6 — login limiter**: fixed-window in-memory limiter on `POST /api/login` — 10 attempts/min per IP, 429 + `Retry-After`; window state in a module-scope Map with lazy sweep (no timers — TTL-sweep precedent from replace-staging). Successful login does NOT reset the window (simpler, safer). Sync-password/OPDS endpoints EXCLUDED — doc comment explains (device retry storms; bcrypt cost is the mitigation). Tests: 11th attempt in-window → 429; different IP unaffected; window expiry admits again (inject clock — the limiter takes `now()` as a parameter like `shouldPublish`).
- [ ] **Step 7**: Suite + lint; verify REST diff = exactly the sanctioned surface. Commit `feat(server): admin staging, upload caps, login limiter, plugin cleanup`.

### Task 5: Docs — Apollo handoff rewrite + preservation

**Files (all docs, gitignored, no commit):**
- Modify: `docs/superpowers/specs/2026-07-30-graphql-server-design.md` (handoff rewrite + gate closure), `docs/superpowers/specs/2026-08-02-pre-client-polish-design.md` (Status → implemented)
- Create: `docs/superpowers/reviews/2026-08-02-{schema-design,apollo-fit,server-hygiene}.md` (copies from the scratchpad paths in this plan's header)

- [ ] **Step 1**: Copy the three review files into `docs/superpowers/reviews/` verbatim, with a one-line provenance header each (date, commit reviewed, session).
- [ ] **Step 2**: Rewrite spec 1's "Phase 2 (Houdini) inputs" as "Phase 2 (Apollo Client) inputs" per the spec's §7 list: typePolicies table (Viewer/Config `keyFields: []`, Progress `["userId","document"]`, ScanStatus default-id, relayStylePagination for every connection field — enumerate them from the SDL), possibleTypes via codegen from the committed SDL (prod introspection off), SSELink guidance (graphql-sse distinct-connections; strip Apollo v4's `operationType` body field), errorLink contract (points at Task 3's content-negotiation tests as the server half), the hand-written-`update` mutation list (~10 — enumerate which, from the SDL's delete/create/link shapes), gid `encodeURIComponent` caveat, silent-logout note with the res-is-reachable correction. Fold in anything else from the apollo-fit review the list missed; the review copy is the deep reference, the handoff is the checklist.
- [ ] **Step 3**: Verify spec 1's admin-replace gate paragraph reads CLOSED (Task 4 Step 2 edited it; confirm), and the pre-client spec's Status header carries the final commit range + suite count.
- [ ] **Step 4**: Grep gate over both specs: `Houdini` (survivors only in historical/supersession context), `jobId`, `deletedBookId`, `?user=`-related claims that predate Task 2. Suite + lint once, proving docs-only (`git status` clean of tracked changes).

---

## Definition of done

- Suite green (report final count vs 1698 base), lint clean, `graphql:schema:check` clean.
- Cumulative SDL diff vs `8aa685c5` = exactly the Global Constraints enumeration.
- REST-visible diff = exactly the sanctioned surface.
- Docs updated; reviews preserved; grep gates clean.
