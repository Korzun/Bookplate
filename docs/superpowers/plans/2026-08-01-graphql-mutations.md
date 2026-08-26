# GraphQL Mutations & Scan Subscription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete spec 1's server contract — the 23 mutations with typed error unions, and the scan-progress subscription — so the client migrates once against a finished API.

**Architecture:** Mutations follow the spec's functional style: exactly one `try`/`catch` per mutation, living in a shared `toResult` adapter that maps the seven known store error classes onto typed error values; resolver bodies contain no `try`/`catch`/`throw`. Validation runs inside resolvers (zod), returning `InvalidInputError` as an ordinary union member — the validation plugin's declarative arg option is forbidden (it requires `unsafelyHandleInputErrors`, which bypasses auth). Every mutation returns the mutated entity for Houdini cache updates; deletes return `deletedId` + the parent. The subscription is SSE on the existing `/graphql` endpoint via yoga's `createPubSub`, fed by pure `reduceScanJob`/`shouldPublish` functions the `ScanJobStore` delegates to.

**Tech Stack:** TypeScript, graphql 16, graphql-yoga 5 (pubsub + SSE), Pothos 4 (`relayMutationField`, errors plugin, scope-auth), zod 4, Prisma 7 + SQLite, Vitest.

**Source specs:** `docs/superpowers/specs/2026-07-30-graphql-server-design.md` (§Mutations, §Error model, §Scan progress, and ALL handoff sections) and `2026-08-01-schema-cleanup-design.md` §Final outcome. **Both specs' handoff notes are binding inputs — read them before any task.**

## Global Constraints

- **SDL gate:** every schema-changing task regenerates and commits the artifact; the review evidence is the SDL diff showing the intended change and nothing else. `npm run lint` includes `graphql:schema:check`.
- **REST untouched and green.** No edits under `app/server/routes/`. Stores are consumed as-is — EXCEPT the two changes this plan's spec explicitly grants: `bookStore.scan` gains an optional `onProgress` callback (Task 8), and `ScanJobStore` gains reducer-delegating methods (Task 8). Nothing else.
- **Functional style:** no classes in new `graphql/` code (ScanJobStore stays a class — existing code; its NEW logic goes into pure functions it delegates to). No `any`. Unused identifiers `_`-prefixed. Resolver bodies: no `try`/`catch`/`throw` — `toResult` owns the boundary.
- **Every mutation is authenticated.** Pothos auto-creates `Mutation` WITHOUT options on first `mutationField` — Task 1 must declare `builder.mutationType({ authScopes: { authenticated: true } })` BEFORE any mutation field lands, and `root-auth.test.ts`'s walk (already argument-aware via `placeholderLiteral`) covers every mutation automatically. Extend `placeholderLiteral` for unhandled arg kinds rather than working around it — it THROWS on unknown shapes by design.
- **`userChangePassword` requires `skipTypeScopes: true`** plus the `passwordChangeAllowed` scope — the type-level `authenticated` scope excludes `mustChangePassword` users, who are exactly who that mutation serves. (Spec handoff, learned in phase 1.)
- **Admin-vs-owner:** every mutation matches its REST route's authorization EXACTLY. The briefs state expectations; **implementers verify against `routes/*.ts` before building — twelve briefs have been wrong on this branch, including one asserting admin-only on an open route.** If the brief contradicts REST, REST governs; say so.
- **Test rigor (8 instances and counting):** any test protecting one property must be SEEN TO FAIL against a broken version. Tenant-scoped mutations get the admin-traversal shape (self-reads cannot discriminate owner-derivation). Mutations that delete/modify get a cross-tenant attempt test: bob mutating alice's entity must fail AND alice's data must be unchanged (assert both).
- **Report hygiene:** check before "nowhere else"/"always"; corrections edit in place; flag disagreements with sibling paths even when told to build them.
- Tests: `npm test -w app/server` from repo root — **1326/1326 green** at plan start. Lint from repo root only. Commits: `feat(graphql): ...` lowercase.

