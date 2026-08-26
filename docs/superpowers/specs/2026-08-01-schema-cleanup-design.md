# Schema cleanup before the client migration — design

**Date:** 2026-08-01
**Branch:** `graphql-migration`
**Status:** implemented

## Context

The GraphQL read model is complete (spec `2026-07-30-graphql-server-design.md`, delivery
step 3, merged as `28deb010..a6f35a68`). Phase 2 — the Houdini client — codegens against
`schema.generated.graphql` and freezes the SDL's shapes into fragments across ~45 migrated
hooks. Every schema imperfection that survives to that point stops being a one-line server
fix and becomes a coordinated breaking change.

This spec is the last pass over the schema while it is still cheap to change. It covers
three groups: schema-only shape fixes, Prisma-plugin leverage, and one database index.
It deliberately does **not** touch mutations (delivery step 4) or the scan subscription
(step 5).

## Scope

### In

1. Enums for six stringly-typed closed sets
2. A typed `PendingFixState` replacing the JSON-string `state` fields
3. Merging `PendingFixSummary` into `PendingFix`
4. Two small field-shape fixes (`seriesNextIndex` type, `Progress.progress` naming)
5. Connections where unbounded lists can grow (`Series.books`, `Validation.messages`)
6. Prisma-plugin adoption for three hand-written resolvers
7. One database index for lineage reads

### Out

- Mutations, subscriptions, and everything else in delivery steps 4–5.
- Any REST change. REST parity of *values* is preserved everywhere (see "Wire values"
  below); REST remains untouched and its tests stay green.
- Any client change.
- Normalizing `Book.subjects` / `identifiers` / the denormalized `series` string column
  into relational tables. Considered and rejected: OPDS and the import pipeline own those
  columns, `derive.ts` already bridges them, and GraphQL already presents clean shapes.
  A join-table migration would rewrite the import pipeline for zero schema-visible gain.
- Database-level enums. SQLite has none and Prisma-on-SQLite does not support `enum`;
  the enum lives at the GraphQL layer, validated at the boundary.

## Why now and not later

The SDL is consumed by codegen in phase 2. After that:

- renaming or retyping a field means regenerating fragments across every consumer;
- string→enum is a *wire-format* change (`'ERROR'` stays `'ERROR'`, but codegen types
  change from `string` to a union, breaking every comparison written against `string`);
- splitting `state: String` into structured fields orphans every `JSON.parse` call site.

Before phase 2, each of these is one server commit and a regenerated artifact.

## Decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | Closed string sets | GraphQL enums with `value:` mapping preserving stored casing | Codegen gives the client a union type; the database and stores are untouched |
| 2 | `state` JSON strings | Typed `PendingFixState` object graph; one `JSON` scalar leaf for `MetadataFix.changes` | The fix-review UI is the app's most intricate screen; it deserves typed data |
| 3 | `PendingFixSummary` | Merged into `PendingFix`; the summary type is deleted | The split encoded a store-DTO accident, not a domain truth |
| 4 | `seriesNextIndex` | `Int!` | It is a next ordinal; the store already does `Math.floor(max) + 1` |
| 5 | `Progress.progress` | Renamed `position`, description added | `progress { progress }` is what every client author would otherwise write |
| 6 | Unbounded relations | `Series.books` and `Validation.messages` become connections | Validation output can run to hundreds of messages; breaking once fragments exist |
| 7 | Hand-written list resolvers | `Viewer.devices`, `Viewer.users`, `Device.enabledUsers` move onto the Prisma plugin where their auth branching allows | Selection-driven `select` is why the plugin is in the stack |
| 8 | Lineage read path | `@@index([userId, currentId])` on `book_id_history` | The only read-model query with no index behind it |

## Design

### 1. Enums

Six new enums. All use Pothos `enumType` with explicit `value:` mapping so the **stored
and wire values do not change** — only the GraphQL type does. (Lesson recorded in the
read-model ledger: output enums serialize the member *name*, so the member names ARE the
new wire values; the `value:` side maps them to what the database stores.)

