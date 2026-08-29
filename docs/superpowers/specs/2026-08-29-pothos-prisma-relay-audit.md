# Pothos / Prisma / Relay — Phase 1 audit and Phase 2+ plan

Baseline: `cd1f569b`, branch `use-prisma-better`. Non-test files unless stated.
**Deliverable is this inventory. No production code has been changed.**

## Scope

The original brief scoped to `app/server/graphql/` and four deviation
categories (A–D). Two further categories were added at review request and are
first-class here, not appendices:

- **E — raw SQL** (`$queryRaw`/`$executeRaw`), which lives in `services/`.
- **F — Prisma-schema and file-structure changes**, which is where six of
  Category C's seven "keeps" actually bottom out.

E and F reach outside `app/server/graphql/`. That is deliberate and agreed, and
it is called out again at each slice in the plan.

Unchanged from the brief: the raw `Prisma.sql` in
`services/search-suggestions.ts` is recorded but not converted; no plugins are
added; auth scopes and `routes/ui.ts` are untouched.

## Verification baseline

Dependencies were absent from this worktree; `npm ci` was run. At `cd1f569b`:

| Command | Result |
|---|---|
| `npm run lint` (oxlint + oxfmt + `tsc` ×2 + `graphql:schema:check`) | **exit 0** |
| `npm test` | **exit 0** — 125 files, 1769 tests |
| `npm run test:cost -w app/server` | **exit 0** — 33 tests |

Every Category F claim was verified by patching `schema.prisma`, running
`prisma validate` + `prisma generate`, and probing against a real harness
database. The tree was restored after each probe (`git status` clean); see
§"How Category F was verified".

## Correction to the brief's counts

The greps behind the brief's figures counted comment prose and already-correct
code. Re-counted mechanically (excluding `*.test.ts` and comment lines; Prisma
calls further classified by whether `...query` appears in the call expression):

| Brief said | Actually |
|---|---|
| 57 `t.prismaField` | 40 call sites |
| 9 `t.relatedConnection` | 2 — `Series.books`, `Validation.messages` |
| 5 `t.relationCount` | 1 — `User.progressCount` |
| 3 `t.relation(` | 3 — `Book.series`, `Book.validation`, `PendingFix.book` |
| 3 `builder.prismaNode` | 3 — `Book`, `Series`, `User` |
| 7 `builder.prismaObject` | 5 — `Progress`, `Validation`, `ValidationMessage`, `Device`, `PendingFix` |
| 20 manual `prisma.*` in `schema/` | 47 sites — **40 already merge `...query`**, 7 do not |
| 16 `encodeGlobalID` / 6 `decodeGlobalID` | 6 + 1 in non-test code |

The corrected numbers change the task's shape: the schema is already
substantially on the plugins, and the genuine deviations are few.

## Summary

| Cat | Subject | Sites | Convert | Keep |
|---|---|---|---|---|
| A | `t.prismaConnection` (zero uses) | 2 | **1** *(`Library.progress`, after the `e7f99557` ruling below)* | 1 |
| B | Manual Prisma calls in `schema/` | 47 | 4 | 43 |
| C | Request-scoped loaders | 7 | **1 removed, 1 rewritten** *(see the A ruling)* | 6 |
| D | Hand `encode`/`decodeGlobalID` | 7 | 0–6 optional | 1 hard |
| E | Raw SQL in `services/` | 21 | 9 + 1 careful | 11 |
| F | Schema / file structure | 5 proposals | 3 recommended | 2 deferred |

---

# A. `t.prismaConnection` — one use now, and `Library.entries` stays at zero

> **RULING RECORDED, and acted on.** This section originally concluded "keep
> both". The `Library.entries` half still holds and is structural. The
> `Library.progress` half rested on a DECISION — `e7f99557`'s removal of
> `last`/`before` — not on a constraint, and that decision was put back to the
> repo owner and **reversed**: `Library.progress` is a `t.prismaConnection`,
> its SDL offers all four Relay args and honours them, and the two loaders that
> existed only because it was hand-built are gone (one deleted, one narrowed to
> its other consumers). Measured on a page of 8 selecting `book { title }` and
> `currentChapter`: **3 queries -> 1**. See the F-1 note for what that reversal
> settled and what it did not.

| file:line | hand-rolled | plugin feature | call |
|---|---|---|---|
| `schema/library/model.ts:90`, `:257` | `Library.entries`: `builder.connectionObject` + hand `{edges,pageInfo}` over `services/library-page.ts`'s keyset; per-edge cursors from `library/entries-cursor.ts` | `t.prismaConnection` | **KEEP** |
| `schema/library/model.ts:95`, `:461` | `Library.progress`: same shape over `getUserProgressPage` + `utils/progress-pagination.ts` | `t.prismaConnection` | **KEEP shape, CONVERT body** (B-4) |

## `Library.entries` — two independent blockers

1. **SDL (invariant 2).** `t.prismaConnection` delegates straight to the relay
   plugin's `t.connection` (`@pothos/plugin-prisma/lib/field-builder.js:56` →
   `this.connection({...})`), which injects all four of
   `first`/`after`/`last`/`before` unconditionally. The SDL deliberately omits
   `last`/`before` (breaking change `e7f99557`).
2. **Structural, independently fatal.** `t.prismaConnection` binds to a *single*
   model — `type:` is one prismaObject, `cursor:` must name a unique field or
   `@@unique`/`@@id` index on it. This field's node type is the union
   `LibraryEntry = Book | Series` (`schema/library-entry/model.ts:49`), and the
   page is an **interleaved keyset across two tables**
   (`services/library-page.ts:159`, one shared `{k,t,id}` cursor driving both
   `seriesWhere` and `bookWhere`). There is no single model to root it on.

