# Book Identity via Relay ID Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Relay global ID the only book identifier in the GraphQL schema — remove the raw hash from outputs and collapse every book-mutation input to a single `id: ID!`.

**Architecture:** The Book global ID already encodes `JSON.stringify([userId, bookId])` (Pothos compound-key serializer). Each mutation decodes it with `node-scope.ts`'s existing `parseCompoundId`, runs `ownerOf` on the decoded userId (FORBIDDEN semantics unchanged), and proceeds with `{userId, bookId}` exactly as before. Stores and REST never change.

**Tech Stack:** Pothos v4 (relay `t.globalID` args with `for:` type scoping), graphql-yoga, zod, vitest.

Spec: `docs/superpowers/specs/2026-08-02-book-relay-id-design.md` — read it first; its rulings bind.

## Global Constraints

- Base: `1b5056b9`, suite 1709/1709, lint clean. Branch `graphql-migration`.
- All spec-1 pattern rules bind (ledger is gone — the spec-1 document's "Phase 2 (Houdini) inputs" + this plan carry what's needed): `builder.mutationField` + explicit Input/Result union; literal `__typename` on every union value; no prismaObject/prismaNode refs in unions; zero try/catch/throw in resolver bodies; single-member unions stay unions; never fabricate an error value; imports use `../<entity>/model`, never `../<entity>`.
- Denial = FORBIDDEN via `ownerOf` on the decoded userId (user ruling). Malformed local id → `NO_MATCH_USER_ID` scope (non-admin: FORBIDDEN; admin: falls through to the resolver's `null` not-found path).
- Wrong-type global ID (e.g. a Series id) must be rejected before the resolver runs (relay arg layer). If `t.globalID({ for })` does not enforce this, STOP and escalate with evidence — do not hand-roll a typename check silently.
- SDL diff (cumulative, end of plan) = exactly: `Book.bookId` removed, `BookDeletePayload.deletedBookId` removed, 10 inputs reshaped, traced `InvalidInputError` union drops (expected 5 — see spec), nothing else.
- REST routes, stores, client: zero changes. `git diff --stat` on `app/server/routes/ app/server/services/ app/client/` must be empty at plan end (services/ empty — no store change is needed anywhere in this plan).
- Cross-tenant tests assert FORBIDDEN AND victim data unchanged. Seen-to-fail on every property-protecting test — especially the owner-substitution class: a resolver that ignores the decoded userId and uses `context.viewer.userId` instead must be caught by the cross-tenant/admin tests (spec-1's `??`-fallback bug is invisible to admin traversal alone).
- Tests from `app/server` (`npm test`); lint from repo root (`npm run lint`). Commit per task with trailer:
  `Claude-Session: https://claude.ai/code/session_01DUA8zt35fR6gXqxiT7S5f3`

## File Structure

- Modify: `app/server/graphql/schema/node-scope.ts` (export `parseCompoundId`)
- Modify: `app/server/graphql/schema/book/model.ts` (drop `bookId` field, Task 4)
- Modify: all 10 `app/server/graphql/schema/book/mutation/*.ts` + their `.test.ts`
- Modify: `app/server/graphql/schema/root-auth.test.ts` (walk placeholder for Book-typed input ids)
- Modify: `app/server/graphql/schema.generated.graphql` (regenerate per task)
- Modify (docs, gitignored, Task 5): spec 1 + this spec's status line

---

### Task 1: Decode helper + exemplar reshape (`bookValidate`)

**Files:**
- Modify: `app/server/graphql/schema/node-scope.ts:52` (make `parseCompoundId` exported)
- Modify: `app/server/graphql/schema/book/mutation/validate.ts` (whole reshape)
- Test: `app/server/graphql/schema/book/mutation/validate.test.ts`, `app/server/graphql/schema/root-auth.test.ts`

**Interfaces:**
- Consumes: `parseCompoundId(raw: string): readonly [userId: string, id: string] | null` (existing, currently module-private); `NO_MATCH_USER_ID` (exported); `encodeGlobalID` (already used by delete tests).
- Produces: THE canonical reshape all later tasks copy. Exact new shapes:

```ts
// input — the ONLY input field left on BookValidateInput:
import { model as book } from '../model';
const input = builder.inputType('BookValidateInput', {
  fields: (t) => ({
    id: t.globalID({ required: true, for: book }),
  }),
});

// authScopes — ownerOf on the DECODED userId; malformed → NO_MATCH_USER_ID:
authScopes: (_parent, args) => {
  const parsed = parseCompoundId(args.input.id.id);
  return { ownerOf: parsed === null ? NO_MATCH_USER_ID : parsed[0] };
},

// resolver head — replaces the zod block, loadOwner(userId), getBookById calls:
const parsed = parseCompoundId(args.input.id.id);
if (parsed === null) return null; // admin passed scope on a malformed id: same "no such row" convention
const [userId, bookId] = parsed;
const owner = await context.loadOwner(userId);
if (owner === null) return null;
const targetBook = await context.stores.book.getBookById(owner, bookId);
if (targetBook === null) return null;
```

- `bookValidate`'s zod schema and `invalidInputError` import are deleted; its union becomes the single-member `builder.unionType('BookValidateResult', { types: [payload] })` (spec's traced union-drop; verify no other zod remains in THIS file — there is none).

- [ ] **Step 1: Export `parseCompoundId`** — change `const parseCompoundId` to `export const parseCompoundId` in node-scope.ts (doc comment stays). Run `npx vitest run graphql/schema/node-scope` — still green.
- [ ] **Step 2: Write the failing tests** in validate.test.ts (adapt existing helpers; the file already builds owners and books):

```ts
// (1) happy path via global id — replaces every { userId, bookId } input in this file:
const gid = encodeGlobalID('Book', JSON.stringify([alice.userId, book.id]));
const res = await execute({ query: VALIDATE, variables: { input: { id: gid } } });
expect(res.data?.bookValidate?.__typename).toBe('BookValidatePayload');

// (2) cross-tenant: bob passes alice's book gid → FORBIDDEN, alice's validation row unchanged
// (3) admin passes alice's gid → payload, and CONTENTS prove alice's book (validation.bookId … via library traversal)
// (4) wrong-type gid: encodeGlobalID('Series', seriesId) → top-level error, resolver NEVER runs
//     (spy/flag: assert res.errors non-empty AND no data.bookValidate)
// (5) malformed local id: encodeGlobalID('Book', 'not-json') → non-admin: FORBIDDEN; admin: data.bookValidate === null
```

- [ ] **Step 3: Run to verify the new tests fail** (`npx vitest run graphql/schema/book/mutation/validate`) — old input shape rejects `id`.
- [ ] **Step 4: Reshape validate.ts** per the Produces block (input, authScopes, resolver head; delete zod + invalidInputError import; union → `[payload]`; update the file's doc comments — the "`bookId` is the raw content-hash id" comment is now false and must go).
- [ ] **Step 5: Root-auth walk** — root-auth.test.ts's per-arg-name global-id override (added in spec 1 Task 9) must supply a Book-typed placeholder for input field `id` on book mutations. Extend the override map; the walk must still FAIL on an ungated field (re-run its own discriminate if the file documents one).
- [ ] **Step 6: Seen-to-fail** — break the resolver with the owner-substitution bug (`const userId = context.viewer!.userId` instead of the decoded value): cross-tenant test (2) must go RED (bob's viewer-substituted call would "succeed" against his own empty library → assert FORBIDDEN specifically, and admin test (3) contents must catch the admin-shaped variant). Revert; all green.
- [ ] **Step 7: Regenerate SDL** (`npm run graphql:schema` or the repo's script), verify diff = BookValidateInput reshape + BookValidateResult member drop only. Full suite + lint.
- [ ] **Step 8: Commit** `refactor(graphql): bookValidate takes a Book global ID`

### Task 2: Reshape the no-remaining-zod cohort (`bookDelete`, `bookRegenChapters`, `bookClearEditions`, `bookResolvePendingFix`)

**Files:**
- Modify: `app/server/graphql/schema/book/mutation/{delete,regen-chapters,clear-editions,resolve-pending-fix}.ts` + their `.test.ts`

**Interfaces:**
- Consumes: Task 1's canonical reshape verbatim (input field `id: t.globalID({ required: true, for: book })`; authScopes + resolver-head decode; `parseCompoundId`, `NO_MATCH_USER_ID`, `encodeGlobalID`).
- Produces: nothing new — 4 mechanical applications.

Apply Task 1's exact transform to each file. Per-file specifics:

| File | Input today | After | Union delta (TRACE, don't assume) |
|---|---|---|---|
| delete.ts | `bookId: String!`, `userId: ID!` | `id: ID!` | drop `InvalidInputError` if bookId was the only zod → expected `[BookDeletePayload]`. **Also remove `deletedBookId: String!` from `BookDeletePayload`** (spec output removal #2; `deletedId: ID!` stays and its encode already uses the same compound string — assert the payload's `deletedId` equals the input gid). |
| regen-chapters.ts | `bookId`, `userId: ID!` | `id: ID!` | drop `InvalidInputError` if traced-unreachable → expected `[BookHashCollisionError, BookNotValidatedError, BookRegenChaptersPayload]` |
| clear-editions.ts | `bookId`, `userId: ID!` | `id: ID!` | expected `[BookClearEditionsPayload]` |
| resolve-pending-fix.ts | `action`, `bookId`, `userId: ID!` | `action`, `id: ID!` | `action` is enum-validated by GraphQL, not zod — if NO zod remains, drop `InvalidInputError`; if the file zod-validates anything else, KEEP it and say so in the report |

Each file's cycle:
- [ ] **Step 1:** Rewrite that file's tests to global-id inputs (the wrong-type/malformed arg-layer classes are covered ONCE, in Task 1's representative tests — per the spec, do NOT duplicate them per file; the arg mapper is shared machinery); keep every existing property test's discriminating power (cross-tenant asserts FORBIDDEN + victim unchanged; admin-traversal asserts contents; delete's tests keep asserting the row is gone AND `deletedId`).
- [ ] **Step 2:** Run; verify fails against old shape.
- [ ] **Step 3:** Apply the reshape; delete dead zod/imports; fix doc comments that mention `bookId`/`userId` args.
- [ ] **Step 4:** Seen-to-fail the owner-substitution break once in this cohort (delete.ts — highest stakes) and re-verify; run cohort tests + full suite.
- [ ] **Step 5:** Regenerate SDL; verify diff = these 4 inputs + traced union drops + the `deletedBookId` removal, nothing else. Lint.
- [ ] **Step 6: Commit** `refactor(graphql): book delete/regen/clear/resolve take Book global IDs`

### Task 3: Reshape the remaining-zod cohort (`bookUpdateMetadata`, `bookAnalyzeReplace`, `bookReplace`, `bookLinkDocument`, `bookUnlinkDocument`)

**Files:**
- Modify: `app/server/graphql/schema/book/mutation/{update-metadata,analyze-replace,replace,link-document,unlink-document}.ts` + their `.test.ts`

**Interfaces:**
- Consumes: Task 1's canonical reshape; these files KEEP their zod schemas minus the `bookId` line (other fields still validated) and KEEP `InvalidInputError` in their unions.
- Produces: nothing new.

Per-file specifics:

| File | Input today | After | Zod remainder (keeps InvalidInputError) |
|---|---|---|---|
| update-metadata.ts | metadata fields + `bookId` + `stagedCoverId` + `userId: ID!` | same minus `bookId`/`userId`, plus `id: ID!` | all metadata-field rules (ISO_8601_RE, identifiers, subjects…) + stagedCoverId handling — untouched |
| analyze-replace.ts | `bookId`, `stagedUploadId`, `userId: ID` | `id: ID!`, `stagedUploadId` | stagedUploadId non-empty |
| replace.ts | `acceptedFixKeys`, `bookId`, `stagedUploadId`, `userId: ID` | `id: ID!`, `stagedUploadId`, `acceptedFixKeys` | stagedUploadId + acceptedFixKeys rules |
| link-document.ts | `bookId`, `documentId`, `userId: ID!` | `id: ID!`, `documentId` | documentId non-empty (documentId stays a raw String — kosync id, not a Node) |
| unlink-document.ts | `bookId`, `documentId`, `userId: ID!` | `id: ID!`, `documentId` | documentId non-empty |

NOTE for the staged pair: staging identity remains `context.viewer.userId` (NEVER the decoded owner) — that seen-to-fail-proven property (admin cannot bypass staging) must survive the reshape untouched; re-run its discriminating tests and say so in the report. The decoded userId targets the BOOK; the staged file remains keyed to the caller.

Cycle per file: same 6 steps as Task 2 (tests-first with global-id inputs — arg-layer classes stay Task-1-only; reshape; seen-to-fail once on update-metadata; SDL check per the table — NO union changes expected in this cohort; commit).

- [ ] **Commit** `refactor(graphql): remaining book mutations take Book global IDs`

### Task 4: Remove `Book.bookId` + repo-wide sweep + final SDL gate

**Files:**
- Modify: `app/server/graphql/schema/book/model.ts:42` (delete the `bookId` field)
- Modify: every test/query selecting `bookId` on Book (grep-driven)
- Test: full suite

- [ ] **Step 1:** `grep -rn "bookId" app/server/graphql --include="*.test.ts"` and `grep -rn "bookId" app/server/graphql/schema` — inventory every remaining reference. Legitimate survivors: internal variable names, Prisma `where` clauses, store calls, `parseCompoundId` destructures. Must go: GraphQL query strings selecting `bookId`, assertions on `data.*.bookId`.
- [ ] **Step 2:** For each test that selected `bookId` to IDENTIFY a row, replace with `id` asserted against `encodeGlobalID('Book', JSON.stringify([owner.userId, rawId]))` — do not simply delete the assertion (that weakens the test).
- [ ] **Step 3:** Delete `bookId: t.exposeString('id'),` from book/model.ts. Run the failing tests from Step 2 first (they must fail while the sweep is incomplete — natural seen-to-fail), then full suite green.
- [ ] **Step 4:** Regenerate SDL. **Final purity gate:** `git diff 1b5056b9 -- app/server/graphql/schema.generated.graphql` = exactly the spec's enumerated surface (2 output removals, 10 input reshapes, traced union drops). Anything else = stop and investigate. `git diff 1b5056b9 --stat -- app/server/routes/ app/server/services/ app/client/` = empty.
- [ ] **Step 5:** Full suite + lint from repo root.
- [ ] **Step 6: Commit** `refactor(graphql): remove Book.bookId — Relay ID is the only book identifier`

### Task 5: Docs sync

**Files:**
- Modify (on disk, gitignored — do NOT commit docs): `docs/superpowers/specs/2026-07-30-graphql-server-design.md`, `docs/superpowers/specs/2026-08-02-book-relay-id-design.md`

- [ ] **Step 1:** Spec 1 §Mutations: update every book-mutation signature/union listed there to the new shapes (the union table Task 10 reconciled byte-for-byte must be re-reconciled against the new SDL). The "Every user-associated mutation takes a User global ID" sentence gains: book mutations take the Book global ID itself; the owner rides inside it.
- [ ] **Step 2:** Spec 1 "Phase 2 (Houdini) inputs": Book keys on `id` only (no raw hash anywhere); `deletedId` sole eviction key; the Task-2 carry-both rule superseded for Book (state where); staged-upload flow examples updated to `id: ID!`.
- [ ] **Step 3:** This spec's Status → implemented, with commit range.
- [ ] **Step 4:** Grep gate over both specs: `bookId` (surviving hits must be about REST/stores or historical adjudications, each intentional), `deletedBookId` (only the supersession note survives). Suite + lint once more (must be untouched by this task — zero code changes).
- [ ] **Step 5:** No commit (docs gitignored). Report the grep table.

---

## Definition of done

- Suite green (count will shift from 1709 with added/removed cases — report the final number), lint clean, `graphql:schema:check` clean.
- Final SDL diff vs `1b5056b9` = exactly the spec's enumerated surface.
- routes/services/client diffs empty.
- Both specs updated; grep gates clean.