| Enum | Members (wire) | Stored values (via `value:`) | Source of truth |
|---|---|---|---|
| `ValidationSeverity` | `FATAL ERROR WARNING INFO USAGE` | same | `Severity` in `@korzun/epubcheck-ts` |
| `ValidationThreshold` | `NONE FATAL ERROR WARNING INFO USAGE` | same | `ValidationThreshold` in `@korzun/epubcheck-ts` |
| `CoverFit` | `CONTAIN COVER FILL SMART` | `contain cover fill smart` | `Device.coverFit` in `types.ts` |
| `SuggestionType` | `AUTHOR SERIES BOOK SUBJECT` | `author series book subject` | `SearchSuggestionsResponse` in `types.ts` |
| `LineageType` | `EDIT MERGE` | `edit merge` | `book_id_history.type`: default `'edit'`, `linkDocument` writes `'merge'` |
| *(existing)* `LibraryEntryStatus`, `LibraryEntryType` | — | — | already enums; unchanged |

Fields retyped: `ValidationMessage.severity`, `Validation.threshold`, `Device.coverFit`,
`SuggestionGroup.type`, `LinkedDocument.type`.

**Casing rule.** For severity/threshold the stored values are already SCREAMING_CASE, so
member name and stored value coincide. For the other three, member names are SCREAMING_CASE
per GraphQL convention and `value:` maps to the stored lowercase. The database never sees
the member names.

**Unknown-value policy.** These columns are written only by our own stores, so unknown
values indicate corruption, not evolution. A row carrying a value outside the enum fails
that field's resolution (GraphQL error on the field, null propagation per schema rules)
rather than being silently coerced. No defensive fallback members.

### 2. Typed `PendingFixState`

`PendingFix.state: String!` (a `JSON.stringify` of `PendingFixState`) becomes:

```graphql
type PendingFix {
  book: Book!
  fileName: String!
  fileSize: Int!
  createdAt: DateTime!
  updatedAt: DateTime!
  state: PendingFixState!
}

type PendingFixState {
  autoFixes: [MetadataFix!]!
  appliedFixes: [MetadataFix!]!
  proposals: [MetadataFix!]!
  undo: UndoSnapshot
}

type MetadataFix {
  field: String!
  kind: String!
  from: String!
  to: String
  reason: String
  fromChips: [String!]
  toChips: [String!]
  changes: JSON!
}

type UndoSnapshot {
  kind: UndoKind!            # APPLY | DISMISS (values 'apply' | 'dismiss')
  proposals: [MetadataFix!]!
  appliedFixes: [MetadataFix!]!
}

scalar JSON
```

Notes:

- `MetadataFix.changes` is `Record<string, string | string[]>` — heterogeneous by design
  (per-field patch payloads). It stays a `JSON` scalar leaf (from `graphql-scalars`,
  already a dependency) rather than forcing a union that would fight codegen. Everything
  around it is typed.
- `MetadataFix.field` and `.kind` stay strings deliberately: their vocabularies live in
  `utils/metadata-issues.ts` and grow with the fixer. An enum here would turn adding a fix
  kind into a schema change. Revisit if they stabilize.
- Parsing happens in `derive.ts` (`parsePendingFixState`), total like every other parser
  there: malformed JSON degrades to an empty state, never a thrown error. The same parser
  serves both resolvers, so the GraphQL reading cannot drift from itself.
- REST is untouched: it continues to serve the DTO shape it serves today.

### 3. One `PendingFix` type

`PendingFixSummary` is deleted. `Library.pendingFixes: [PendingFix!]!` resolves Prisma
rows directly instead of consuming `getPendingFixes`'s DTO, applying the same
resolved/TTL-expired filter as a **shared pure predicate** (`isLivePendingFix(state,
updatedAt, now)` in `derive.ts`) extracted from the store's logic.

The predicate mirrors the store's keep/drop decision exactly: a fix is live unless
(no proposals and no undo) or (no proposals, undo present, `updatedAt` older than the
7-day TTL). **A row whose `state` fails to parse is not-live** — the store deletes such
rows on read; the GraphQL filter simply excludes them, which `parsePendingFixState`'s
total, never-throwing behaviour makes automatic.

Consequences, called out honestly:

- **The read-side deletion moves.** `getPendingFixes` deletes expired rows as a side
  effect of reading. The GraphQL list resolver will *filter* by the shared predicate but
  **not delete** — REST keeps its delete-on-read behaviour, and rows REST hasn't touched
  are merely invisible to GraphQL rather than removed by it. A read resolver that mutates
  was the thing we declined to replicate in the read model; this spec keeps that stance.
  Net effect: the previously-accepted drift between `Book.pendingFix` (unfiltered) and
  the list readings (filtered) is **resolved** — both GraphQL paths now apply the same
  predicate — while cleanup remains REST's job until phase 3 moves it somewhere explicit.