A third hazard closes the lesser fix: the union's `resolveType` discriminates on
`'sortKey' in row` (`library-entry/model.ts:47`), so pruning `sortKey` would
misclassify a `Series` as a `Book`. Handing this field's node selection to
`queryFromInfo` is therefore unsafe — unlike `Library.progress`. The existing
comment at `library/model.ts:249` says exactly this and is correct.

## `Library.progress` — SDL blocker only, and the SDL ruling went the other way

Blocker 1 applied; blocker 2 never did (single concrete node type `Progress`).

**CONVERTED.** Blocker 1 was `e7f99557`, a deliberate SDL decision, so it was
taken back to the repo owner as a decision rather than treated as settled. The
ruling was to convert and accept `last`/`before` returning to the SDL. What that
bought, all measured on a page of 8:

| | Queries | Loaders it needs |
|---|---|---|
| Hand-declared `connectionObject` | 3 | `book-by-document` + `chapter-spine-map` |
| `t.prismaConnection` | **1** | none |

SDL diff, in full — the connection and edge type names are unchanged, because
they are passed explicitly to reproduce what `t.connection` derived:

```diff
-  progress(after: String, first: Int): LibraryProgressConnection!
+  progress(after: String, before: String, first: Int, last: Int): LibraryProgressConnection!
```

`e7f99557`'s actual grievance is not reintroduced. That commit objected to an
SDL that ADVERTISED backward pagination while the resolver threw
`BACKWARD_PAGINATION_UNSUPPORTED`. The plugin genuinely paginates backward, so
the schema again promises only what it delivers.

Three behaviours changed with it, each tested (`schema/library/progress.test.ts`):

1. **Cursor format.** base64 `{timestamp, document}` -> the plugin's compound-PK
   cursor. Opaque by contract; a client mid-pagination across the deploy gets an
   `Invalid cursor` error rather than wrong rows.
2. **A deleted cursor row ends pagination early.** Prisma's `cursor` + `skip: 1`
   needs the row to exist; measured, it returns an EMPTY page with
   `hasNextPage: false` rather than erroring. The old keyset compared values
   carried in the cursor and did not care. This is the one thing the conversion
   made worse.
