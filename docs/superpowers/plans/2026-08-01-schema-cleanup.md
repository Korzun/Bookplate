# Schema Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land every SDL-breaking shape fix — enums, typed `PendingFixState`, the `PendingFix` merge, field retypes/renames, connections — plus Prisma-plugin adoption and one database index, before phase 2 freezes the schema into client fragments.

**Architecture:** All changes are GraphQL-surface or below; REST serves byte-identical payloads throughout. Enums map member names onto the exact strings the database already stores. `PendingFixState` gets a total parser in `derive.ts` shared by both `PendingFix` resolvers. Connections come from `t.relatedConnection`, which supports backward pagination natively — a documented asymmetry with the hand-rolled forward-only `Library.entries`.

**Tech Stack:** TypeScript, graphql 16, Pothos 4 (`plugin-prisma` `relatedConnection`, `enumType`), `graphql-scalars` `JSON`, Prisma 7 + SQLite, Vitest.

**Source spec:** `docs/superpowers/specs/2026-08-01-schema-cleanup-design.md`

## Global Constraints

- **The SDL is SUPPOSED to change in this plan** — the review gate inverts from the two structural refactors. Every task that alters the schema regenerates the artifact (`npm run graphql:schema -w app/server`), commits it, and the reviewable evidence is the SDL diff showing exactly the intended change and nothing else.
- **REST stays untouched and byte-identical.** No edits under `app/server/routes/`; no change to any value REST serves. Stores may gain a shared pure predicate extraction (Task 3) but no behaviour change.
- **No classes in new code** under `app/server/graphql/`. No `any` — a cast silencing a genuine type error is a defect. Unused identifiers prefixed `_`.
- **Enum casing rule:** member names are SCREAMING_CASE; `value:` maps to the stored string. Where stored values are already SCREAMING_CASE (severity, threshold), name and value coincide. The database never sees member names.
- **Unknown-value policy:** no defensive fallback enum members. A stored value outside the enum fails that field's resolution.
- **Test rigor (standing lesson, 7 instances):** any test protecting one property must be *seen to fail* against a broken version. Tenant-scoped resolvers get the admin-traversal shape (a self-read cannot discriminate owner-derivation). Report both directions of every discriminate-check.
- **Report hygiene:** check before writing "nowhere else"/"always"/"verified X"; corrections edit the original sentence in place; if the brief disagrees with a sibling path (REST, store), say so even though the brief told you to do it.
- Tests: `npm test -w app/server` from the repo root — **fully green at 1285/1285** at plan start. Lint: `npm run lint` **from the repo root only**.
- Commit convention: `feat(graphql): ...` / `refactor(graphql): ...` / `feat(db): ...` lowercase.

---

## File Structure

**Created:** `schema/validation-severity/`, `schema/validation-threshold/`, `schema/cover-fit/`, `schema/suggestion-type/`, `schema/lineage-type/`, `schema/undo-kind/`, `schema/metadata-fix/`, `schema/pending-fix-state/`, `schema/undo-snapshot/` (each `index.ts` + `model.ts`, following the entity-directory convention); `derive.ts` gains `parsePendingFixState` + `isLivePendingFix`; one Prisma migration.

**Modified:** `validation-message/model.ts`, `validation/model.ts`, `device/model.ts`, `suggestion-group/model.ts`, `linked-document/model.ts`, `pending-fix/model.ts`, `book/model.ts`, `library/model.ts`, `series/model.ts`, `viewer/model.ts`, `builder.ts` (JSON scalar), `prisma/schema.prisma`, `schema.generated.graphql` (every schema task), both design specs' schema sections.

**Deleted:** `schema/pending-fix-summary/` (merged into `pending-fix`).

---

### Task 1: The six enums

**Files:**
- Create: `schema/validation-severity/{index,model}.ts`, `schema/validation-threshold/{index,model}.ts`, `schema/cover-fit/{index,model}.ts`, `schema/suggestion-type/{index,model}.ts`, `schema/lineage-type/{index,model}.ts`
- Modify: `validation-message/model.ts`, `validation/model.ts`, `device/model.ts`, `suggestion-group/model.ts`, `linked-document/model.ts`, `schema/index.ts`, `schema.generated.graphql`
- Test: one round-trip test per retyped field, in the owning model's existing test file

**Interfaces:**
- Consumes: `builder`, the stored-value domains (verified below)
- Produces: `validationSeverity`, `validationThreshold`, `coverFit`, `suggestionType`, `lineageType` enum refs, each exported as `model` from its directory

**Verified domains (do not re-derive; these were pinned against source):**