- `Book.pendingFix` gains the same predicate, so a TTL-expired fix disappears from both
  GraphQL readings simultaneously.
- The `PendingFixSummary`-specific test coverage moves to the merged type; Houdini keys
  `PendingFix` under its parent `Book` (no `Node`, unchanged).

### 4. Small shape fixes

- `Library.seriesNextIndex: Float!` → `Int!`. The store returns `Math.floor(max) + 1`;
  the design spec's original `Float!` annotation is corrected in the same commit.
- `Progress.progress: String!` → **renamed** `position: String!`, description:
  `"Reader position as a KOReader CFI/xpointer string."` The old name survives nowhere —
  phase 2 has not started, so there is no deprecation window to honour. The REST payload
  is untouched.

### 5. Connections for growable lists

- `Series.books` → `t.relatedConnection` (relay, cursor on the Prisma relation, keeps
  `orderBy: { seriesIndex: 'asc' }`). The plain list field is **removed**, not kept
  alongside — two ways to read the same relation is fragment ambiguity phase 2 doesn't need.
- `Validation.messages` → `t.relatedConnection`, `orderBy: { seq: 'asc' }` preserved.
  Validation output for a broken EPUB is the one list in the schema with realistic
  hundreds-of-rows growth.
- `Library.series` **stays a plain list**: it is bounded by the user's shelf count, the
  library UI renders it whole, and `Library.entries` already serves the paginated case.
  Deliberate asymmetry, documented in the model.
- Existing spec text describing `Series.books: [Book!]!` is updated.

### 6. Prisma-plugin adoption

*(Corrected after implementation, 2026-08-01: this section originally described
`Viewer.users`, `Device.enabledUsers` and `Viewer.devices` as hand-written `findMany`
resolvers that needed converting onto the plugin. That premise was stale — all three had
already been `t.prismaField` since the inline-fields refactor
(`7ca7f0b2`, "declare Viewer, User and Device fields in their own models"), several commits
before this plan was drafted. Task 5 confirmed this against git history and made no code
change; see `task-5-6-report.md`. The paragraphs below describe the state as it actually is,
not a conversion that took place under this plan.)*

`Viewer.users`, `Device.enabledUsers` and `Viewer.devices` all resolve through the Prisma
plugin so selection drives `select`:

- `Viewer.users` — `t.prismaField` returning `[User]` (admin scope unchanged).
- `Device.enabledUsers` — `t.prismaField` with the
  `deviceAccess: { some: { deviceId } }` where-clause and admin scope. (A `t.relation`
  on the `DeviceUser` join is not the shape — the field returns `User`s, not join rows —
  and a connection is unwarranted: enablement lists are small by nature.)
- `Viewer.devices` is also `t.prismaField`, but its three-way auth branching
  (admin → all; `userId === null` → `[]`; else enablement-filtered) lives inside the
  resolver body — each branch spreads the plugin's `query` — rather than a single plain
  `findMany`, since the branching does not fit a selection-driven query without contortion.
  Documented as deliberate.

The tenant-scoping and admin-traversal test shapes established in the read-model ledger
apply to every one of these resolvers: break the scoping, watch the named test fail,
restore. Task 5 performed exactly this discriminate-check, both directions, on all four
assertions (two scopes, one where-clause, one lint baseline) without leaving any file
modified.

### 7. Database change

One migration:

```prisma
model BookIdHistory {
  // ...unchanged...
  @@index([userId, currentId])
}
```

`getBookLineage` raw-SQLs `WHERE user_id = ? AND current_id = ?`; the PK is
`(userId, oldId)`, so today that read scans. Two-line migration, no data change, no
REST impact. This is the only read-model query without an index behind it — verified
against every other `where` shape in the schema layer.

## Wire values and REST parity

Nothing in this spec changes a value REST serves or stores. Enums map to existing stored
strings; `PendingFixState`'s fields carry the same data the DTO carried; renames and
retypes are GraphQL-surface only. The invariant "the GraphQL and REST readings of the
same data must not drift" is preserved — and in the `pendingFixes` case, strengthened.