---

## File Structure

**Created:** `schema/user-error/{index,model}.ts` (interface), one directory per typed error (`book-hash-collision-error/`, `book-already-exists-error/`, `document-already-linked-error/`, `document-is-book-error/`, `self-link-error/`, `device-slug-conflict-error/`, `epub-validation-error/`, `invalid-input-error/`), `graphql/to-result.ts` (+test), `mutation/` files inside each owning entity directory (`book/mutation/*.ts`, `progress/mutation/*.ts`, `user/mutation/*.ts`, `device/mutation/*.ts`, `library/mutation/scan.ts`, `library/subscription/scan-progress.ts`), `services/scan-events.ts` (reducer + predicate, pure), `graphql/pubsub.ts`.

**Modified:** `builder.ts` (mutationType + subscriptionType declarations when fields exist), `services/scan-job-store.ts` (delegating methods), `services/book-store.ts` (`onProgress?` param on `scan` only), `context.ts` (pubsub handle), `server.ts`/`index.ts` NOT modified (pubsub is constructed in graphql wiring, single shared ScanJobStore already injected).

**Convention:** mutation files live in the OWNING entity's directory (`book/mutation/update-metadata.ts` registers `Mutation.bookUpdateMetadata`), mirroring how `query/` holds root Query fields. One mutation per file.

---

### Task 1: Error types, `toResult`, and the gated Mutation root

**Files:** the `user-error` interface + 8 error-type directories; `graphql/to-result.ts` + test; `builder.ts` (mutationType declaration + `errors` plugin defaults if needed); SDL regenerated.

**The error model, from the spec (shapes binding):**

```graphql
interface UserError { message: String! }
type BookHashCollisionError implements UserError { message: String!, collidingBook: Book! }
type BookAlreadyExistsError implements UserError { message: String!, existingBook: Book! }
type DocumentAlreadyLinkedError implements UserError { message: String!, documentId: String!, book: Book! }
type DocumentIsBookError implements UserError { message: String!, book: Book! }
type SelfLinkError implements UserError { message: String! }
type DeviceSlugConflictError implements UserError { message: String!, slug: String! }
type EpubValidationError implements UserError { message: String!, messages: [ValidationMessage!]! }
type InvalidInputError implements UserError { message: String!, issues: [InputIssue!]! }
```

**Store error classes (pinned):** `BookHashCollisionError(collidingId)`, `BookAlreadyExistsError(existingId)`, `SelfLinkError`, `DocumentAlreadyLinkedError(documentId)`, `DocumentIsBookError(documentId)` from `book-store.ts:71-104`; `DeviceSlugConflictError` from `device-store.ts:18`; `EpubValidationError(messages, counts, threshold)` from `epub-validator.ts:119`. The GraphQL error types RESOLVE ids into entities (`collidingBook: Book!` from `collidingId` + the owner) — the graph upgrade the spec promises.

**`toResult` contract:**
```ts
type MutationResult<T> = { ok: T } | { err: KnownStoreError };
const toResult = async <T>(run: () => Promise<T>): Promise<MutationResult<T>>
```
Catches ONLY the seven known classes (instanceof checks); everything else re-throws to yoga's masking. Table-driven tests: each known class → err; an unknown Error → re-thrown; a resolved value → ok. TDD.

**Mutation root gating:** declare `builder.mutationType({ authScopes: { authenticated: true } })` in `builder.ts` — with a placeholder-free approach: Pothos allows declaring the type before fields exist ONLY if at least one field lands in the same schema build, so this task adds ONE trivial mutation to carry it (`progressDelete` is the smallest real one — pull it forward from Task 5, full pattern: relayMutationField, validation, toResult, typed union, deletedId return). Verify `root-auth.test.ts` now walks `Mutation` and its assertion fires (discriminate: drop the mutationType authScopes → walk test fails → restore).