3. **A malformed cursor now errors** instead of silently restarting from page
   one (`decodeProgressCursor` returned `null`, which the resolver read as "no
   cursor").

`hasPreviousPage` did NOT change on the forward path: the plugin computes
`args.after ? true : …` (`util/cursors.js`'s `wrapConnectionResult`), which is
exactly the "resumed from a cursor" meaning the hand-built resolver gave it.

Reject-not-clamp survives, on both arguments: `rejectOversizePage` runs in the
`resolve`, which `resolvePrismaCursorConnection` always calls — `t
.prismaConnection` has no `query` option, unlike `t.relatedConnection`. 100/50
unchanged.

**Net:** `t.prismaConnection` stays at zero. Every connection is either already
`t.relatedConnection` or forbidden from being one by invariant 2. Introducing it
elsewhere means converting a plain list to a connection — an SDL change, already
ruled out by the cleanup spec §5.

---

# B. Manual Prisma calls inside `schema/`

**40 of 47 already spread `...query`** inside a `t.prismaField` — that *is* the
plugin idiom. Verified across `linked-document/model.ts:82,91`,
`suggestion/model.ts:39`, `user/query/get.ts:18`,
`viewer/model.ts:41,76,139,142`, `scan-result/model.ts:43`,
`library/model.ts:219,226,392,404,547`, and every `book/mutation/*` and
`device/mutation/*` payload resolver. **No action.**

The 7 that bypass the plugin:

| # | file:line | by hand | plugin feature | call |
|---|---|---|---|---|
| B-1 | `schema/library/model.ts:130` | `Library.user`: `t.field` + `findUniqueOrThrow`, no `query` | `t.prismaField` | **CONVERT** |
| B-2 | `schema/progress/mutation/delete.ts:88` | `ProgressDeletePayload.user`: same | `t.prismaField` | **CONVERT** |
| B-3 | `schema/progress/mutation/set.ts:141` | `ProgressSetPayload.user`: same | `t.prismaField` | **CONVERT** |
| B-4 | `schema/library/model.ts:487` | second `progress.findMany` re-reading rows `getUserProgressPage` already fetched | — (a DTO gap) | **CONVERT** |
| B-5 | `schema/book/mutation/resolve-pending-fix.ts:506` | pre-write `pendingFix.findUnique` in a mutation body | none | **KEEP** |
| B-6 | `schema/device/mutation/disable-user.ts:96` | pre-write `device.findUnique` | none | **KEEP** |
| B-7 | `schema/device/mutation/enable-user.ts:118` | pre-write `device.findUnique` | none | **KEEP** |

## B-1/B-2/B-3 — DONE, shipped as `864c07cb` (slice 2)

> Measured, `user { username progressCount }`: `Library.user` and
> `ProgressSetPayload.user` each went **2 `user.findUniqueOrThrow` → 1**.
> SDL unchanged, cost budgets unmoved, suite green (1774 tests, +3).
> Two cost-pinning guards added — the pre-existing I-2 tests assert the number,
> which a revert to `t.field` would still satisfy while paying the extra query.


All three return the `User` prismaNode from a plain `t.field`, so no `query` is
merged. `User.progressCount` is `t.relationCount('progresses')`
(`user/model.ts:52`), whose `_count` select therefore cannot join the parent
query — selecting it costs a **second** round trip per `User`.

This bites hardest at B-3: `set.ts:133`'s own comment states the point of
re-reading the row is that `progressCount` must reflect the write that just
happened — and the current shape pays two queries for it.

SDL unchanged; risk minimal (the same `...query` spread made at 40 other sites);
cost budgets unaffected.

## B-4 — `Library.progress`'s double read

> **B-4a DONE, shipped as `fd2d9770` (slice 3).** `getUserProgressPage` now
> returns real Prisma rows; the resolver's second `findMany` is gone.
> Measured **2 `progress.findMany` → 1** per page. SDL unchanged, cost budgets
> unmoved, suite green (1775 tests, +1). Guards added on both sides.
> **B-4b (`queryFromInfo`) DROPPED, measured (slice 6).** It buys exactly
> nothing. Probed on `ProgressSetPayload.progress`, which IS a `t.prismaField`
> and so fully Pothos-planned: selecting a single scalar produced a merged
> `query` of **`{}`** — no `select`, no `include`. `@pothos/plugin-prisma` runs
> in include-mode, adding a `select` only for RELATIONS, never pruning scalar
> columns. `Progress` exposes no relations (`book` goes through a loader), so
> `queryFromInfo` on `Library.progress` would compute an empty object.
> It would also be actively unsafe if it ever did prune: `Progress.id` and
> `currentChapter` read `userId`/`document`/`progress` inside custom resolvers
> that declare no `select`, exactly the hazard `BOOK_SELECT`'s doc comment
> guards against.


`getUserProgressPage` (`services/progress.ts:87`) reads real `Progress` rows,
maps them to the app DTO (`device_id`, no `userId`, `:110`), and the resolver
re-queries the same rows by `document IN (...)` to get a shape `Progress`'s
resolvers accept (`currentChapter` reads `parent.userId`). Two queries per page.
`library/model.ts:444` documents the gap honestly.

Same defect `listBooksPage` had before task 8; same fix — return rows, not a DTO.
`getUserProgressPage`'s only production caller is this resolver
(`library/model.ts:482`); both REST endpoints that used it are gone. The DTO
mapping has no remaining consumer and can be deleted.

Smaller second win: with a single concrete node type, `queryFromInfo` — the very
helper `t.prismaConnection` uses internally (`paths: [['nodes'],['edges','node']]`)
— can merge the client's `Progress` sub-selection into that one query. This is
the one place in the schema where `queryFromInfo` is safe.

SDL unchanged. Touches `services/progress.ts` and its tests
(`services/progress.test.ts:337+` asserts DTO field names). **Split in two:**
(a) drop the DTO and the second query; (b) optionally add `queryFromInfo`.

## B-8 — not a deviation, but a real N+1: `Device.enabledUsers`

`device/model.ts:89` correctly spreads `...query` but issues one `user.findMany`
**per `Device`** under `Viewer.devices`. The plugin cannot fold it: `Device`→`User`
runs through the *explicit* join model `DeviceUser` (`schema.prisma:233`), so
`t.relation('enabledUsers')` returns `[DeviceUser!]`, not `[User!]` — an SDL
change. **KEEP.** Admin-only, small cardinality; recorded so it isn't re-derived.

---

# C. The seven request-scoped loaders

The brief expects several to fold into `t.relation`/`t.relationCount`. Checked
each against `prisma/schema.prisma`. Seven were keeps when this was written, on
the strength of F-1's measurement (a 4.5x regression). **Two of those keeps
were then overturned, by removing the premise rather than by re-measuring the
same thing**: converting `Library.progress` to `t.prismaConnection` (see A)
made that path plugin-planned, so C-4 is deleted and C-7 lost its `Progress
.book` consumer. Every keep that rests on `Library.entries` stands, and stands
structurally.

| # | loader | consumer | real Prisma relation? | verdict |
|---|---|---|---|---|---|
| C-1 | `graphql/owner.ts` | `Library.*`, `Book` URL fields, `Book.lineage` | n/a — mints the synthetic `Owner` | **KEEP** |
| C-2 | `progress-loader.ts` | `Book.progress` (`book/model.ts:298`) | No — and adding one measured **2→9 queries**, see F-1 | **KEEP, permanently** |
| C-3 | `pending-fix-loader.ts` | `Book.pendingFix`, `Book.hasActionablePendingFix` | **Yes** (`schema.prisma:43`) | **KEEP** |
| C-4 | `chapter-spine-map-loader.ts` | `Progress.currentChapter` | Reached through the relation added for C-7 | **DELETED** — the field is a `select` on `Progress.book` now |
| C-5 | `series-progress-loader.ts` | `Series.progressPercentage` | Partly | **KEEP** |
| C-6 | `validation-counts-loader.ts` | `Validation.counts` | **Yes** | **KEEP** |
| C-7 | `book-by-document-loader.ts` | `Progress.book`; **also `LinkedDocument.oldBook`/`newBook`** | **Yes**, once added | **KEPT, narrowed** — `Progress.book` is `t.relation` now; the two `LinkedDocument` fields hang off `Library.entries` and cannot follow |
| C-8 | `device-edition-count-loader.ts` *(added by slice 1, `166a6b69`)* | `Book.deviceEditionCount` | No — and adding one does not help; see F-2 | **KEEP** |

## Why C-2/C-4/C-7 could not be relations, and what changed

`Progress.document` and `Book.id` hold the same KOReader content hash, and when
this was written no relation was declared (`Progress` had only `user`).
`routes/kosync.ts` normalizes `document` through `resolveBookId` on write — an
application invariant, not a schema one.

**The relation is declared now** (`Progress.book`, `[userId, document] ->
[userId, id]`, no database foreign key — its own comment in `schema.prisma` says
why that is safe here and exactly what would break it). Declaring it changed the
answer for C-4 and C-7 but NOT for C-2: `Book.progress` is reached through
`Library.entries`, so `t.relation` there still measures 9 queries for a page of
8 against the loader's 2. The determining factor was never the relation; it is
whether the path is plugin-planned.

## C-3 `pendingFix` — a real relation that still cannot fold

Three independent reasons:

1. **The predicate.** Both consumers gate on
   `isLivePendingFix(parsePendingFixState(row.state), row.updatedAt, now)` — a
   JSON parse of the `state` text column plus a TTL against *now*. No Prisma
   `where` expresses it, and `t.relation` has no post-resolve hook: its
   `resolve:` is a **fallback only**, used when the optimizer did not already
   eagerly select the relation (`@pothos/plugin-prisma/lib/index.js`'s
   `wrapResolve` / `pothosPrismaFallback`). The comment at `book/model.ts:194`
   states this and is correct.
2. **`hasActionablePendingFix` is a `Boolean`** derived from `state.proposals`.
   `t.relation` can only return the relation's own type.
3. **The hot path bypasses plugin selects.** `Library.entries` reads books via
   `services/library-page.ts`'s hand-written `BOOK_SELECT`. Nothing there merges
   a Pothos relation select, so a `t.relation` would take its fallback path —
   one query per book, the exact N+1 the loader prevents. Converting would be a
   regression.

## C-6 `validation-counts` — real relation, not convertible

`Validation.counts` returns `[ValidationSeverityCount!]!` from a
`groupBy(['userId','bookId','severity'])`. `t.relationCount('messages')` yields
one `Int`. Reproducing the field needs one `t.relationCount` per severity with a
`where`, which is (a) an SDL change from one list field to N scalars and (b) a
break of the deliberate "zero-count severities are omitted" contract mirroring
REST (`validation-counts-loader.ts:26`) — fixed fields cannot be absent.

---

# D. Hand `encodeGlobalID` / `decodeGlobalID`

| # | file:line | what | plugin feature | call |
|---|---|---|---|---|
| D-1 | `schema/progress/model.ts:52` | `Progress.id` | `t.globalID` (output) | optional |
| D-2 | `schema/validation/model.ts:33` | `Validation.id` = owning **Book**'s gid | `t.globalID` | optional |
| D-3 | `schema/pending-fix/model.ts:52` | `PendingFix.id` = owning **Book**'s gid | `t.globalID` | optional |
| D-4 | `schema/book/mutation/delete.ts:125` | `BookDeletePayload.deletedId` | `t.globalID` | optional |
| D-5 | `schema/user/mutation/delete.ts:141` | `UserDeletePayload.deletedId` | `t.globalID` | optional |
| D-6 | `schema/progress/mutation/delete.ts:181` | `ProgressDeletePayload.deletedId` | `t.globalID` | optional |
| D-7 | `schema/progress/mutation/delete.ts:51` | `decodeGlobalID` in `decodeProgressId` | `t.arg.globalID({for:})` — **impossible** | **KEEP** |

**Inputs are already fully on the plugin:** 18 `t.globalID({for:})` input fields
plus 5 `t.arg.globalID`. No hand-decoded input argument exists except D-7.

**D-7 is a hard keep**, already documented at the call site: `for:` requires a
Node-implementing type, and `Progress` is deliberately not a `Node`
(`progress/model.ts:12`). `decodeProgressId` does the two jobs `t.globalID`
would, and additionally collapses `PothosValidationError` to `null`, preserving
the uniform "no such row" convention instead of a 500.

### D-1…D-6 — DROPPED, with the deciding reason found in slice 7

The conversion is feasible (mechanism verified below), but the only version
with REAL value is blocked, and what remains is a net negative.

**The valuable version uses a type REF, not a string.** `t.globalID`'s resolve
returns `{ type, id }` where `type` may be an `ObjectRef`, not just a name. With
a ref, a typo or a rename is a COMPILE error and follows the type
automatically — a genuine gain over `encodeGlobalID('Book', …)`, which nothing
checks.

**It is blocked by import cycles on two of the three sites.** Passing a ref
means importing `book/model` into the file. `book/model.ts:23` already imports
`../pending-fix`, so `pending-fix/model.ts` → `book/model` closes a real cycle —
the exact hazard a dozen doc comments in this schema exist to prevent
(`Received undefined as a type ref`). `validation/model.ts` would add a second
new edge for the same reason. Only `progress/model.ts` is safe, and it already
imports `book/model`.

**The string version is a net negative.** It gains only a RUNTIME throw on an
unregistered type name (`configStore.getTypeConfig` at resolve time — not
compile time), while being strictly more verbose than the direct call it
replaces:

```ts
// today
resolve: (v) => encodeGlobalID('Book', JSON.stringify([v.userId, v.bookId]))
// converted
resolve: (v) => ({ type: 'Book', id: JSON.stringify([v.userId, v.bookId]) })
```

**And D-4/5/6 are a bigger change than they look.** Those three `deletedId`
fields are `t.exposeID` over a payload shape that already stores the ENCODED
string; the encoding happens in the mutation resolver. Converting means
reshaping three documented payload types to carry components instead, moving
encoding into the field — churn on a presentation detail, for the same
marginal gain.

`encodeGlobalID` **is** the relay plugin's own public API. Calling it directly
is not a deviation from the plugin; wrapping it in a field builder that calls
the same function, for a runtime-only check, is churn. **Dropped.**

### Mechanism, verified (kept for the record)
`fieldBuilderProto.globalID` (`@pothos/plugin-relay/lib/field-builder.js:28`)
resolves `{type, id}` then calls `internalEncodeGlobalID`, which — with no
`relay.encodeGlobalID` override in `builder.ts`, and there is none — is
literally the same `encodeGlobalID` (`lib/utils/internal.js:21-27`). It emits
`type: 'ID'`, i.e. `ID!` under `defaultFieldNullability: false`: byte-identical
SDL.

The one substantive gain is that `t.globalID` routes the type name through
`configStore.getTypeConfig(item.type)`, which throws for an unregistered type —
a check `encodeGlobalID('Boook', …)` lacks today.

Against: `encodeGlobalID` **is** the relay plugin's own public API. Wrapping it
in a field builder that calls the same function is churn on six lines. **Low
value, low risk, droppable.**

---

# E. Raw SQL (`$queryRaw` / `$executeRaw`)

Raw grep finds ~180 hits. Almost all are noise:

| Where | Sites | Verdict |
|---|---|---|
| `db/migrate.ts` | ~90 | **Not a deviation.** A hand-rolled migration runner; Prisma Migrate is not in use. `ALTER TABLE`, SQLite's table-rebuild dance, `PRAGMA foreign_keys`, `PRAGMA table_info` have no client equivalent *by design*. |
| `*.test.ts` | ~70 | Fixtures seeding legacy/pre-migration schemas. Out of scope. |
| **`services/*.ts`** | **21** | The real inventory. |

## E-1 — CONVERT: the `book_id_history` / `device_editions` cluster (9 sites)

Both tables are **fully-modelled Prisma models** — `BookIdHistory`
(`schema.prisma:142`, `@@id([userId, oldId])`, `@@index([userId, currentId])`)
and `DeviceEdition` (`:220`, `@@id([userId, originalBookId, deviceId])`,
`@@index([userId, editionId])`).

| file:line | raw SQL | typed equivalent |
|---|---|---|
| `book-lineage.ts:20` | `SELECT current_id … user_id AND old_id` | `bookIdHistory.findUnique({where:{userId_oldId}})` — *this is the `@@id`* |
| `book-lineage.ts:24` | `SELECT original_book_id FROM device_editions … LIMIT 1` | `deviceEdition.findFirst({where:{userId, editionId}})` — hits `@@index` |
| `book-lineage.ts:76` | as `:20` | as `:20` |
| `book-lineage.ts:113` | `INSERT INTO book_id_history …` | `tx.bookIdHistory.create` |
| `book-lineage.ts:129` | `SELECT type … old_id AND current_id` | `findUnique({where:{userId_oldId}})` + `currentId` check |
| `book-lineage.ts:138` | `DELETE … old_id AND current_id` | `deleteMany` |
| `book-lineage.ts:157` | `DELETE … type='edit' AND (old_id=? OR current_id=?)` | `deleteMany({where:{userId, type:'edit', OR:[…]}})` |
| `book-lifecycle.ts:207` | `DELETE … (old_id=? OR current_id=?)` | `deleteMany` |
| `book-lifecycle.ts:384` | `UPDATE … SET current_id=? WHERE current_id=?` | `updateMany` |

**Evidence this is legacy, not necessity:** the test suite already uses the
typed client on these very tables — `prisma.bookIdHistory.create`
(`graphql/schema/book/lineage.test.ts:27`, `model.test.ts:208`,
`clear-edit-lineage.test.ts:43`), `bookIdHistory.count`
(`resolve-pending-fix.test.ts:933`), `prisma.deviceEdition.create`
(`device-edition-count.test.ts:35`). Production writes these tables raw while
its own tests read them typed.

**What is lost today:** snake_case columns (`old_id`, `current_id`) are
unchecked strings, so a `schema.prisma` rename breaks at runtime rather than at
`tsc`; the declared `@@id`/`@@index` are not verified as the access path; and
`$queryRaw`'s return type is a hand-written generic nothing validates.

**Caller adaptation:** `clearEditLineage` (`book-lineage.ts:157`) returns
`Promise<number>` from `$executeRaw`'s affected-row count; `deleteMany` returns
`{ count }`. Trivial, but `clear-edit-lineage.ts:95`'s doc comment reasons
explicitly about the raw-DELETE contract and must be updated with it.

## E-2 — NUANCED: three sites, one blocker each

| file:line | blocker | call |
|---|---|---|
| `book-lineage.ts:45` | `ORDER BY timestamp DESC, **rowid** DESC`. `rowid` is SQLite's implicit column, absent from the model; Prisma cannot order by it. No other tiebreaker exists, so this ordering is load-bearing for same-timestamp rows. | **KEEP** — real fix is F-3 |
| `book-lifecycle.ts:380` | `INSERT OR REPLACE`. `upsert({where:{userId_oldId}})` exists but is **not** equivalent: `INSERT OR REPLACE` deletes-then-inserts, resetting the omitted `type` to `@default("edit")`, whereas `upsert`'s update leaves the old `type`. | **CONVERT WITH CARE** — must set `type: 'edit'` explicitly in the update branch, or lineage semantics change silently |
| `token.ts:60` | `DELETE … RETURNING`, single-statement atomic consume-and-rotate. Prisma has no delete-returning on SQLite; the comment states the concurrency requirement (two presentations of one token, exactly one wins). Splitting reintroduces the race. | **KEEP** — correct as raw SQL |

## E-3 — KEEP: genuinely inexpressible (9 sites)

| file:line(s) | why |
|---|---|
| `search-suggestions.ts:28,53,85,95` | `FROM books, json_each(books.subjects)` — SQLite lateral join over a JSON text column. No Prisma equivalent; SQLite is not even a provider with Prisma JSON filters. *(This is the brief's explicitly out-of-scope item; recorded, not converted.)* |
| `book-catalog.ts:137` (`getSubjects`) | same `json_each` shape |
| `book-catalog.ts:214` (`listBooksBySubject`) | same `json_each` shape |
| `library-page.ts:392,404,416` (`seriesIdsForStatus`) | `LEFT JOIN progress p ON p.document = b.id` — a join **on a non-relation**, the same seam behind C-2/C-4/C-7. Compounded by `GROUP BY … HAVING SUM(CASE WHEN …)`, which `groupBy` cannot express. **F-1 removes the join half of this blocker; the `HAVING` aggregate remains.** |

**Through-line:** `library-page.ts`'s blocker is the *same* missing
`Progress.document = Book.id` relation that forces three loaders in Category C.
One omission explains both categories.

---

# F. Prisma-schema and file-structure changes

Category C returned 7/7 keeps, but six rest on the **same missing declaration**.
That makes it a schema question, asked here rather than assumed away.

## F-1 — `Progress` ↔ `Book` — ABANDONED, then SHIPPED once its premise was removed

> **SHIPPED.** The relation is in `prisma/schema.prisma`. Everything below
> about the relation ITSELF was right and is unchanged. What was wrong was the
> conclusion drawn from the measurement — see the correction directly below.

> **ABANDONED after implementing and measuring it (slice 4).** The relation
> works exactly as F-1 predicted at the *Prisma* level — every claim in the
> verification table below still holds. It buys nothing anyway, because the
> two consumers that matter cannot reach it. Reverted; tree unchanged.

### The correction: the measurement was right, the word "permanent" was not

The 2 -> 9 numbers below are real and reproduce. What does not hold is the
sentence they were used to justify: that both hand-built connections **must**
be hand-built, and that the loaders are therefore "permanent by design".

`Library.entries` must be, and that is structural — a union node type over an
interleaved two-table keyset, which `t.prismaConnection` cannot bind to.
`Library.progress` was hand-built **by a decision** (`e7f99557`, withholding
`last`/`before`), and a decision can be revisited. It was, and the ruling
reversed it. With the connection plugin-planned, the very same relation these
numbers were measured against takes a page of 8 from **3 queries to 1**.

The general rule survives with `Library.progress` struck from it:

> No field on `Book` or `Progress` reached through **`Library.entries`** can
> use plugin select-merging.

The lesson worth keeping is in `app/server/README.md`: a conclusion resting on
a decision has to name the decision, or it reads as a law of the library.

### What was verified about the relation itself (all still true)

```prisma
model Book     { progress Progress? }
model Progress { book Book? @relation(fields: [userId, document], references: [userId, id]) }
```

| Question | Result |
|---|---|
| Validates? (`userId` already used by the `user` relation) | **Yes** |
| **1:1** form, not just `Progress[]`? | **Yes** — `@@id([userId, document])` supplies the uniqueness |
| Orphan progress rows survive? *(KOReader syncs progress for documents never imported)* | **Yes** — row persists, `book` → `null` |
| Books with no progress? | **Yes** — `progress` → `null` |
| Cross-tenant safe? *(document hashes collide across users)* | **Yes, by construction** — `userId` is in the relation |
| Adds a DB foreign key that could reject orphans? | **No** — DDL comes from hand-written `prisma/migrations/*.sql`, not `prisma migrate dev` |

### Why it buys nothing — measured, 8 rows

| Field | Path | Loader (today) | `t.relation` |
|---|---|---|---|
| `Progress.book` (C-7) | `Library.progress` | `progress.findMany=1` + `book.findMany=1` = **2** | `progress.findMany=1` + `progress.findUniqueOrThrow=8` = **9** |
| `Book.progress` (C-2) | `Library.entries` | **2** | `book.findMany=1` + `book.findUniqueOrThrow=8` = **9** |

**4.5x worse on both.** Same mechanism as the corrected F-2, now demonstrated on
both hand-built connections: `@pothos/plugin-prisma` merges a field `select`
only into a query it planned itself (`wrapResolve` needs a `getLoaderMapping`
hit). `Library.entries` and `Library.progress` are BOTH hand-declared over
`builder.connectionObject` — and **must** be, by invariant 2, so their SDL omits
`last`/`before` — so neither is ever plugin-planned, and every `select`-carrying
field on the rows they yield falls back to a per-row `ModelLoader` re-query.

C-4 (`Progress.currentChapter`) was not separately converted: it would reach
`Book.chapterSpineMap` through the same relation on the same
`Library.progress` path, so it inherits the identical fallback.

### The general rule this established (superseded above — `Library.progress` is struck from it)

**No field on `Book` or `Progress` reached through `Library.entries` or
`Library.progress` can ever use plugin select-merging.** Invariant 2 makes both
connections permanently hand-built, so a request-scoped batching loader is not a
workaround there — it is the only mechanism that batches at all.

That is the single unifying explanation for the whole of Category C, and it
means those loaders are **permanent by design**, not debt awaiting a schema fix.
It also retires the "fewer loaders" framing this audit started with: the loader
count is a consequence of the SDL decision in `e7f99557`, not of a missing
relation.

The relation could still be added for the paths Pothos *does* plan
(`Library.book`, mutation payloads) — but those fetch a single row, where the
loader already costs the same one batched query, so there is nothing to win.
**Not recommended.**

## F-2 — `Book.deviceEditionCount`: a real N+1, but `t.relationCount` is the WRONG fix

> **DONE — shipped as `166a6b69` (slice 1).** Batching loader, no schema change.
> Measured on `Library.entries` with 20 books: **21 queries → 2**
> (1 `book.findMany` + 1 `deviceEdition.groupBy`); `Library.book` unchanged at 2.
> SDL unchanged, cost budgets unmoved, full suite green (1771 tests, +2).

> **CORRECTED after attempting the conversion (slice 1).** The original F-2
> entry claimed `t.relationCount` "removes a live up-to-100-query N+1". That is
> **false on the path that matters**, and was disproven by measurement, not
> review. The defect is real; the proposed fix is not. Superseded plan below.

### The defect (unchanged, still real)

`Book.deviceEditionCount` (`book/model.ts:366`) has **no loader** — it calls
`countForBook`, i.e. `prisma.deviceEdition.count({where:{userId, originalBookId}})`
(`services/edition.ts:187`). One `COUNT` per book, on a page of up to 100. It is
the only `Book` field reachable from `Library.entries` with a per-row query and
no batching.

### Why `t.relationCount` does not fix it — measured

The conversion was implemented in full (relation added to `schema.prisma`,
field converted, client regenerated) and instrumented with per-delegate spies
over a 5-book page:

| Path | Before (`t.int` + `countForBook`) | After (`t.relationCount`) |
|---|---|---|
| `Library.entries`, 5 books | 1 `book.findMany` + **5 `deviceEdition.count`** | 1 `book.findMany` + **5 `book.findUniqueOrThrow`** |
| `Library.book`, 1 book | 1 `book.findUnique` + 1 `deviceEdition.count` = **2** | **1** `book.findUnique` |

Correct values (`[0,1,2,3,4]`) on both variants; no errors either way.

So it trades **one query on Pothos-built paths** (a genuine but small win — those
fetch one book, or a bounded connection) for **no improvement on
`Library.entries`**, where the per-row `deviceEdition.count` is merely replaced
by a per-row `book.findUniqueOrThrow` that re-reads the whole book row plus a
`_count` subquery. That is very likely a small *regression* on the hot path.

### The mechanism, so this isn't re-attempted

`@pothos/plugin-prisma`'s `wrapResolve` (`lib/index.js:197`) takes the fast path
only when `(!loadedCheck || loadedCheck(parent, info)) && mapping`. `mapping`
comes from `getLoaderMapping(context, info.path, …)` — the plugin's own record
of a query **it** planned. `Library.entries` builds its query by hand
(`services/library-page.ts`'s `listBooksPage`), so no mapping exists and every
`select`-carrying field on those rows falls through to
`ModelLoader.loadSelection`, which re-queries per row.

**Crucially, the plugin never inspects the parent row for `_count`.** Adding
`_count: { select: { deviceEditions: true } }` to `BOOK_SELECT` was tried and
changed nothing — measured identical. There is no way to satisfy
`t.relationCount` from a hand-built query.

This is exactly the C-3 reasoning ("the hot path bypasses plugin selects, so a
`t.relation` would take its fallback path — one query per book") applied to a
different field. It was documented for `pendingFix` and then not applied here.

### The fix that does work: a batching loader

`deviceEditionCount` is the *odd one out* — the only per-row `Book` aggregate
without the treatment `progress`, `pendingFix`, and `Validation.counts` all get.
A request-scoped loader over
`deviceEdition.groupBy({ by: ['userId','originalBookId'], where: { OR: pairs }, _count })`
mirrors `validation-counts-loader.ts` almost exactly.

| Path | Today | `t.relationCount` | Batching loader |
|---|---|---|---|
| `Library.entries`, 100 books | 100 counts | 100 `findUniqueOrThrow` | **1 `groupBy`** |
| `Library.book`, 1 book | 2 | **1** | 2 |

The loader wins decisively where the multiplier is (the library's main screen)
and costs one query where it isn't. **No Prisma-schema change is required** —
`groupBy` needs no relation — so the `DeviceEdition`→`Book` relation should
*not* be added for this.

### Consequence for the audit's direction

This adds a seventh loader, against the "fewer loaders" grain. That is the
correct trade anyway: F-1 retires three, so the net is still down, and C's
whole finding is that these loaders exist because the hot read path is
hand-built — which is as true for this field as for the others.

## F-3 — `BookIdHistory` → `Book` + a `seq` tiebreaker — NOT VIABLE AS SPECIFIED

> **Checked in slice 8, not implemented.** Both halves fail, for separate
> reasons. Raising rather than proceeding: what remains would be a primary-key
> change plus a data migration on a live table, to replace an ordering that
> currently works.

### (a) The relation is dead for the same reason F-1 was, plus one more

`currentBook Book? @relation(...)` validates and tolerates orphans (probed in
slice 4's write-up). But `Book.lineage` is reached from `Library.entries`, which
is permanently hand-built — so `t.relation` would take the per-row fallback,
exactly as measured at 2→9 queries in F-1.

It also could not express the field even if the path were plugin-planned:
`getBookLineage` returns DERIVED entries — each entry's `newId` is read off its
PREDECESSOR in the ordered list — which is not a relation's shape at all.

### (b) The `seq` tiebreaker does not validate on SQLite

```
seq Int @default(autoincrement())
```
→ `P1012`: *"The `autoincrement()` default value is used on a non-id field even
though the datasource does not support this"* (and a second error for
non-indexed). SQLite supports `AUTOINCREMENT` only on an `INTEGER PRIMARY KEY`,
and this model's PK is the compound `@@id([userId, oldId])`.

Making it viable means one of:

- **Restructure the primary key** — `seq Int @id @default(autoincrement())` with
  `[userId, oldId]` demoted to `@@unique`. A table-rebuild migration on a table
  holding production lineage, changing the PK every other query in
  `book-lineage.ts` now uses (`findUnique({ where: { userId_oldId } })`).
- **Application-assigned counter** — a plain `Int` the write path maintains, with
  a backfill. Needs a monotonic source and touches every lineage writer.

### What is actually at stake

Nothing is broken today. `getBookLineage`'s `ORDER BY timestamp DESC, rowid DESC`
produces correct, stable ordering; the only cost is that this one query cannot
be typed (recorded at E-2, and now annotated at the call site by `6079942c`).
The ordering IS load-bearing — `entries` derives `newId` from the predecessor,
so same-timestamp rows must not reorder, and `reimportBook` flattens a whole
chain inside one transaction, routinely sharing a millisecond.

**Recommendation: leave it.** Revisit only if the raw query becomes a real
obstacle, or if `BookIdHistory` is being migrated for another reason anyway and
the PK change can ride along.

`currentBook Book? @relation(fields: [userId, currentId], references: [userId, id])`
validates and tolerates orphans (probed). It would let `Book.lineage` use
`t.relation` instead of raw SQL, pairing with E-1.

**But** it does not remove `book-lineage.ts:45`'s real blocker — the
`ORDER BY timestamp DESC, rowid DESC` tiebreaker (E-2). That needs a *different*
change: a monotonic column (e.g. `seq Int @default(autoincrement())`) so the
ordering stops depending on SQLite's implicit `rowid`. That is a data migration,
and the ordering is user-visible in the lineage modal. **Lowest priority.**

## F-4 — `Validation.counts` denormalization (recorded, not recommended)

C-6 stays a loader because `counts` is a `groupBy` over `severity`. It could be
removed by denormalizing per-severity counts onto `Validation` at validation
time — trading a request-scoped `groupBy` for write-time maintenance, a backfill
migration, and a new drift surface against `ValidationMessage`. **Not
recommended;** recorded so it isn't rediscovered as novel.

## F-5 — File structure: the loaders

**Location.** Six batching loaders sit flat at `graphql/*-loader.ts`, mixed with
`context.ts`, `yoga.ts`, `cost-limit.ts`, `derive.ts`. They are one cohesive
concern. `graphql/loaders/` is the obvious shape (with `owner.ts` — a memoizer,
not a batcher — labelled as such).

This is **not** the case `services/README.md` settled. That turned on a prefix
convention already doing a subdirectory's job across ~35 mixed modules, at a
cost of 72 import rewrites. Here it is 7 files, one idiom, and ~7 import sites
(`context.ts` alone). The cost/benefit is inverted, so the README's ruling does
not transfer — worth saying explicitly, since the next reader will reach for it.

**Duplication.** 610 lines across six files implementing *one* idiom — a
`Map<string, Map<string, Promise<T>>>` cache, a microtask-scheduled `flush`, and
the settle-both-`resolve`-and-`reject` discipline. The files say so:
"A direct mirror of `createProgressLoader`", "mirrors line for line rather than
inventing a second batching idiom". Four differ only in key names and one
`findMany`.

A `createPairLoader<K, V>(fetch, key)` factory would reduce this to one tested
implementation plus small definitions. That matters beyond tidiness: the
settle-on-throw fix had to be found once and hand-copied five times
(`pending-fix-loader.ts:52` records that `progress-loader` shipped without it
and hung a request). The next such fix has the same five-way copy problem.

> **Ordering dependency:** F-1 deletes three of these six loaders. Doing F-5
> first would refactor code about to be removed. **F-1 must precede F-5**, and
> after F-1 the factory covers three loaders (~337 lines), not six — still worth
> doing, but reassess the shape at that point rather than pre-committing.

`dataloader` (the npm package) is **not** a dependency — noted as the
alternative, though a local factory keeps the `{userId, x}`-pair batching
discipline explicit rather than encoded in a cache-key string, which is the
property every one of these files argues for at length.

## How Category F was verified

Each candidate relation was applied to `schema.prisma`, validated with
`prisma validate`, generated with `prisma generate`, and probed with a
throwaway vitest file against a real `createHarness()` database. Probes covered:
orphan rows in both directions, cross-tenant hash collision, batching, and the
1:1-vs-list relation form. `prisma/schema.prisma` was restored and the client
regenerated after every probe; `git status` was confirmed clean each time, and
`device-edition-count.test.ts` + `model.test.ts` were re-run green afterwards.

---

# Plan

One ordering by value and risk. It interleaves categories deliberately — F-2 is
the single highest-value item in the audit and is not in the original scope.

| # | Slice | Cat | Scope | Value | Risk | SDL |
|---|---|---|---|---|---|---|
| ~~1~~ | ~~`deviceEditionCount` batching loader~~ — **DONE, `166a6b69`**. 21→2 queries on a 20-book page | F-2 | `graphql/` | High | Low | none |
| ~~2~~ | ~~`Library.user` + two payload `user` fields → `t.prismaField`~~ — **DONE, `864c07cb`**. 2→1 query each | B-1/2/3 | `graphql/` | High | Low | none |
| ~~3~~ | ~~Drop `getUserProgressPage`'s DTO; delete `Library.progress`'s second query~~ — **DONE, `fd2d9770`**. 2→1 query per page | B-4a | `graphql/` + `services/` | Medium | Medium | none |
| ~~5~~ | ~~`Progress`↔`Book` relation; retire 3 loaders~~ — **ABANDONED, measured 2→9 queries.** See F-1 | F-1 | — | — | — | — |
| ~~4~~ | ~~Loaders → `graphql/loaders/` + shared factory~~ — **DONE, `6dc84688`**. 7 copies → 1, net −84 lines | F-5 | `graphql/` | High | Low | none |
| ~~6~~ | ~~`book_id_history`/`device_editions` raw SQL → typed client~~ — **DONE, `6079942c`**. 9 statements converted, 2 documented keeps | E-1/E-2 | `services/` | Medium | Low | none |
| 7 | `queryFromInfo` on `Library.progress` | B-4b | `graphql/` | Low | Low | none |
| 8 | Six `encodeGlobalID` → `t.globalID` | D-1…D-6 | `graphql/` | Low | Low | none |
| 9 | Lineage relation + `seq` tiebreaker | F-3 | schema + migration | Low | Medium — visible ordering, data migration | none |

Slices 1–2 are independent of everything and of each other. Slice 5 depends on
slice 4. Slices 7–9 are droppable.

**Expected SDL impact across every slice: none.** Any diff from
`npm run graphql:schema:check` is a failed conversion, not a snapshot to
regenerate. **Expected cost-budget impact: none** — no field arity or connection
bound changes. Both will be reported per slice regardless, per the brief.

Each slice is one commit, green on `npm run lint`, `npm test`, and
`npm run test:cost -w app/server` on its own.

---

# Note on invariant 2 vs. the code

The brief's invariant 2 reads: "`Library.entries` / `Library.progress` (and
`Series.books`) are hand-declared over `connectionObject` specifically so the
SDL omits `last`/`before`". The parenthetical does not match the code:
`Series.books` is `t.relatedConnection` (`series/model.ts:75`) and **does** offer
`last`/`before`. Both `series/model.ts:62-74` and `validation/model.ts:66` call
this asymmetry out explicitly and deliberately — backward pagination works over
a real Prisma relation and does not over the two forward-only service cursors.

Read as covering only `Library.entries`/`Library.progress`, the invariant holds
and is honoured throughout. Flagged in case the parenthetical was meant to
constrain something else.