## Testing

- **SDL discipline inverts for this spec:** unlike the two structural refactors, the SDL
  is *supposed* to change. Every task regenerates the artifact and the review gate is a
  human-readable SDL diff showing exactly the intended shape change and nothing else.
- Every enum gets a round-trip test: stored value → GraphQL member name on output.
- `parsePendingFixState` gets table-driven totality tests like its `derive.ts` siblings.
- The merged `pendingFixes` path gets the discriminate-check ritual: drop the shared
  predicate, watch the TTL test fail, restore.
- Connections get the established shape: page 2 differs from page 1, `edges[0].cursor`
  fed back as `after`. **Backward pagination:** `t.relatedConnection` supports `last`/
  `before` natively (cursor-based on the Prisma relation), unlike the hand-rolled
  `Library.entries`. Native support wins — the tests assert `last`/`before` genuinely
  work rather than rejecting them. This creates a deliberate asymmetry with
  `Library.entries`' `BACKWARD_PAGINATION_UNSUPPORTED` error, documented at both sites:
  entries wraps a forward-only store cursor; these wrap Prisma relations.
- The migration gets a test proving `getBookLineage` still returns identical results
  (index changes must not change semantics, only plans).

## Sequencing

Single plan, ordered so the SDL-breaking changes land first and the additive ones last:

1. Enums (six types, five field retypes)
2. `PendingFixState` + the `PendingFix` merge
3. Shape fixes (`Int!`, `position`)
4. Connections (`Series.books`, `Validation.messages`)
5. Plugin adoption (`Viewer.users`, `Device.enabledUsers`)
6. The `book_id_history` index

Steps 1–4 change the SDL and are the reason this spec exists; 5 is invisible to the
schema; 6 is invisible to everything but `EXPLAIN QUERY PLAN`.

## Definition of done

- The SDL contains no stringly-typed closed set, no JSON-in-a-string field except the
  documented `MetadataFix.changes` leaf, and one `PendingFix` type.
- Every existing REST test passes untouched.
- The design spec's schema section matches the new SDL (updated in the same plan).
- Full suite green; `graphql:schema:check` enforced as always.

## Outcome

Tasks 1–7 landed on `graphql-migration`. Every schema change described above is live in
`app/server/graphql/schema.generated.graphql`; the full suite is green at 1325/1325. Two
findings surfaced during delivery that this plan did not anticipate:

- **Task 5 was a no-op.** §6 above (Prisma-plugin adoption) is corrected in place rather
  than left standing: `Viewer.users`, `Device.enabledUsers` and `Viewer.devices` were
  already `t.prismaField` before this plan was written — since the inline-fields refactor
  (`7ca7f0b2`), several commits earlier. Task 5's dispatch verified this against git
  history, ran all four planned discriminate-checks (both directions) against the
  already-correct code, and restored the tree byte-identical each time. No commit exists
  for Task 5 — there was nothing to change. See `task-5-6-report.md` for the full
  git-history evidence.