| Enum | Members → stored values |
|---|---|
| `ValidationSeverity` | `FATAL ERROR WARNING INFO USAGE` → same (epubcheck-ts `Severity`) |
| `ValidationThreshold` | `NONE FATAL ERROR WARNING INFO USAGE` → same |
| `CoverFit` | `CONTAIN→'contain' COVER→'cover' FILL→'fill' SMART→'smart'` |
| `SuggestionType` | `AUTHOR→'author' SERIES→'series' BOOK→'book' SUBJECT→'subject'` |
| `LineageType` | `EDIT→'edit' MERGE→'merge'` (schema default `'edit'`; `linkDocument` writes `'merge'` at `book-store.ts:610`) |

- [ ] **Step 1: Write the failing round-trip tests**

One per field, in the owning model's existing test file. The pattern, shown for severity — replicate for the other four with their own fixtures:

```ts
it('serializes severity as the enum member name', async () => {
  // fixture already seeds a ValidationMessage with severity: 'ERROR'
  const result = await harness.execute(
    `{ viewer { library { book(id: "${BOOK_ID}") { validation { messages { edges { node { severity } } } } } } } }`,
    { viewer: harness.aliceViewer }
  );
  expect(result.errors).toBeUndefined();
  // stored 'ERROR' → wire 'ERROR' (names coincide for severity)
  expect(/* first message */.severity).toBe('ERROR');
});
```

**Note on this example:** it is written against Task 4's connection shape. If Task 1 runs first (it does), write it against the current list shape (`messages { severity }`) — Task 4 updates it. For `CoverFit`, the discriminating case is a stored lowercase value serializing as uppercase: seed `coverFit: 'contain'`, assert the wire value is `'CONTAIN'`. That test FAILS before the enum lands (wire would be `'contain'`) — it is the RED for this task.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -w app/server -- graphql/schema
```

Expected: the `CoverFit`, `SuggestionType`, `LineageType` cases FAIL (lowercase on the wire today). The severity/threshold cases PASS today (values coincide) — their protection is the SDL diff plus codegen typing, not runtime change. State this honestly in the report rather than claiming seven RED tests.

- [ ] **Step 3: Implement the five enum directories**

The pattern (`validation-severity/model.ts`):

```ts
import { builder } from '../builder';