**EpubValidationError's `messages` field:** the store error carries raw message objects, not `ValidationMessage` Prisma rows. Check shapes; if they diverge, an object-type variant (not the Prisma-backed type) is the honest mapping — decide and justify, don't force the Prisma type.

- [ ] RED: toResult table tests + the pulled-forward `progressDelete` mutation test (auth walk + happy path + cross-tenant attempt)
- [ ] Implement; regenerate SDL (diff: UserError interface + 9 types + InputIssue + Mutation root with one field — nothing else)
- [ ] Full suite; lint; commit `feat(graphql): add the typed error model and gated mutation root`

---

### Task 2: Book metadata + delete (`bookUpdateMetadata`, `bookDelete`)

REST parity sources: `PATCH /api/books/:id/metadata` (JSON fields ONLY — the multipart cover stays REST per the spec's binary boundary; state this in the mutation's doc comment), `DELETE /api/books/:id`. Read both routes for validation rules (`ISO_8601_RE` on publishDate, subjects/identifiers shapes) and replicate via zod inside the resolver → `InvalidInputError`. `bookUpdateMetadata` returns the updated `Book`; errors: `BookHashCollisionError` (metadata edits re-hash content), `EpubValidationError`, `InvalidInputError`. `bookDelete` returns `deletedBookId: String!` + `library: Library!`. Cross-tenant attempt tests both mutations (bob→alice fails, alice's row unchanged). Owner comes from the resolved Library-style owner (mutations take a raw `bookId` + derive owner from viewer/`user:` arg matching REST's `resolveOwner` semantics — verify how REST resolves the admin `?user=` case and mirror with `ownerOf`).

- [ ] RED → implement → SDL diff (2 mutations + their payload/union types) → suite/lint → commit

### Task 3: Book maintenance (`bookValidate`, `bookRegenChapters`, `bookAnalyzeReplace`, `bookReplace`)

REST: `POST .../validate`, `.../regen-chapters`, `.../replace/analyze`, `.../replace`. Notes: regen-chapters requires `valid === true` (409 in REST → a typed precondition error or InvalidInputError — check REST's exact semantics and mirror the CODE, not the transport); replace is multipart in REST — **the file-upload half stays REST**; `bookReplace` in GraphQL applies an already-staged replace if REST's flow separates analyze/stage from commit — READ the routes first; if replace is inseparable from the upload, report NEEDS_CONTEXT with the evidence rather than inventing a byte-carrying mutation (the spec forbids binary in GraphQL).

*Adjudicated 2026-08-01 (spec self-conflict, human ruling): staged-upload hybrid — see the
spec's "Replace staging" paragraph under §Seams that stay REST, which governs. New REST
endpoint `POST /api/books/replace-staging` + functional `services/replace-staging.ts`
(stage/resolve/consume keyed to the authenticated user, 30-min lazy TTL sweep);
`bookAnalyzeReplace(bookId, stagedUploadId)` reads without consuming, `bookReplace(bookId,
stagedUploadId, acceptedFixKeys)` consumes on success; unknown/expired/foreign ids →
`StagedUploadNotFoundError` (indistinguishable across the three cases).*
- [ ] Same cycle.

### Task 3b: Cover via staged upload (`bookUpdateMetadata.stagedCoverId`)

Added 2026-08-01 by user request, after the Task 3 staged-upload adjudication. Extends the
staging seam to cover writes so the phase-2 client updates metadata and cover in ONE mutation
instead of a GraphQL call plus an uncoordinated REST PATCH.

Depends on Task 3's `services/replace-staging.ts` and `POST /api/books/replace-staging`.

- Generalize the staging seam for image bytes: either a `kind` on the existing endpoint or a
  sibling `POST /api/books/cover-staging` — whichever fits `ui.ts` conventions — using the
  cover multer config (image MIME types + its size limit, NOT `epubUpload`). Same service
  functions underneath (stage/resolve/consume are content-agnostic); same authenticated-user
  keying and TTL. If the service needs a parameter for allowed kinds, add it; do not fork the
  service.
- `BookUpdateMetadataInput` grows OPTIONAL `stagedCoverId: String` *(String, not ID — staged
  ids are opaque service tokens, not Relay node ids; adjudicated at review)*. When present, the resolver
  applies the cover through the SAME store path REST's `PATCH /api/books/:id/metadata`
  multipart-cover branch uses (read the route; mirror its processing exactly — resizing,
  format handling, whatever it does), consuming the staged file on success. When absent,
  behavior is byte-identical to today's mutation.
- Cover application and metadata write happen in the same mutation invocation; if the cover
  step can fail independently, mirror REST's semantics for partial application (read the
  route: does REST apply metadata when the cover write fails? mirror THAT, and document it).