- **Task 6 needed a second index-creation site.** The `book_id_history` lineage index
  (`@@index([userId, currentId])`, decision #8) could not be delivered as a single DDL
  migration file. `book_id_history`'s live shape on a fresh database is not owned by
  `prisma/migrations/` alone: the `data_v11_per_user_libraries` **data migration** in
  `db/migrate.ts` unconditionally `CREATE TABLE ... AS`-rebuilds and `DROP`+`RENAME`s
  `book_id_history` to give it its composite `(userId, oldId)` primary key, and this data
  migration runs on **every** brand-new database, including every test-harness database —
  there is no "already at the target shape" guard, only a "have I run before" guard. A
  plain `CREATE INDEX` migration file lands *before* that rebuild (DDL migrations always
  apply before data migrations) and is silently destroyed when the pre-rebuild table is
  dropped a few statements later. Proven empirically with `EXPLAIN QUERY PLAN`: with only
  the DDL migration in place, a fresh database fell back to a partial scan of the primary
  key's autoindex — the index was simply gone. The fix is two-part and both parts are
  committed: the DDL migration (`prisma/migrations/20260801000000_book_id_history_current_id_index/`)
  for already-migrated production databases, **and** a second `CREATE INDEX IF NOT EXISTS`
  added directly inside `data_v11_per_user_libraries`'s rebuild in `db/migrate.ts`,
  immediately after its `DROP`/`RENAME`, for every fresh database. Recorded here as a
  hazard: any future index (or other DDL change) on a table that a data migration rebuilds
  from scratch needs the same two-part treatment, not a migration file alone. See
  `task-5-6-report.md` for the `EXPLAIN QUERY PLAN` evidence proving the hazard was real,
  not hypothetical, and for the fix confirmed working both ways.

---

# Final outcome — phase-2 inputs

Plan complete: `a6f35a68..e586042a` (9 commits incl. the fix wave), 1326 tests, lint clean.
Final review verdict: ready for phase 2. Items below are decisions phase 2 should make
deliberately rather than discover.

## Houdini configuration inputs

*(Consolidated 2026-08-02 by the mutations plan's doc-sync task: the `JSON`-scalar and
`PendingFix`-cache-key items below were duplicated across two specs as delivery step 4
(mutations) made its own, larger Houdini handoff. The single consolidated version — now
covering `DateTime` too, and every other mutation-phase Houdini input — lives in
`2026-07-30-graphql-server-design.md`'s "Phase 4 outcome" → "## Phase 2 (Apollo Client)
inputs" (that section was titled "Phase 2 (Houdini) inputs" until 2026-08-02, when the
client target changed to Apollo).
Both bullets below are restated in brief, unresolved exactly as this spec left them, with that
section as the canonical copy going forward — edit there, not here, if either decision changes.)*

- **`JSON` scalar needs a `scalars` entry in `houdini.config.js`** alongside `DateTime`, or
  `MetadataFix.changes` types as `any` client-side.
- **`PendingFix` has no scalar key field — STILL OPEN.** The merge dropped `bookId` and added
  `book: Book!`, so Houdini caches it *embedded* under both `Book.pendingFix` and
  `Library.pendingFixes` as independent copies — mutating a fix must invalidate both. If
  normalized caching is preferred, re-adding `bookId: String!` is purely additive. **Decide
  before fragments freeze.** Not resolved by the mutations plan either — carried forward
  unchanged, see the consolidated section above.
- Non-`id` keys already known from the read-model handoff: `Progress` keys on `document`.

## Schema facts phase 2 can rely on

- No stringly-typed closed set remains; the only JSON-in-a-string is `MetadataFix.changes`
  (documented exception). All enum `values:` maps carry `satisfies` exhaustiveness guards
  against their source-of-truth types — an epubcheck-ts severity addition is a compile error,
  not a runtime data outage.
- `Series.books` and `Validation.messages` are connections with **working** `last`/`before`.
  `Library.entries` and `Library.progress` are **forward-only** and now say so in their SDL
  descriptions (rejection code `BACKWARD_PAGINATION_UNSUPPORTED`).
- `Progress.position` (not `progress`); `Library.seriesNextIndex: Int!`.
- The lineage-read index exists on every database population (DDL migration + v11-rebuild
  recreation), guarded by a permanent `PRAGMA index_list` regression test.

## Known-and-accepted

- `Library.pendingFixes` is the one plain list whose bound is not shelf-sized (books with
  pending fixes — a pathological bulk import could make it large). REST has the same shape.
- `MetadataFix.kind`/`field` are stringly discriminators the existing client already branches
  on (`use-upload-queue.ts`); typed as `string` in `types.ts`, deliberately not enums. Revisit
  if the phase-2 fix UI switches on them.
- `Validation` has no `messageCount` sibling to `Series.bookCount`; additive when the UI wants
  a badge.
- `Book.seriesIndex: Float!` vs `seriesNextIndex: Int!` is deliberate (fractional entries like
  2.5 exist; "next" floors).
- GraphQL pending-fix readings *filter* by TTL; REST still *deletes* on read. Cleanup
  relocation is phase-3 work.

## Migration hazard, recorded for the next index author

`db/migrate.ts`'s `data_v11_per_user_libraries` DROPs and rebuilds `book_id_history` after the
DDL pass on every fresh database. Any index on that table must be created in BOTH the DDL
migration (for already-migrated installs) and inside the v11 rebuild (for fresh ones). The
same applies to any table a data migration rebuilds — check before writing a DDL-only index.
