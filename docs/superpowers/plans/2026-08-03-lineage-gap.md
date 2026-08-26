# Lineage Gap + Orphan Error Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the one REST-only functional gap (`bookClearEditLineage`) and remove the orphan `BookAlreadyExistsError` type from the client-visible schema.

**Architecture:** The new mutation is a near-clone of `bookClearEditions` — same input collapse, same payload shape, same null conventions — differing only in the store call and the honest naming. The orphan removal deletes a GraphQL model directory while leaving the store error class intact.

**Tech Stack:** Pothos v4, graphql-yoga, vitest.

Spec: `docs/superpowers/specs/2026-08-03-lineage-gap-design.md` — its rulings bind.

## Global Constraints

- Base: `03c8d772`, suite 1933/1933, `test:cost` 30/30, lint clean.
- All established mutation-pattern rules bind: `builder.mutationField` + explicit Input/Result union; literal `__typename`; no Prisma refs in unions; `toResult` ONLY where a known store error is genuinely possible; zero try/catch/throw in resolver bodies; `../<entity>/model` imports; inputs declared inline in the mutation file.
- Cross-tenant tests assert FORBIDDEN **and** victim data unchanged; admin-traversal asserts CONTENTS; every property-protecting test seen-to-fail.
- REST routes and stores UNTOUCHED (the legacy `DELETE /api/books/:id/lineage` stays until spec 3).
- SDL surface for the whole plan: `bookClearEditLineage` + `BookClearEditLineageInput` + `BookClearEditLineagePayload` + `BookClearEditLineageResult` added; `BookAlreadyExistsError` removed. Nothing else.
- The `Cost calibration` suite must stay green — see Task 1 Step 7.
- Tests from `app/server`; lint from repo root. Commits end with:
  `Claude-Session: https://claude.ai/code/session_01DUA8zt35fR6gXqxiT7S5f3`

## File Structure

- Create: `app/server/graphql/schema/book/mutation/clear-edit-lineage.ts` + `clear-edit-lineage.test.ts`
- Modify: `app/server/graphql/schema/book/index.ts` (register the new mutation)
- Delete: `app/server/graphql/schema/book-already-exists-error/` (model.ts, index.ts)
- Modify: whatever registers that error type (locate: `grep -rn "book-already-exists-error" app/server/graphql/`)
- Modify: `app/server/graphql/schema.generated.graphql` (regenerated)
- Docs: the lineage spec's status; the REST inventory note in the Apollo handoff if it names the gap

---

### Task 1: `bookClearEditLineage`

**Files:**
- Create: `app/server/graphql/schema/book/mutation/clear-edit-lineage.ts`, `clear-edit-lineage.test.ts`
- Modify: `app/server/graphql/schema/book/index.ts`
- Test: the new test file

**Interfaces:**
- Consumes: `parseCompoundId`, `NO_MATCH_USER_ID` (`schema/node-scope.ts`); `context.loadOwner(userId)`; `context.stores.book.clearEditLineage(owner, id): Promise<number>`.
- Produces: `Mutation.bookClearEditLineage(input: BookClearEditLineageInput!): BookClearEditLineageResult` (nullable).

**The template.** `app/server/graphql/schema/book/mutation/clear-editions.ts` is a near-exact model — read it first and follow it structurally. The differences are exactly three:

1. **Store call**: `clearEditLineage(owner, bookId)` returns `Promise<number>` (NOT `number | null` like `clearDeviceEditions`). It cannot signal "book not found" — a raw `$executeRaw` DELETE returns 0 rows affected for a nonexistent book just as it does for a book with no edit rows. **So the not-found check must be explicit**: call `context.stores.book.getBookById(owner, bookId)` first and return `null` if it's `null`, mirroring REST (`routes/ui.ts:1102-1106` does exactly this). Do not conflate "0 rows cleared" with "book not found" — they are different answers and REST distinguishes them.
2. **Naming**: `bookClearEditLineage` / `BookClearEditLineageInput` / `BookClearEditLineagePayload` / `BookClearEditLineageResult`.
3. **Doc comment**: must state that this clears ONLY `type = 'edit'` rows (`book-store.ts:646-653`), that `type = 'merge'` rows written by `linkDocument` survive, and that this is therefore NOT a bulk `bookUnlinkDocument` — they touch disjoint row sets.

- [ ] **Step 1: Read the template and the REST route.** `clear-editions.ts` (whole file), `routes/ui.ts:1096-1111`, `book-store.ts:646-653`. Confirm the `Promise<number>` vs `Promise<number | null>` difference for yourself before writing code — it is the one place a copy-paste would introduce a bug.
- [ ] **Step 2: Write the failing tests.** In `clear-edit-lineage.test.ts`, adapting `clear-editions.test.ts`'s harness:
  - happy path: a book with edit-lineage rows → `clearedCount` equals the number of edit rows, payload's `book.id` equals the input global ID;
  - **THE LOAD-BEARING TEST — merge rows survive**: seed a book with BOTH an `edit` row and a `merge` row (use `linkDocument` or a direct fixture — check how `link-document.test.ts` seeds merge rows), clear, then assert the merge row is STILL PRESENT (query `Book.lineage` and assert the merge entry is there) and `clearedCount` counted only the edit row. This is the test that proves the name honest;
  - book not found → `null` (and, distinctly, a book that exists with zero edit rows → payload with `clearedCount: 0`, NOT null — these two must be separately asserted);
  - cross-tenant: bob passes alice's book global ID → FORBIDDEN, and alice's edit rows still present;
  - admin-traversal: admin clears alice's book, asserting CONTENTS (the cleared count and alice's surviving merge row);
  - owner-null arm: well-formed gid naming an unknown user, admin caller → `null`.