- `StagedUploadNotFoundError` joins `bookUpdateMetadata`'s result union (honest member, no
  fabrication). SDL diff: the input field + the union member + any staging-endpoint-related
  types, nothing else.
- Tests: staged-cover happy path asserts the cover BYTES actually changed (not just a 200);
  foreign/expired `stagedCoverId` → `StagedUploadNotFoundError` with metadata NOT applied
  (or applied, if REST's partial semantics say so — assert whichever REST does);
  cross-tenant (bob's staged cover against alice's book fails, alice unchanged);
  metadata-only calls unchanged (regression); seen-to-fail on all property-protecting tests.
- The REST multipart-cover branch of `PATCH /api/books/:id/metadata` stays untouched until
  the client migrates.
- [ ] Same cycle.

### Task 4: Book lineage (`bookLinkDocument`, `bookUnlinkDocument`, `bookClearEditions`, `bookResolvePendingFix`)

Stores: `linkDocument(owner, bookId, documentId): Promise<true|null>`, `unlinkDocument`, `clearEditLineage`, `clearDeviceEditions(owner,id): Promise<number|null>`, `deletePendingFix`. Errors: `SelfLinkError`, `DocumentAlreadyLinkedError` (resolve `documentId`→`book`), `DocumentIsBookError`. `bookResolvePendingFix` mirrors REST's pending-fix accept/dismiss routes (`POST/DELETE /api/books/:id/pending-fixes` — read them; the accept path applies fixes via `upsertPendingFix`/apply flow). Returns respect the schema-cleanup outcome: `PendingFix` readings are TTL-filtered.
- [ ] Same cycle.

### Task 5: Progress (`progressSet`; `progressDelete` landed in Task 1)

REST: `PUT /api/my/progress/:document` (kosync-shaped body), `DELETE`. `progressSet` returns the `Progress`; validation via zod (percentage 0..1, document non-empty — read REST's checks). Remember `Progress` keys on `document` client-side — return shape must carry it.
- [ ] Same cycle.

### Task 6: User mutations (`userRegister`, `userDelete`, `userResetPassword`, `userChangePassword`, `userRegenerateSyncPassword`)

REST parity: `routes/users.ts` (admin-gated: register/delete/reset) + `routes/ui.ts` `/api/my/password`, `/api/my/sync-password/regenerate` (self-service). **`userChangePassword`: `skipTypeScopes: true` + `passwordChangeAllowed` scope — the type-level scope would block its own users.** Discriminate: a `mustChangePassword` viewer CAN call it (test), and cannot call anything else (already covered by the walk). `userDelete` mirrors REST's on-disk `rmSync(booksRoot/<username>)` via the store/route logic — verify which layer owns that today; if it's route-level code, the mutation calls the same store methods AND replicates the fs cleanup via a shared helper, NOT a copy (flag if extraction is needed). `userResetPassword` refuses the config admin (REST 403s it). Admin mutations take `User` global IDs (`t.arg.globalID({ for: user.model })`).
- [ ] Same cycle.

### Task 7: Device mutations (`deviceCreate`, `deviceUpdate`, `deviceDelete`, `deviceEnableUser`, `deviceDisableUser`)

REST: `routes/devices.ts` — ALL admin-gated (verified in read-model Task 14: only `GET /` is open). `DeviceSlugConflictError` on create/update. `deviceDisableUser` also purges editions (`editionStore.purgeForDeviceAndUser` — REST swallows purge failures with a warn; decide and document whether GraphQL mirrors that swallow or surfaces it, flag the divergence either way). `coverFit` input uses the existing `CoverFit` enum (input side — lowercase `value:` mapping already correct for storage).
- [ ] Same cycle.

### Task 8: Scan machinery (`services/scan-events.ts`, `ScanJobStore` delegation, `bookStore.scan` onProgress, `libraryScan` mutation)

Pure functions (spec §Scan progress, shapes binding):
```ts
type ScanProgress = | { phase: 'importing'; total: number; processed: number; filename: string;
    outcome: 'imported'|'renamed'|'already-imported'|'skipped'; bookId?: string }
  | { phase: 'pruning'; total: number; processed: number; bookId: string };
reduceScanJob(job: ScanJob, event: ScanEvent): ScanJob   // returns new job, no mutation
shouldPublish(lastPublishedAt: number, now: number, event: ScanEvent): boolean  // 250ms coalesce, terminal events always publish
```
Table-driven tests — the coalescing predicate is testable against a table of inputs, no fake timers. `ScanJobStore` keeps its class shape; new methods delegate to the reducer (replacing in-place mutation like `job.status = 'completed'` is ALLOWED here — it's the spec's explicit design — but keep the public API compatible with REST's usage in `routes/ui.ts`; verify the scan-status route still passes untouched). `scan(owner, importer?, onProgress?)` — optional param, existing callers unaffected (the 3702-line store suite must stay green untouched). `libraryScan` mutation starts the job (REST parity: `POST /api/books/scan` — 409 if already running; mirror as a typed error or precondition, match REST's code) and returns `ScanStatus`.
- [ ] Same cycle. SDL diff: `libraryScan` + `ScanStatus`/`ScanState`/`ScanPhase`/`ScanResult` types.

### Task 9: Subscription (`graphql/pubsub.ts`, `library/subscription/scan-progress.ts`, `Library.scanStatus` query)

Yoga `createPubSub`, per-user topic (`scan:${userId}`), published from the store's transition points via `shouldPublish`. `builder.subscriptionType({ authScopes: { authenticated: true } })` (root-auth walk extends automatically — verify it fires for subscriptions or extend it; if `placeholderLiteral` can't probe subscriptions, extend the test rather than exempting them, or document precisely why they're covered otherwise). `Subscription.scanProgress(libraryId: ID!)` carries `ownerOf` on the DECODED id (relay-before-scope-auth ordering makes the parsed id available — this is why the plugin order matters; verify it actually arrives parsed). `Library.scanStatus` query is the reconnect path. SSE transport: supertest test proving an event arrives over HTTP `Accept: text/event-stream` and that a non-owner subscription is refused. The shared `ScanJobStore` instance (injected in `index.ts` since phase 1) means REST-initiated scans are visible — test exactly that: start via the store as REST would, observe the subscription event.
- [ ] Same cycle. Coalescing discriminate: a burst of >N events within 250ms yields bounded publishes (table-tested at the predicate; one integration assertion at the store).

### Task 10: Doc sync + handoff

Spec status updates; the mutations' SDL section reconciled against the artifact; a phase-2 (client) handoff section consolidating: the full mutation list with their union members, the `PendingFix` cache-key decision STILL OPEN, `JSON`+`DateTime` scalars config, subscription transport (SSE, reconnect via `Library.scanStatus`). Grep gate: zero unexplained stale references.

---

## Definition of done

- All 23 mutations + subscription live; every mutation in the root-auth walk; every union exhaustively typed; `graphql:schema:check` enforced.
- REST untouched: its full suite green, byte-identical behaviour, shared ScanJobStore observed cross-transport.
- Resolver bodies contain zero `try`/`catch`/`throw` (grep-verified); `toResult` is the single boundary.
- Full suite green; both specs' schema sections match the artifact.