export const model = builder.enumType('ValidationSeverity', {
  values: {
    FATAL: { value: 'FATAL' },
    ERROR: { value: 'ERROR' },
    WARNING: { value: 'WARNING' },
    INFO: { value: 'INFO' },
    USAGE: { value: 'USAGE' },
  } as const,
});
```

`index.ts` per the convention (`export { model } from './model';`). Register all five in `schema/index.ts` alphabetically.

- [ ] **Step 4: Retype the five fields**

`t.exposeString('severity')` → `t.field({ type: validationSeverity, resolve: (m) => m.severity as ValidationSeverityValue })` — where the cast target is the enum's value union, **not** `any`. If the stored column type is `string`, narrow via the enum's own value list or a type predicate; a bare `as` to the union is acceptable here because the unknown-value policy is "fail loudly", and Pothos will throw at serialization for a value outside the enum — which is the specified behaviour.

Also delete `suggestion-group/model.ts`'s long comment arguing for string-over-enum — this task overturns that decision (its REST-parity reasoning protected a client phase 2 deletes). Replace with one line pointing at the spec.

- [ ] **Step 5: Regenerate the SDL and review the diff**

```bash
npm run graphql:schema -w app/server
git diff app/server/graphql/schema.generated.graphql
```

Expected diff: five new `enum` blocks; five field retypes (`severity: ValidationSeverity!` etc.); **nothing else**. Anything else in the diff is a defect.

- [ ] **Step 6: Full suite, lint, commit**

```bash
npm test -w app/server && npm run lint
git add -A && git commit -m "feat(graphql): type the six closed string sets as enums"
```

---

### Task 2: Typed `PendingFixState`

**Files:**
- Create: `schema/undo-kind/{index,model}.ts`, `schema/metadata-fix/{index,model}.ts`, `schema/undo-snapshot/{index,model}.ts`, `schema/pending-fix-state/{index,model}.ts`
- Modify: `app/server/graphql/derive.ts` (+`parsePendingFixState`), `derive.test.ts`, `builder.ts` (JSON scalar), `pending-fix/model.ts`, `schema/index.ts`, `schema.generated.graphql`

**Interfaces:**
- Consumes: `PendingFixState`, `MetadataFix`, `UndoSnapshot` from `app/server/types.ts` (the authoritative shapes)
- Produces: `parsePendingFixState(json: string): PendingFixState` (total: malformed → `{ autoFixes: [], appliedFixes: [], proposals: [], undo: null }`); the four object types; `JSON` scalar registered on the builder

- [ ] **Step 1: Failing table-driven tests for `parsePendingFixState`** in `derive.test.ts`, following its siblings: well-formed round-trip, `'{}'` (missing keys default to empty arrays/null — matching the store's `state.autoFixes ?? []` reads), malformed JSON, `'null'`, arrays with non-object entries dropped.
- [ ] **Step 2: RED.** `npm test -w app/server -- graphql/derive`
- [ ] **Step 3: Implement the parser** (total, `derive.ts` style) **and the JSON scalar**: `import { JSONResolver } from 'graphql-scalars'` + `builder.addScalarType('JSON', JSONResolver)` with `Scalars: { JSON: { Input: unknown; Output: unknown } }` added to the builder type params.
- [ ] **Step 4: Implement the four types.** `UndoKind` enum (`APPLY→'apply'`, `DISMISS→'dismiss'`). `MetadataFix`: all fields per `types.ts` — `field`/`kind`/`from` non-null strings, `to`/`reason` nullable, `fromChips`/`toChips` nullable string lists, `changes: JSON!`. `UndoSnapshot`: `kind: UndoKind!`, two `[MetadataFix!]!` lists. `PendingFixState`: three `[MetadataFix!]!` + `undo: UndoSnapshot`.
- [ ] **Step 5: Retype `PendingFix.state`** to `PendingFixState!` resolving via `parsePendingFixState(row.state)`. Update the existing `state`-content tests (they currently `JSON.parse` a string — they now select structured fields; assertions must still pin the same seeded values, and the report must show the old and new assertions side by side proving equivalence, not weakening).
- [ ] **Step 6: SDL diff review** (four new types + one scalar + one retype, nothing else), full suite, lint, commit: `feat(graphql): replace the state JSON string with a typed PendingFixState`.

---

### Task 3: Merge `PendingFixSummary` into `PendingFix`

**Files:**
- Modify: `derive.ts` (+`isLivePendingFix`), `derive.test.ts`, `pending-fix/model.ts` (gains `book: Book!` + the filter), `library/model.ts` (`pendingFixes` resolves rows via the predicate), `book/model.ts` (`pendingFix` applies the predicate), `schema/index.ts`, `schema.generated.graphql`
- Delete: `schema/pending-fix-summary/`
- Test: `pending-fix/model.test.ts` absorbs the summary tests; TTL discriminate-check

**Interfaces:**
- Produces: `isLivePendingFix(state: PendingFixState, updatedAt: number, now: number): boolean`

**The predicate, mirrored exactly from `book-store.ts:699-705` (TTL constant `7 * 24 * 60 * 60 * 1000` from `:31`):** live unless (no proposals AND no undo) OR (no proposals AND undo present AND `updatedAt < now - TTL`). Malformed state parses to the empty state, which the first clause classifies not-live — matching the store's delete-on-parse-failure.

- [ ] **Step 1: Failing predicate tests** — table-driven over the four quadrants plus the TTL boundary (exactly at TTL vs one ms past) plus malformed-state-is-not-live.
- [ ] **Step 2: RED**, then implement `isLivePendingFix`.
- [ ] **Step 3: Move `book: Book!` onto `PendingFix`** (from the summary type), resolving via the parent row's `userId`/`bookId` compound key as the summary did.
- [ ] **Step 4: Repoint `Library.pendingFixes`** to `[PendingFix!]!`: `findMany({ where: { userId: owner.userId } })` filtered by the predicate — **filter, never delete**. Add a comment stating the deliberate difference from `getPendingFixes` (REST deletes on read; GraphQL only filters; cleanup remains REST's job until phase 3 relocates it).
- [ ] **Step 5: Apply the predicate to `Book.pendingFix`** — the relation resolves, then the predicate gates it to null. This closes the previously-accepted drift; update the comment that documented it.
- [ ] **Step 6: Delete `pending-fix-summary/`**, migrate its tests (assertions preserved; the two-users-same-book-id case must survive), update `schema/index.ts`.
- [ ] **Step 7: Discriminate-checks.** (a) Remove the predicate from `pendingFixes` → the TTL test fails → restore. (b) Admin-traversal assertion on contents for `pendingFixes` (self-read cannot discriminate owner-derivation). Report both directions of both.
- [ ] **Step 8: SDL diff review** (`PendingFixSummary` gone; `PendingFix` gains `book`; `Library.pendingFixes` retyped — nothing else), full suite, lint, commit: `feat(graphql): merge PendingFixSummary into PendingFix behind a shared liveness predicate`.

---

### Task 4: Shape fixes and connections

**Files:**
- Modify: `library/model.ts` (`seriesNextIndex: Int!`), `progress/model.ts` (`progress` → `position` + description), `series/model.ts` (`books` → `relatedConnection`), `validation/model.ts` (`messages` → `relatedConnection`), affected tests, `schema.generated.graphql`, and the old spec's `Float!` line (`specs/2026-07-30-...-design.md:229`)

- [ ] **Step 1: Failing tests.** `seriesNextIndex` asserted as an integer via a fixture with fractional `seriesIndex` (2.5 → next is 3); `position` selected under its new name (old name must produce a validation error — assert that too); `Series.books` and `Validation.messages` queried as connections with the established shape: page 2 ≠ page 1, `edges[0].cursor` fed back as `after`, ordering preserved (`seriesIndex asc` / `seq asc`), **and `last`/`before` asserted to genuinely work** — `t.relatedConnection` supports them natively; native support wins. Document the asymmetry with `Library.entries` at both field sites.
- [ ] **Step 2: RED** (new names/shapes don't exist), then implement all four.
- [ ] **Step 3: The `messages` ordering protection carries over.** The read model protects `orderBy: { seq: 'asc' }` with a spy on query args (SQLite's PK index makes row order indistinguishable). Re-point that spy at the connection's query construction; confirm it still fails when `orderBy` is dropped.
- [ ] **Step 4: SDL diff review** (two retypes, one rename, two connection shapes + their edge/connection types — nothing else), full suite, lint. Correct `Float!` → `Int!` in the old spec's schema section in the same commit. Commit: `feat(graphql): fix scalar shapes and paginate the growable relations`.

---

### Task 5: Prisma-plugin adoption

**Files:**
- Modify: `viewer/model.ts` (`users` → `t.prismaField`), `device/model.ts` (`enabledUsers` → `t.prismaField`), tests
- No SDL change expected — this task is invisible to the schema, and `graphql:schema:check` proves it

- [ ] **Step 1: Convert `Viewer.users`** to `t.prismaField` (`[User]`), admin scope unchanged, `orderBy: { username: 'asc' }` preserved. `Viewer.devices` is **not** converted — its three-way auth branch stays hand-written; confirm its existing comment says why.
- [ ] **Step 2: Convert `Device.enabledUsers`** to `t.prismaField`, same where-clause (`deviceAccess: { some: { deviceId: parent.id } }`), admin scope and ordering unchanged.
- [ ] **Step 3: Discriminate-checks:** break each scope (admin → authenticated) → the FORBIDDEN tests fail → restore. Break the enablement where-clause → the two-device `[2, 0]` test fails → restore.
- [ ] **Step 4: `npm run lint`** must pass **without** regenerating the SDL — the check proving the schema is untouched is the point of this task's review. Full suite, commit: `refactor(graphql): resolve users and enabledUsers through the prisma plugin`.

---

### Task 6: The lineage index

**Files:**
- Modify: `prisma/schema.prisma` (`BookIdHistory` gains `@@index([userId, currentId])`)
- Create: `prisma/migrations/<timestamp>_book_id_history_current_id_index/migration.sql`

- [ ] **Step 1: Add the index** to the model and generate the migration (`npx prisma migrate dev --name book_id_history_current_id_index` — check how this repo actually generates migrations first: `db/migrate.ts` applies raw SQL files, so match the existing migration-file format in `prisma/migrations/` rather than assuming the CLI flow works against the adapter setup).
- [ ] **Step 2: Prove semantics unchanged:** the existing `Book.lineage` tests pass untouched. Prove the index is used: `EXPLAIN QUERY PLAN SELECT ... WHERE user_id = ? AND current_id = ?` via a throwaway script shows the new index (report the plan output, then delete the script).
- [ ] **Step 3: Full suite** (migrations run in every harness, so a malformed migration fails loudly), lint, commit: `feat(db): index book_id_history lineage reads`.

---

### Task 7: Documentation sync

- [ ] Update the cleanup spec's status to implemented; update the read-model spec's schema section for every changed shape (enums, `PendingFixState`, merged `PendingFix`, `position`, connections, `Int!`); verify no doc still references `PendingFixSummary` or `Progress.progress` (`grep -rn "PendingFixSummary\|progress: String" docs/ app/server/graphql/`). Commit: `docs: sync specs with the cleaned schema`.

---

## Definition of done

- SDL contains no stringly-typed closed set and no JSON-in-a-string except `MetadataFix.changes`; one `PendingFix` type; `Series.books` and `Validation.messages` are connections with working backward pagination.
- Every REST test passes untouched; every REST payload byte-identical.
- Full suite green; every schema change visible in a reviewed SDL diff; Task 5 proven SDL-invisible.
- Both specs' schema sections match the artifact.