- [ ] **Step 3: Run them; verify they fail** (`npx vitest run graphql/schema/book/mutation/clear-edit-lineage`) — expected failure is the unknown field `bookClearEditLineage`.
- [ ] **Step 4: Implement** `clear-edit-lineage.ts` following `clear-editions.ts` structurally, with the three differences above. Register it in `schema/book/index.ts` alongside its siblings.
- [ ] **Step 5: Run the tests; all pass.**
- [ ] **Step 6: Seen-to-fail, both directions.** (a) Substitute `context.viewer!.userId` for the decoded `userId` in BOTH `authScopes` and the resolver → cross-tenant and admin-traversal tests must red (the variant-C break; the ledger's C/A guidance says C reds cross-tenant, A reds admin-contents — run A too: resolver-only substitution). (b) Change the store call to clear ALL lineage types (temporarily drop the `type = 'edit'` clause by calling a stub) → the merge-rows-survive test must red. Restore after each; report which tests reddened.
- [ ] **Step 7: Cost calibration.** Run `npm run test:cost -w app/server`. The suite must stay green. Check the printed table: if a mutation fixture exists for this shape, note its % of budget; the existing "mutation" row measured 2/0.0% so a new mutation is not expected to approach the 70% line — but confirm rather than assume, and report the number.
- [ ] **Step 8:** Regenerate SDL; diff = the 4 new types/fields only. Full suite + lint from repo root. Commit `feat(graphql): add bookClearEditLineage`.

### Task 2: Remove the orphan `BookAlreadyExistsError` + docs

**Files:**
- Delete: `app/server/graphql/schema/book-already-exists-error/model.ts`, `index.ts` (the directory)
- Modify: the registration site (locate: `grep -rn "book-already-exists-error" app/server/graphql/ --include="*.ts"`)
- Modify: `app/server/graphql/schema.generated.graphql` (regenerated)
- Modify (docs, gitignored): `docs/superpowers/specs/2026-08-03-lineage-gap-design.md` status; the Apollo handoff if it references the gap or the type

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: an SDL without `BookAlreadyExistsError`.

**The distinction that matters.** There are TWO things named `BookAlreadyExistsError`:
- the **store error class** in `app/server/services/book-store.ts` — thrown by `addBook`, genuinely real, **KEEP IT**;
- the **GraphQL model** in `schema/book-already-exists-error/` — referenced by zero unions, **DELETE IT**.

`to-result.ts` imports the STORE class (lines 2, 23, 33) into its `KnownStoreError` union. **That import stays.** The union describes what stores throw, which is unchanged. Deleting it there would break `toResult`'s runtime class check for a future call site and would misdescribe the stores.

- [ ] **Step 1: Establish the orphan status yourself.** `grep -n "BookAlreadyExistsError" app/server/graphql/schema.generated.graphql` — confirm it appears only as a type declaration and in no `union` line. If it IS referenced by a union, STOP and report: the premise is wrong and the type must stay.
- [ ] **Step 2: Write the failing test.** Add to whichever test asserts the schema's error-type inventory (locate: `grep -rn "UserError" app/server/graphql --include="*.test.ts" | head`) — the existing `user-error/model.test.ts` pins the list of types implementing `UserError`. Update its expected list to EXCLUDE `BookAlreadyExistsError`; the test now fails because the type is still registered.
- [ ] **Step 3: Run it; verify it fails** with the type still present in the list.
- [ ] **Step 4: Delete** `schema/book-already-exists-error/` and its registration import. Verify `to-result.ts` still compiles and its `KnownStoreError` union still names the STORE class (it imports from `../../services/book-store`, not from the deleted directory — confirm this; if it imports from the schema directory instead, that's a real coupling to fix by pointing it at the store).
- [ ] **Step 5: Run the tests; all pass.** Then `grep -rn "bookAlreadyExistsError\|BookAlreadyExistsError" app/server/graphql --include="*.ts"` — every surviving hit must be the store-class import in `to-result.ts` or a historical comment. Any surviving factory call is a compile error you should have hit; if not, investigate.
- [ ] **Step 6:** Regenerate SDL; diff = `BookAlreadyExistsError` removed only. Full suite + lint. Commit `refactor(graphql): remove the unreachable BookAlreadyExistsError type`.
- [ ] **Step 7: Docs (no commit — `docs/` is gitignored).** Set the lineage spec's Status to implemented with the commit range and final suite counts. Update the Apollo handoff (`docs/superpowers/specs/2026-07-30-graphql-server-design.md`) where it lists mutations or error types: add `bookClearEditLineage` to the mutation inventory (the count moves 23 → 24) and remove `BookAlreadyExistsError` from the error-model table, noting the store class still exists for the REST upload seam. Grep both specs for `BookAlreadyExistsError` and `23 mutations`/`Twenty-three` — every survivor must be a correct historical reference.

---

## Definition of done

- Suite green (report final count vs 1933 base), lint clean, `test:cost` 30/30.
- SDL diff vs `03c8d772` = exactly the 4 additions + 1 removal.
- `git diff --stat` on `app/server/routes/` and `app/server/services/` EMPTY.
- The merge-rows-survive test exists and was seen to fail.
- Docs updated; mutation count reconciled to 24.
