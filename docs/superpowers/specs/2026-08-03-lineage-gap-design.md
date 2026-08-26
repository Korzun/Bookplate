# Lineage Gap + Orphan Error Cleanup — Design

Status: implemented, 2026-08-03 (`03c8d772e0..8d576127`) — Task 1 (`4bad2d0b`, `bookClearEditLineage`)
suite 1941/1941; Task 2 (`8d576127`, orphan `BookAlreadyExistsError` removal + docs) suite
1939/1939 (two fewer than Task 1's count: the deleted type's dynamic `it.each` case and the
`existingBook`-resolver test it owned). `test:cost` 30/30 throughout, lint clean.
Depends on: cost-calibration plan (complete at `03c8d772`, suite 1933/1933).
Timing: before the Apollo client migration — one is a functional gap a migrating screen
would hit, the other is schema surface the client's codegen would otherwise generate.

## 1. `bookClearEditLineage` — the one functional REST-only gap

**Finding (REST inventory, 2026-08-03):** of 52 non-sync/non-OPDS REST endpoints, exactly
one has no GraphQL equivalent: `DELETE /api/books/:id/lineage` (`routes/ui.ts:1096-1111`).

**Corrected characterization.** An earlier summary called this "the bulk version of
`bookUnlinkDocument`". It is not. `BookStore.clearEditLineage` (`book-store.ts:646-653`)
deletes only `type = 'edit'` rows — the organic re-import history written by `reimportBook`
— while `linkDocument`/`unlinkDocument` operate on `type = 'merge'` rows (manual KOReader
links). The two touch disjoint row sets, so this is a **distinct operation with no GraphQL
equivalent at any granularity**, not a coarser form of one we already have.

**Name.** `bookClearEditLineage`, not `bookClearLineage`. The shorter name would overclaim:
merge rows survive the operation. Wordier and honest beats shorter and wrong.

**Shape** (mirrors `bookClearEditions`, its closest sibling — same "bulk clear, report a
count, return the parent" pattern):

- Input `BookClearEditLineageInput { id: ID! }` — a `Book` global ID, matching every book
  mutation post-Relay-ID. Declared inline in the mutation file (all 23 inputs are).
- Auth: `ownerOf` on the **decoded** owner from the global ID. Cross-tenant → FORBIDDEN.
- Payload `BookClearEditLineagePayload { book: Book!, clearedCount: Int! }` — `book` is what
  Apollo needs to update the cached entity; `clearedCount` mirrors REST's `{ cleared }`.
- Result: single-member union (`BookClearEditLineageResult`), per the standing rule that even
  an error-free mutation declares one — it keeps the error door open without a breaking
  change later.
- **No `toResult`**: `clearEditLineage` is a raw `$executeRaw` and throws none of the seven
  known store errors. Wrapping it would make the `err` branch undischargeable.
- Book not found → `null`, matching REST's 404 and the convention every sibling uses.

**Tests.** Cross-tenant (bob cannot clear alice's; alice's rows survive — assert both);
admin-traversal asserting CONTENTS; the owner-null arm; and — the load-bearing one — **a test
proving `type = 'merge'` rows survive**, since that is precisely what the name claims and
what distinguishes this from `bookUnlinkDocument`. Seen-to-fail on each.

## 2. Remove the orphan `BookAlreadyExistsError` GraphQL type

`type BookAlreadyExistsError implements UserError` is declared in the SDL
(`schema.generated.graphql:49`) and referenced by **zero** result unions — no mutation can
return it. Its only throw site is `BookStore.addBook`, reached from the scan pipeline and
the REST upload seam, neither of which is a GraphQL mutation; declaring it on any existing
union would violate the no-fabrication rule.

Left in place it is not a runtime problem, but it *is* client-visible: Apollo's codegen emits
it into `possibleTypes` and generated union types, handing client authors a branch that can
never execute.

**Remove** `schema/book-already-exists-error/` (model, factory, index, registration) so the
type leaves the SDL.

**Keep** the *store* error class `BookAlreadyExistsError` (`services/book-store.ts`) and its
entry in `to-result.ts`'s `KnownStoreError` union. That union describes what the stores
genuinely throw — which is unchanged — not what the schema exposes. Removing it there would
be a lie of a different kind, and would break `toResult`'s runtime class check if a future
call site ever needs it. Re-adding the GraphQL type later is mechanical.

## SDL surface

Exactly: `Mutation.bookClearEditLineage` + `BookClearEditLineageInput` +
`BookClearEditLineagePayload` + `BookClearEditLineageResult` added;
`BookAlreadyExistsError` removed. Nothing else.

## Constraints

REST routes untouched (the legacy `DELETE /api/books/:id/lineage` stays until spec 3 deletes
it with the rest). Stores untouched. All established mutation-pattern rules bind. The
`Cost calibration` suite must stay green — a new mutation fixture is cheap, but check where
it lands relative to the 70% headroom line.

## Delivery

One plan, two tasks: (1) the mutation; (2) the orphan removal + docs. Subagent-driven,
usual review cadence.
