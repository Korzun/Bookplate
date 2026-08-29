import {
  FragmentDefinitionNode,
  GraphQLError,
  GraphQLField,
  GraphQLInterfaceType,
  GraphQLNamedType,
  GraphQLObjectType,
  GraphQLSchema,
  Kind,
  OperationDefinitionNode,
  SchemaMetaFieldDef,
  SelectionSetNode,
  TypeMetaFieldDef,
  TypeNameMetaFieldDef,
  ValidationContext,
  getNamedType,
  isInterfaceType,
  isObjectType,
} from 'graphql';
import type { ASTVisitor, FieldNode } from 'graphql';

import {
  createFragmentWalkMemo,
  resolveFragment,
  type FragmentWalkMemo,
} from './fragment-walk-memo';
import { CONNECTION_LIMITS } from './schema/pagination';

/**
 * Task 2's verdict (`.superpowers/sdd/2026-08-02-query-cost-control/task-2-report.md`)
 * REJECTED `@pothos/plugin-complexity`: its fragment walk is `2^N` (28.3s at
 * N=27) and its cycle handling throws a `RangeError` out of `validate`
 * (→ HTTP 500). This file hand-rolls the same seam `depth-limit.ts` already
 * uses (`addValidationRule`), reusing `fragment-walk-memo.ts`'s
 * memoize-by-fragment-name + cycle-guard for the exact same reason
 * `depth-limit.ts` needed it — a document that spreads fragment N inside
 * fragment N+1 must cost O(N), not O(2^N), and a cyclic fragment must not
 * crash this walk (see `resolveFragment`'s own doc comment).
 *
 * BINDING (query-cost-control ledger, "CONTROLLER RULING"): this file
 * computes NO depth — `depth-limit.ts` (unchanged, `MAX_DEPTH = 12`) is the
 * one depth enforcer. Task 3 shipped this file LOG-ONLY (never called
 * `context.reportError`); **Task 4 arms it** — see `BREADTH_BUDGET` /
 * `COMPLEXITY_BUDGET` below for the two enforced numbers and their
 * measured provenance, and `costLimitRule`'s own doc comment for how (and
 * why BOTH, not either alone) it now rejects.
 *
 * ## Counting model
 *
 * `breadth` = SUM over every selection in the EXPANDED selection tree of 1
 * (the selection itself) plus its own children's breadth. This is the only
 * one of the two metrics that PRICES REPETITION — 200 aliased copies of a
 * field cost 200× that field's breadth, because each alias is its own AST
 * `Field` node and siblings sum, never take a max (task-2 report, probe 3:
 * 200-alias grid measured breadth 2600 against a single copy's 13; the
 * ledger's open N-1, 200× `nodes(ids:[100])`, measured 400 against 2).
 * Inline fragments and named fragment spreads are TRANSPARENT for breadth,
 * exactly as `depth-limit.ts`'s `relativeDepthOf` treats them for depth —
 * `... on Book { x }` and `...BookCard` are a type condition plus a reusable
 * selection, not a node of their own; a rule that charged them one would
 * just push a client to flatten with more fragments rather than shrinking
 * the query.
 *
 * `complexity` = `FIELD_COST` (the cost of selecting the field itself) plus
 * `multiplier(field) × Σ complexity(children)`. `multiplier` is 1 for every
 * field EXCEPT: the four connections `CONNECTION_LIMITS` already bounds
 * (`Library.entries`, `Library.progress`, `Series.books`,
 * `Validation.messages`) and `Query.nodes(ids:)`, where it is the field's
 * effective page size / batch size; and (task-3-review round 2, I-4) seven
 * plain, non-connection list fields whose element type reaches further
 * amplifiable content and whose cardinality has no code-enforced ceiling
 * (`Library.series`, `Library.pendingFixes`, `Viewer.users`,
 * `Viewer.devices`, `Device.enabledUsers`, `Book.lineage`,
 * `ScanResult.imported`) — see `multiplierFor` and
 * `UNBOUNDED_LIST_FIELD_LIMITS` below for both groups.
 *
 * Task 2's report is explicit about why this is NOT the plugin's own
 * default weighting: `@pothos/plugin-complexity`'s `DEFAULT_LIST_MULTIPLIER`
 * fires on every `GraphQLList`-typed field it finds (e.g. `edges: [Edge]`,
 * `autoFixes: [MetadataFix!]!`), compounding once per nested list REGARDLESS
 * of whether that list is actually bounded — measured ranking the richest
 * LEGITIMATE screen (complexity 5747) ABOVE the 200-alias `nodes()` ATTACK
 * (2200), i.e. flagging the real app as the bigger threat. This file's
 * multiplier fires ONLY on the five fields above, whose sizes this schema
 * already bounds (`CONNECTION_LIMITS`, `pagination.ts`) — every other list
 * field (`subjects`, `identifiers`, `autoFixes`, …) costs exactly what a
 * flat per-field walk would cost it, because the spec's own reasoning for
 * NOT giving those fields a connection (`CONNECTION_LIMITS`'s doc comment:
 * "small and unpaginated today") means there is no real per-request bound
 * to multiply by in the first place. See `cost-limit.test.ts` and the
 * measured calibration table (task-3 report) for whether this design
 * actually discriminates legitimate traffic from the proven attack probes.
 */
export const FIELD_COST = 1;

export type OperationCost = { breadth: number; complexity: number };

type CostMemo = FragmentWalkMemo<OperationCost>;

/**
 * `ParentTypeName.fieldName` → the page-size bounds `multiplierFor` reads
 * for an args-aware multiplier. Sourced from `CONNECTION_LIMITS`
 * (`pagination.ts`) — the SAME numbers Task 1's resolvers reject oversize
 * pages against — restated here as a lookup keyed by real schema
 * coordinates, not duplicated as new numbers. `Query.nodes(ids:)` is handled
 * separately in `multiplierFor` (it has no `first`, only `ids.length`).
 */
const CONNECTION_FIELD_LIMITS: Record<string, { maxSize: number; defaultSize: number }> = {
  'Library.entries': CONNECTION_LIMITS.libraryEntries,
  'Library.progress': CONNECTION_LIMITS.libraryProgress,
  'Series.books': CONNECTION_LIMITS.seriesBooks,
  'Validation.messages': CONNECTION_LIMITS.validationMessages,
};

/**
 * `ParentTypeName.fieldName` → an ASSUMED worst-case multiplier for a plain
 * (non-connection, no `first`/`last` argument at all) list field whose
 * element type reaches further amplifiable content — task-3-review round 2,
 * I-4, found AFTER the I-1 fix: `multiplierFor` priced five coordinates and
 * left `Library.series: [Series!]!` (an unbounded `findMany`,
 * `library/model.ts`) at the default multiplier of 1, handing a
 * free `×S` (S = the library's series count) to any connection nested
 * under it. Measured: a 132-byte `{ series { books(first:12) { … }
 * books(first:100) { … } } }` scored breadth 11 / complexity 3,652 / depth
 * 10 — INSIDE every one of this task's own calibrated envelopes (legit
 * maxima 41 / 3823 / 12) — while fetching `S × 1,200` book rows, against
 * the richest calibrated legit screen's ~220 rows at complexity 3823. A
 * control isolated `series` as the exact unpriced factor: the identical
 * 2-hop shape rooted at `nodes(ids:)` instead (a BOUNDED 1,200 rows, no
 * hidden `×S`) scored 3,650 — same order, no `series` in the path.
 * `Library.pendingFixes` is the same class (`PendingFix.book.series.books`
 * reaches the identical connection through one more singular hop).
 *
 * **Full inventory (re-review round 2, verified programmatically against the
 * built schema, not by `grep`): exactly 25 composite-element list fields
 * exist.** They partition as:
 *  - 9 priced here (`UNBOUNDED_LIST_FIELD_LIMITS`, below) — the 7 from I-4
 *    plus 2 more from I-5 (`Library.searchSuggestions`, `SuggestionGroup.items`).
 *  - 1 priced separately in `multiplierFor` (`Query.nodes`, by `ids.length`).
 *  - 4 are a priced connection's own `edges` field (`LibraryEntriesConnection.edges`,
 *    `SeriesBooksConnection.edges`, `LibraryProgressConnection.edges`,
 *    `ValidationMessagesConnection.edges`) — correctly NOT priced separately:
 *    each is a child of the already-priced connection FIELD, so the parent's
 *    multiplier already scales it; pricing them too would double-count.
 *  - 11 are leaf-terminating — their element type's full reachability
 *    closure contains ZERO composite-element list fields and ZERO
 *    `first`/`last`-bearing fields (verified by closure, not by eyeballing
 *    the immediate fields): `Book.identifiers`,
 *    `BookAnalyzeReplacePayload.{autoFixes,messages,proposals}`,
 *    `EpubValidationError.messages`, `InvalidInputError.issues`,
 *    `PendingFixState.{appliedFixes,autoFixes,proposals}`,
 *    `UndoSnapshot.{appliedFixes,proposals}`. There is nothing further under
 *    them to multiply, so pricing them above 1 would inflate the
 *    calibration record for no real risk — the same "don't invent a number
 *    where there's nothing to multiply" discipline `CONNECTION_FIELD_LIMITS`
 *    already follows. (`BookUnlinkDocumentPayload.identifiers` was
 *    PREVIOUSLY, WRONGLY, listed here in an earlier version of this comment
 *    — task-3-re-review-2.md, M-6: `identifiers: [IdentifierInput!]` is a
 *    field on the INPUT type `BookUpdateMetadataInput`, not on
 *    `BookUnlinkDocumentPayload` — an input type cannot be selected and
 *    cannot appear in this walk at all, so it was never a real inventory row.)
 *  - 9 priced below.
 *
 * (25 = 9 + 1 + 4 + 11.)
 *
 * The 9 priced fields, each reaching further amplifiable content with NO
 * code-enforced ceiling (I-4's original 7) or WITH one that was being used
 * as a reason to price at 1 instead of pricing AT it (I-5's 2, below):
 *  - `Library.series` — `findMany({where:{userId}})`, no cap
 *    (`library/model.ts`); reaches `Series.books`.
 *  - `Library.pendingFixes` — `findMany({where:{userId}})`, no cap
 *    (`library/model.ts`); reaches `PendingFix.book.series.books`.
 *  - `Viewer.users` — `findMany({})`, no `where` clause AT ALL (every user
 *    on the instance), admin-only (`viewer/model.ts`); reaches
 *    `User.library.{entries,progress,series,pendingFixes}` — i.e. it can
 *    chain into every other field this map prices, once per user.
 *  - `Viewer.devices` — `findMany`, no cap on either branch
 *    (`viewer/model.ts`); reaches `Device.enabledUsers`.
 *  - `Device.enabledUsers` — `findMany`, no cap, admin-only
 *    (`device/model.ts`); reaches `User.library.*`, same as
 *    `Viewer.users` above but scoped to one device.
 *  - `Book.lineage` — I-7. See `BOOK_LINEAGE_MULTIPLIER` below; delegates to
 *    the imported `getBookLineage` (`services/book-lineage.ts`,
 *    `book/model.ts`); reaches
 *    `LinkedDocument.{oldBook,newBook}.series.books`.
 *  - `ScanResult.imported` — `findMany({where:{id:{in:importedBookIds}}})`;
 *    the `findMany` itself is bounded by `importedBookIds`, but that id
 *    list has no cap and scales with scan size (`scan-result/model.ts`);
 *    reaches `Book.series.books`. Reachable via `Library.scanStatus`,
 *    `libraryScan`'s mutation payload, and the `scanProgress` subscription.
 *  - `Library.searchSuggestions` — I-5. See `SUGGESTION_FIELD_LIMITS` below.
 *  - `SuggestionGroup.items` — I-5. See `SUGGESTION_FIELD_LIMITS` below.
 *
 * **`UNBOUNDED_LIST_MULTIPLIER` (100, `CONNECTION_LIMITS.nodesBatch`) applies
 * ONLY to the three fields below that genuinely scale with LIBRARY or SCAN
 * size** (`Library.series`, `Library.pendingFixes`, `ScanResult.imported` —
 * plus `Query.nodes(ids:)`, priced separately), where "unbounded" is a real
 * property of the data (a library can plausibly hold thousands of series or
 * pending fixes) and no REST precedent or measured bound exists — the exact
 * position `Query.nodes(ids:)` was in before Task 1 (`pagination.ts`'s own
 * doc comment: "NO REST or client precedent... Set to the largest per-page
 * ceiling established for any single connection above"). Reusing that SAME
 * shared reference number here is the identical choice Task 1 already made
 * for exactly this situation.
 *
 * `Viewer.users`, `Viewer.devices`, `Device.enabledUsers`, and (round-3,
 * I-7) `Book.lineage` do **NOT** use `UNBOUNDED_LIST_MULTIPLIER` — each
 * scales with a quantity smaller than "the whole library", and pricing all
 * of them at the library-scale 100 was measured, twice, to produce the
 * F-1 failure on both sides: once as an over-price (I-6) and once — for
 * `Book.lineage` specifically, task-3-re-review-3.md, I-7 — as a
 * near-miss REJECTION of a real screen. `getBookLineage`
 * (`services/book-lineage.ts`) is `SELECT old_id, timestamp, type
 * FROM book_id_history WHERE current_id = <this one book>` — one row per
 * re-import/merge event for A SINGLE BOOK, realistically 1-5, and does NOT
 * scale with library size at all; pricing it 100 overstates a typical
 * lineage by ~50×, and that 50× multiplies every field a richer lineage UI
 * selects. Measured: the shipped lineage UI renders bare content-hash ids
 * today (`book-lineage-merge-row/index.tsx`, `{documentId}`) — "show the
 * actual book" via the app's own existing `BookCard` fragment (already
 * shared by `entries`/`seriesByName`) on `oldBook`/`newBook` is the obvious
 * next step, and at the library-scale 100 that screen measured **complexity
 * 4,004 / breadth 44 — 104.7% of the complexity ceiling AND over the
 * breadth max — for ~2 real rows**, rejected by BOTH metrics on a plain,
 * one-fragment-reuse edit. **Fixed: `Book.lineage` now uses its own
 * `BOOK_LINEAGE_MULTIPLIER = 20`** — an assumed (not measured; no code caps
 * re-import event count) per-book quantity, 4× the realistic upper bound
 * (1-5) the same "generous headroom, not a bare minimum" reasoning the
 * household-scale numbers already use, one order of magnitude below the
 * library-scale 100 rather than two, because a book's own edit history,
 * while genuinely per-book, isn't AS tightly bounded in principle as "users
 * on one device" — see `cost-limit.test.ts`'s calibration re-check of the
 * `BookCard`-on-lineage shape at this multiplier.
 *
 * `Viewer.users` and `Device.enabledUsers` price the SAME underlying
 * quantity — round-3, M-8: `Device.enabledUsers`
 * (`device/model.ts`) is `user.findMany({where:{deviceAccess:{some:
 * {deviceId}}}})`, a SUBSET of the instance's users, which cannot exceed
 * `Viewer.users`'s own count — so both now share
 * `INSTANCE_USER_MULTIPLIER`. (Previously `Device.enabledUsers` used a
 * separate, then-tighter device constant (named `HOUSEHOLD_DEVICE_MULTIPLIER`
 * at the time, value 20 — Task 3 renamed it to `INSTANCE_DEVICE_MULTIPLIER`
 * and raised it to 100, below, so "tighter" describes round-3's history, not
 * today's relative sizes), with no code, REST, or schema basis for pricing a
 * subset of the instance's users more tightly than the instance's users
 * themselves — on a 50-user instance a single shared device can legally
 * return up to 50 rows.) `Viewer.devices` keeps its own
 * `INSTANCE_DEVICE_MULTIPLIER` — a genuinely different quantity (device
 * count, not user count) — but round-3 also records, for Task 4,
 * that `Viewer.devices` is **NOT household-scoped for an admin caller**:
 * `viewer/model.ts`'s `Viewer.devices` runs `device.findMany({orderBy})` with
 * **no `where`** when the viewer is an admin — every device on the instance,
 * not one household's e-readers; the household framing below holds only for the
 * non-admin branch, and an admin-scale instance (e.g. 60 users × 1-2 readers ⇒
 * 60-120 devices) plausibly exceeds the assumed 20 — re-derived by Task 3, see
 * the dedicated paragraph below `INSTANCE_USER_MULTIPLIER`'s own re-examination
 * for the new value and its reasoning.
 *
 * The `Viewer.devices`/`Device.enabledUsers` compounding shape this task
 * exists to fix — round-3, M-9, and re-checked against the shipped client
 * at the end of the GraphQL client realignment, which changed the answer.
 *
 * The list screen still does NOT select `enabledUsers`:
 * `app/client/src/page/device-list/index.tsx` spreads
 * `DeviceRowFragment` (`app/client/src/component/device-row/index.tsx`),
 * exactly the 8 fields `id name slug coverWidth coverHeight coverFit
 * bwCover simplify`. (An earlier version of this comment cited
 * `app/client/src/provider/device/type.ts` for that field list; the client
 * migration deleted that module, and the fragment above is now where those
 * 8 fields are declared.)
 *
 * What HAS changed: the compounding shape is no longer hypothetical. The
 * client now ships `DeviceUsersDocument`
 * (`app/client/src/graphql/device.ts`) — literally `viewer { devices { id
 * enabledUsers { id } } }` — driven by
 * `app/client/src/component/device-form/index.tsx` when an admin edits ONE
 * device, replacing the old per-device `GET /api/devices/:id/users`,
 * removed in Phase 0. It is affordable only because `id` and
 * NOTHING else travels through the ×5000 position: measured at breadth
 * 9.0% / complexity 31.2% of budget. That is the limit doing its job, and
 * it is why the numbers below still matter — the shape is now real. Real
 * cardinality on a self-hosted instance is still roughly 2-6 devices ×
 * 1-5 users each (a household's e-readers, non-admin branch), and
 * `Viewer.devices` × `Device.enabledUsers` at the PRE-round-2 flat 100×100
 * scored complexity 20,402 — 5.3× the (then-stale) legit ceiling — for
 * ~15 real rows either way. No endpoint, admin UI, or schema
 * constraint caps device or user count numerically, so
 * `INSTANCE_DEVICE_MULTIPLIER`/`INSTANCE_USER_MULTIPLIER` are ASSUMED, not
 * measured or sourced from code — stated as such, not disguised as a real
 * bound — but chosen an order of magnitude below the library-scale 100 to
 * reflect that a self-hosted server's household/instance user count is
 * genuinely a smaller-scale quantity than its book catalog:
 * `INSTANCE_DEVICE_MULTIPLIER` (originally 20, see re-derivation below) for
 * `Viewer.devices`, and `INSTANCE_USER_MULTIPLIER = 50` for
 * `Viewer.users`/`Device.enabledUsers` (headroom for a larger shared
 * instance — e.g. a small book club or extended family).
 *
 * **`INSTANCE_DEVICE_MULTIPLIER` RE-DERIVED, 20 → 100, and RENAMED from
 * `HOUSEHOLD_DEVICE_MULTIPLIER` (task-3-review.md, I-2 — the old name
 * claimed a household scale this constant's own admin-path reality (below)
 * never had; the number was right, the name was false, so the identifier is
 * corrected in place along with the value, per this codebase's
 * in-place-correction discipline)**
 * (`.superpowers/sdd/2026-08-03-cost-calibration-suite/task-3-report.md`).
 * The paragraph above already named the defect this fixes: `Viewer.devices`
 * is NOT household-scoped for an admin caller (`viewer/model.ts`'s
 * `device.findMany({orderBy})`, no `where`) — it returns every device on the
 * instance, and this codebase has no concept of "instance" smaller than the
 * 50-user ceiling `INSTANCE_USER_MULTIPLIER` already encodes (that
 * constant's own doc comment, below: "there is no code, REST, or product
 * concept of 'more than one Bookplate community' sharing an instance"). The
 * device count `Viewer.devices` fans out over is bounded by the SAME
 * instance-user quantity, times how many e-readers one person plausibly
 * owns — assumed 1-2 (a primary device plus an older or secondary one),
 * matching the household-scale reasoning `Viewer.devices` used before this
 * task, just applied at instance scale rather than household scale. 50
 * users × 2 devices/user = 100, the top of that range and the same
 * "generous headroom, not a bare minimum" choice `INSTANCE_USER_MULTIPLIER`
 * itself already makes (its own doc comment: "an order of magnitude above a
 * typical household, headroom for a genuinely large shared community") —
 * landing inside the 60-120 range the paragraph above already flagged as
 * plausible for an admin-scale instance. Effective value BEFORE this task:
 * 20 (assumed household scale, 2-6 devices × generous headroom — correct
 * for the non-admin branch, under-priced for the admin branch this
 * multiplier actually governs). `INSTANCE_DEVICE_MULTIPLIER = 100` now
 * matches `UNBOUNDED_LIST_MULTIPLIER`'s own value numerically, but not its
 * derivation — this number comes from instance-user-count × devices-per-user,
 * `UNBOUNDED_LIST_MULTIPLIER` from `CONNECTION_LIMITS.nodesBatch`; the
 * coincidence is not load-bearing and neither constant defers to the other.
 * `Device.enabledUsers` is unaffected (M-8, above: it shares
 * `INSTANCE_USER_MULTIPLIER`, never used this constant). See
 * `COMPLEXITY_BUDGET`'s own doc comment for the re-measurement this raise
 * required and the resulting budget derivation.
 *
 * **Forward-looking (task-3-review.md, (a)): this constant is no longer
 * floor-neutral by default.** The device-list+`enabledUsers` consolidation
 * fixture (`cost-calibration.test.ts`) is `1 + INSTANCE_DEVICE_MULTIPLIER ×
 * 109`; at 100 it measures 10,902, well under the 22,602 floor-setting
 * anchor (`Viewer.users`-rooted, not device-rooted). It OVERTAKES 22,602 and
 * becomes the floor-setter itself once `INSTANCE_DEVICE_MULTIPLIER ≥ 208` —
 * today's 100 leaves roughly 2× of room, but a FUTURE re-derivation of this
 * constant must re-measure the whole legit/near-future corpus (per the
 * binding order above `COMPLEXITY_BUDGET`), not assume the floor stays put
 * the way this task's own raise happened to leave it.
 *
 * **`INSTANCE_USER_MULTIPLIER` re-examined and KEPT at 50 (final-review.md,
 * I-2).** The whole-branch final review measured a REAL admin screen —
 * `viewer { users { library { progress(first: 50) { edges { node { document
 * percentage device timestamp } } } } } } }` (`component/user-progress-row`'s
 * exact four fields, the server's own default page size) — at complexity
 * 22,602-22,803 depending on exact `pageInfo` selection, 91% of the
 * then-shipped `COMPLEXITY_BUDGET` (25,000) and higher than every anchor
 * that budget was derived from, with NO calibration-table row recording it.
 * One more `Progress` field (any of `deviceId`/`position`/`currentChapter`)
 * adds a flat +2,500 (both `INSTANCE_USER_MULTIPLIER` and
 * `CONNECTION_LIMITS.libraryProgress`'s own multiplier compound on every
 * unit added beneath them) and would have rejected a real, shipping screen.
 * Two paths existed: shrink the multiplier (which would UNDER-price the
 * genuine worst case a larger deployment could reach — the multiplier's job
 * is bounding how expensive `Viewer.users` fan-out CAN be, not how expensive
 * today's smallest deployment happens to be), or keep it and give the
 * budget real headroom. **Decision: keep `INSTANCE_USER_MULTIPLIER = 50`,
 * raise `COMPLEXITY_BUDGET`** — see that constant's own doc comment for the
 * re-derivation. Restated explicitly, per the review's own instruction not
 * to paper over a wrong multiplier with a budget change: 50 is not being
 * defended as "close enough" — Bookplate is self-hosted, single-instance,
 * multi-tenant-free software; there is no code, REST, or product concept of
 * "more than one Bookplate community" sharing an instance, so the
 * quantity `Viewer.users` fans out over is bounded by how many people
 * realistically share ONE self-hosted server: a household, extended family,
 * or a small reading community (a book club, a friend group) — not a
 * public multi-tenant SaaS user base. 50 registered accounts is a generous
 * ceiling for that shape of deployment (an order of magnitude above a
 * typical household, headroom for a genuinely large shared community), and
 * nothing measured by this review suggests it is too small for Bookplate's
 * actual target deployment size. If a real self-hosted instance ever
 * exceeds 50 registered users, this multiplier under-prices `Viewer.users`
 * fan-out and needs re-deriving upward — that risk is accepted deliberately,
 * not overlooked, the same "assumed, not measured, because no code bound
 * exists" disclosure this constant has always carried.
 */
const UNBOUNDED_LIST_MULTIPLIER = CONNECTION_LIMITS.nodesBatch;
// Task 3 re-derivation (20 → 100) and rename (from HOUSEHOLD_DEVICE_MULTIPLIER,
// task-3-review.md I-2) — see the dedicated paragraph above,
// "`INSTANCE_DEVICE_MULTIPLIER` RE-DERIVED, 20 → 100", for the device count
// this now encodes and the reasoning.
const INSTANCE_DEVICE_MULTIPLIER = 100;
const INSTANCE_USER_MULTIPLIER = 50;
const BOOK_LINEAGE_MULTIPLIER = 20;

const UNBOUNDED_LIST_FIELD_LIMITS: Record<string, { maxSize: number; defaultSize: number }> = {
  'Library.series': { maxSize: UNBOUNDED_LIST_MULTIPLIER, defaultSize: UNBOUNDED_LIST_MULTIPLIER },
  'Library.pendingFixes': {
    maxSize: UNBOUNDED_LIST_MULTIPLIER,
    defaultSize: UNBOUNDED_LIST_MULTIPLIER,
  },
  'Viewer.users': { maxSize: INSTANCE_USER_MULTIPLIER, defaultSize: INSTANCE_USER_MULTIPLIER },
  'Viewer.devices': {
    maxSize: INSTANCE_DEVICE_MULTIPLIER,
    defaultSize: INSTANCE_DEVICE_MULTIPLIER,
  },
  // M-8: shares Viewer.users's multiplier, not INSTANCE_DEVICE_MULTIPLIER —
  // enabledUsers is a SUBSET of the instance's users (device/model.ts's
  // `where: { deviceAccess: { some: { deviceId } } }`), so it cannot exceed
  // Viewer.users's own count and must never be priced tighter than it.
  'Device.enabledUsers': {
    maxSize: INSTANCE_USER_MULTIPLIER,
    defaultSize: INSTANCE_USER_MULTIPLIER,
  },
  // I-7: per-book re-import history, not library-scale — see the doc
  // comment above BOOK_LINEAGE_MULTIPLIER's declaration.
  'Book.lineage': { maxSize: BOOK_LINEAGE_MULTIPLIER, defaultSize: BOOK_LINEAGE_MULTIPLIER },
  'ScanResult.imported': {
    maxSize: UNBOUNDED_LIST_MULTIPLIER,
    defaultSize: UNBOUNDED_LIST_MULTIPLIER,
  },
};

/**
 * `Library.searchSuggestions`/`SuggestionGroup.items` — task-3-re-review-2.md,
 * I-5. Previously ruled SAFE (priced at 1) because `getSearchSuggestions`
 * (`services/search-suggestions.ts`) caps every branch at `LIMIT 30`
 * (4 occurrences, one per suggestion
 * group), ≤4 groups (`author`/`series`/`book`/`subject`). That reasoning
 * used "has a code-enforced bound" as grounds for EXEMPTION — but this
 * file's own precedent (`CONNECTION_FIELD_LIMITS`, `Library.entries` etc.)
 * is the opposite: a field bounded at N is priced AT N, not exempted for
 * being bounded. Measured: `searchSuggestions { items { book { series {
 * books(first:100) … } } } }` (138 bytes) scored breadth 10 / complexity
 * 307 / depth 10 — INSIDE all three calibrated envelopes — while fetching
 * ~3,000 real rows (30 items × up to 100 books each via `Series.books`);
 * the SAME real cost routed through the now-priced `Library.series` scores
 * 30,103 — a 98× gap for identical real cost, the exact "two prices for
 * one cost" class I-4 named.
 *
 * Priced at the SOURCED bounds, not an assumption: `searchSuggestions`
 * itself returns at most 4 groups — `getSearchSuggestions`'s own four
 * `groups.push(...)` sites (one each for `author`, `series`, `book`, and
 * `subject`), each behind its own
 * guard and pushed at most once (`services/search-suggestions.ts`);
 * each group's `items` is capped at `LIMIT 30`.
 * `Suggestion.book` (`schema/suggestion/model.ts`) only resolves a
 * lookup for `BOOK`-typed items (`suggestion.userId === undefined` short-
 * circuits every other group to `null`, no query at all), so the true
 * reachable fan-out is narrower than 4×30 — but pricing `items` at 30
 * uniformly (not conditionally on group type, which `multiplierFor` has no
 * way to know from the AST alone) is the conservative, not-underpriced
 * direction, matching every other multiplier in this file.
 */
const SUGGESTION_GROUP_COUNT = 4;
const SUGGESTION_ITEMS_PER_GROUP = 30;

const SUGGESTION_FIELD_LIMITS: Record<string, { maxSize: number; defaultSize: number }> = {
  'Library.searchSuggestions': {
    maxSize: SUGGESTION_GROUP_COUNT,
    defaultSize: SUGGESTION_GROUP_COUNT,
  },
  'SuggestionGroup.items': {
    maxSize: SUGGESTION_ITEMS_PER_GROUP,
    defaultSize: SUGGESTION_ITEMS_PER_GROUP,
  },
};

/**
 * The single lookup `multiplierFor` reads — `CONNECTION_FIELD_LIMITS`,
 * `UNBOUNDED_LIST_FIELD_LIMITS`, and `SUGGESTION_FIELD_LIMITS` are
 * documented separately (genuine `first`/`last`-bearing connections vs.
 * assumed-worst-case plain lists vs. sourced-bound plain lists) because
 * their NUMBERS have different provenance, but they are read through one
 * map so `multiplierFor` doesn't need to know which kind of field it
 * found — `pageSizeMultiplier` already does the right thing for a field
 * with no `first`/`last` argument at all (both read as `undefined`,
 * falling through to `defaultSize`, which for every entry in either of the
 * latter two maps equals its own `maxSize`).
 */
const FIELD_MULTIPLIER_LIMITS: Record<string, { maxSize: number; defaultSize: number }> = {
  ...CONNECTION_FIELD_LIMITS,
  ...UNBOUNDED_LIST_FIELD_LIMITS,
  ...SUGGESTION_FIELD_LIMITS,
};

/** Reads a literal `Int` argument's value off a `Field` AST node. `undefined` = argument absent or explicit `null`; `'variable'` = present but not a literal we can read at validation time (a `$variable`) — `multiplierFor` treats both non-literal cases conservatively, never by guessing the runtime value. */
const literalIntArg = (field: FieldNode, argName: string): number | 'variable' | undefined => {
  const arg = field.arguments?.find((a) => a.name.value === argName);
  if (!arg || arg.value.kind === Kind.NULL) return undefined;
  if (arg.value.kind === Kind.INT) return Number.parseInt(arg.value.value, 10);
  return 'variable';
};

/**
 * The effective page size for a connection field, reading BOTH `first` and
 * `last` — Task-3-review finding I-1. `Series.books`/`Validation.messages`
 * support genuine backward pagination (Task 1 only rejects an OVERSIZE
 * `last`, same as `first` — `rejectOversizePage`, `pagination.ts`), so
 * `books(last: 100)` fetches exactly as many rows as `books(first: 100)`.
 * Reading only `first` (this function's first version) priced that shape at
 * `defaultSize` regardless of how many rows it actually fetched — measured
 * (task-3-review.md, I-1) underpricing the 3-hop `nodes()` cycle 120× when
 * rewritten with `last:100` (4,040,402 → 33,682) and putting a 2-hop
 * `last:100` cycle BELOW both legitimate maxima entirely (breadth 10,
 * complexity 1,682 vs legit max 41 / 3823) — invisible to both metrics
 * while still fetching 100×100 rows. Whichever direction is present wins;
 * if a document somehow carries both (Task 1 would reject an oversize
 * either way, but this rule runs before that), take the larger so this
 * function never underprices relative to reading either alone. A literal
 * value is clamped to `[1, maxSize]`; a variable-valued or entirely omitted
 * argument on EITHER side falls back to `maxSize`/`defaultSize` exactly as
 * `multiplierFor`'s original single-argument version already did.
 */
const pageSizeMultiplier = (
  field: FieldNode,
  limits: { maxSize: number; defaultSize: number }
): number => {
  const first = literalIntArg(field, 'first');
  const last = literalIntArg(field, 'last');
  if (first === undefined && last === undefined) return limits.defaultSize;
  if (first === 'variable' || last === 'variable') return limits.maxSize;
  const literal = Math.max(first ?? 0, last ?? 0);
  return Math.min(Math.max(literal, 1), limits.maxSize);
};

/**
 * The args-aware multiplier for one field occurrence — `1` for every field
 * except the fourteen `FIELD_MULTIPLIER_LIMITS` prices: five real,
 * `first`/`last`-bearing connections; seven unbounded plain lists
 * (`UNBOUNDED_LIST_FIELD_LIMITS`, above — round-2 review, I-4); and two
 * plain lists priced at a sourced (not assumed) bound
 * (`SUGGESTION_FIELD_LIMITS`, above — round-2 review, I-5) — plus
 * `Query.nodes(ids:)`, priced separately below by `ids.length` rather than
 * through this lookup at all (fifteen coordinates total).
 *
 * `Query.nodes(ids:)`: multiplier is `ids.length`, clamped to
 * `CONNECTION_LIMITS.nodesBatch` (100) — same reasoning as a connection's
 * `first`, but keyed off list LENGTH rather than a page-size argument, since
 * `nodes` has no `first` at all (task-2 report: "only complexity prices the
 * batch, and only via a multiplier, never from `ids.length` itself" — this
 * closes that gap deliberately, per Task 1's cap being "exactly the gap
 * Tasks 3-4's `breadth` limit exists to close" for BREADTH; complexity is
 * where `ids.length` itself gets priced). A literal list is counted
 * directly; a variable-valued or absent `ids` (malformed — `ids` is
 * required, so "absent" cannot happen through a valid document, but a
 * variable-valued list is common) falls back to the cap, the same
 * "can't resolve, assume worst case" rule connections use below.
 *
 * Connections: `pageSizeMultiplier` (above) prices whichever of `first`/
 * `last` is actually present, clamped to `[1, maxSize]` — never left
 * unclamped, so a single `first: 999999999` (Task 1 already rejects this at
 * EXECUTION time, in the resolver — this rule runs at VALIDATION time,
 * before Task 1's guard ever sees it) reports a sane, bounded multiplier
 * rather than a nine-digit one. Omitted `first`/`last` uses `defaultSize` —
 * the CONTROLLER RULING's own instruction (query-cost-control ledger) — a
 * variable-valued argument (can't be read at validation time; `graphql-js`
 * hands validation rules the AST, not resolved variable values) falls back
 * to `maxSize`, the same worst-case-not-a-guess reasoning `ids.length` uses.
 */
const multiplierFor = (parentTypeName: string | undefined, field: FieldNode): number => {
  const fieldName = field.name.value;
  if (parentTypeName === 'Query' && fieldName === 'nodes') {
    const idsArg = field.arguments?.find((a) => a.name.value === 'ids');
    if (idsArg && idsArg.value.kind === Kind.LIST) {
      return Math.min(idsArg.value.values.length, CONNECTION_LIMITS.nodesBatch);
    }
    return CONNECTION_LIMITS.nodesBatch; // variable-valued `ids` — worst case, not a guess
  }
  const limits = parentTypeName
    ? FIELD_MULTIPLIER_LIMITS[`${parentTypeName}.${fieldName}`]
    : undefined;
  if (!limits) return 1;
  return pageSizeMultiplier(field, limits);
};

/**
 * Resolves the `GraphQLField` definition for `fieldName` on `parentType`,
 * including the three meta-fields graphql-js does not put in
 * `getFields()` (`__typename` on any composite type, `__schema`/`__type`
 * only on the root `Query` type) — the same three cases graphql-js's own
 * `TypeInfo` special-cases. `undefined` covers everything this walk isn't
 * equipped to resolve (a Union's non-`__typename` field, an unknown field
 * name, a type condition graphql-js itself will reject) — NOT an error
 * here; `costOfSelectionSet` treats an unresolvable field as a childless
 * leaf rather than throwing, the same "skip it, another rule's problem"
 * discipline `depth-limit.ts` applies to unknown fragment names.
 */
const fieldDefOf = (
  parentType: GraphQLNamedType | undefined,
  fieldName: string,
  schema: GraphQLSchema
): GraphQLField<unknown, unknown> | undefined => {
  if (fieldName === '__typename') return TypeNameMetaFieldDef;
  if (parentType === schema.getQueryType()) {
    if (fieldName === '__schema') return SchemaMetaFieldDef;
    if (fieldName === '__type') return TypeMetaFieldDef;
  }
  if (!parentType || !(isObjectType(parentType) || isInterfaceType(parentType))) return undefined;
  return (parentType as GraphQLObjectType | GraphQLInterfaceType).getFields()[fieldName];
};

/** Unwraps `NonNull`/`List` down to the named type a field's sub-selection resolves against — `undefined` propagates harmlessly (the next level's `fieldDefOf` just also resolves to `undefined`). */
const namedTypeOf = (
  field: GraphQLField<unknown, unknown> | undefined
): GraphQLNamedType | undefined => (field ? getNamedType(field.type) : undefined);

const sumCost = (a: OperationCost, b: OperationCost): OperationCost => ({
  breadth: a.breadth + b.breadth,
  complexity: a.complexity + b.complexity,
});

/**
 * The combined breadth+complexity walk — ONE traversal computing BOTH
 * numbers (query-cost-control ledger: "Three separate concerns [depth,
 * breadth, complexity], one shared walk-memo" — depth keeps its own,
 * unchanged, in `depth-limit.ts`; breadth and complexity share this one,
 * since both are schema-aware SUMS over the same expanded selection tree
 * and computing them in two separate passes would mean walking every
 * fragment spread twice for no reason).
 *
 * `parentType` is threaded through by hand (not via graphql-js's own
 * `TypeInfo`) because, like `depth-limit.ts`, this walk is NOT driven by
 * `visit()` — it recurses directly from `OperationDefinition`, so there is
 * no ambient `TypeInfo` tracking type context for it to read.
 */
const costOfSelectionSet = (
  selectionSet: SelectionSetNode,
  parentType: GraphQLNamedType | undefined,
  fragments: Record<string, FragmentDefinitionNode>,
  schema: GraphQLSchema,
  memo: CostMemo
): OperationCost =>
  selectionSet.selections.reduce<OperationCost>(
    (acc, selection) => {
      if (selection.kind === Kind.FIELD) {
        const fieldDef = fieldDefOf(parentType, selection.name.value, schema);
        if (!selection.selectionSet) {
          return sumCost(acc, { breadth: 1, complexity: FIELD_COST });
        }
        const childType = namedTypeOf(fieldDef);
        const child = costOfSelectionSet(
          selection.selectionSet,
          childType,
          fragments,
          schema,
          memo
        );
        const multiplier = multiplierFor(parentType?.name, selection);
        return sumCost(acc, {
          breadth: 1 + child.breadth,
          complexity: FIELD_COST + multiplier * child.complexity,
        });
      }
      if (selection.kind === Kind.INLINE_FRAGMENT) {
        const typeCondition = selection.typeCondition
          ? schema.getType(selection.typeCondition.name.value)
          : parentType;
        return sumCost(
          acc,
          costOfSelectionSet(selection.selectionSet, typeCondition, fragments, schema, memo)
        );
      }
      // FragmentSpread — unknown name is `KnownFragmentNames`'s problem, not
      // ours; skip it rather than duplicating that check (same rule
      // `relativeDepthOf` follows in `depth-limit.ts`).
      const name = selection.name.value;
      const fragment = fragments[name];
      if (!fragment) return acc;
      const value = resolveFragment(name, memo, { breadth: 0, complexity: 0 }, () =>
        costOfSelectionSet(
          fragment.selectionSet,
          schema.getType(fragment.typeCondition.name.value),
          fragments,
          schema,
          memo
        )
      );
      return sumCost(acc, value);
    },
    { breadth: 0, complexity: 0 }
  );

const rootTypeOf = (
  schema: GraphQLSchema,
  operation: OperationDefinitionNode['operation']
): GraphQLNamedType | undefined => {
  if (operation === 'query') return schema.getQueryType() ?? undefined;
  if (operation === 'mutation') return schema.getMutationType() ?? undefined;
  return schema.getSubscriptionType() ?? undefined;
};

const INTROSPECTION_ROOT_FIELDS = new Set(['__schema', '__type']);

/**
 * True for an operation that IS `getIntrospectionQuery()` (or a hand-written
 * equivalent) — every top-level selection is an introspection meta-field.
 * Task-3-review finding I-3: `getIntrospectionQuery()` measures breadth 220
 * / complexity 220 — 5.4× this task's own calibrated legit max of 41 — for
 * the same reason `depth-limit.ts`'s own `isIntrospectionOnly` exemption
 * exists (its doc comment, I-1 in ITS review): `__Type.fields.type.ofType…`
 * is deep, legitimate self-reference, not amplification, and in dev
 * `useSchemaConcealment` is deliberately not installed (`yoga.ts`), so
 * GraphiQL's own schema-fetch reaches this rule. Zero production exposure
 * for the same reason `depth-limit.ts`'s version has none:
 * `NoSchemaIntrospectionCustomRule` already rejects every introspection
 * operation outright in production before this rule's numbers would matter
 * to anyone.
 *
 * `depth-limit.ts` does not export its own copy of this check, so it cannot
 * be imported from here — this is a second, deliberately duplicated copy,
 * re-derived because the source can't be imported from, not extracted
 * (task-3-review.md, I-2). Unlike the fragment-walk memo — which carried
 * this exact disposition until the cost-calibration-suite plan's task 1
 * consolidated both rules' memo onto `fragment-walk-memo.ts`, the ruling
 * that had frozen `depth-limit.ts` against that having expired — nothing
 * forces this particular duplication: `isIntrospectionOnly` could be
 * extracted the same way if it is ever found to actually drift. Carried
 * debt until then: if either copy's definition of "introspection-only"
 * ever changes, the other needs the same edit by hand.
 */
const isIntrospectionOnly = (selectionSet: SelectionSetNode): boolean =>
  selectionSet.selections.every(
    (selection) =>
      selection.kind === Kind.FIELD && INTROSPECTION_ROOT_FIELDS.has(selection.name.value)
  );

/**
 * Exposed for `cost-limit.test.ts`'s direct measurement assertions and the
 * calibration probes — mirrors `depth-limit.ts`'s `measureOperationDepth`.
 * Each call gets its own fresh memo with a no-op `onCycle`: a cyclic
 * fragment here just measures as contributing `{breadth: 0, complexity: 0}`
 * at the cycle point (this function has no `ValidationContext` to report
 * through, and — unlike `depth-limit.ts` — `costLimitRule` below does not
 * report cycles either; see its own doc comment for why that is still
 * correct, not a gap).
 *
 * Deliberately carries NO introspection exemption, unlike `costLimitRule`
 * below — this is the pure measurement primitive the calibration probe uses
 * to record introspection's real number (breadth 220 / complexity 220,
 * task-3-report.md's calibration table) for the record, exactly mirroring
 * how `depth-limit.ts` keeps `measureOperationDepth` unexempted while only
 * `depthLimitRule` skips introspection operations.
 */
export const measureOperationCost = (
  operation: OperationDefinitionNode,
  fragments: Record<string, FragmentDefinitionNode>,
  schema: GraphQLSchema
): OperationCost =>
  costOfSelectionSet(
    operation.selectionSet,
    rootTypeOf(schema, operation.operation),
    fragments,
    schema,
    createFragmentWalkMemo(() => {})
  );

/**
 * **Task 4 — the breadth budget, ENFORCED.** Measured max → margin → budget
 * → gap to nearest attack:
 *
 * - **Measured max (legit).** Task 3's own calibration table (task-3-report.md
 *   §4) records breadth 6–41 across every shipped screen, but Task 3's own
 *   round-4 re-review (task-3-re-review-4.md, "Breadth ceiling") went
 *   further and measured two PLAUSIBLE near-future shapes — a `BookCard`
 *   fragment reused on `Book.lineage`'s `oldBook`/`newBook` (breadth 40–44
 *   depending on exact field composition; `cost-limit.test.ts` pins 40) and
 *   a richer version of the already-legit richest grid fixture (one more
 *   real field on the shared card, `author`, `Validation.messages`, plus one
 *   more nesting level) at **breadth 56** (task-4-review.md, C-1/M-2 —
 *   corrected from an earlier, invalid 52: the fixture's original
 *   `messages { severity message }` selected fields directly on
 *   `ValidationMessagesConnection` instead of through `edges { node { … } }`,
 *   which `FieldsOnCorrectType` rejects; the schema-valid rewrite measures
 *   56, not 52 — `cost-limit.test.ts`'s `accepts()` helper now asserts every
 *   ACCEPT fixture is schema-valid via `specifiedRules`, closing the gap that
 *   let the invalid number through once). 56 is the highest MEASURED,
 *   schema-valid plausible-legit number and the one this budget must clear —
 *   `cost-limit.test.ts` asserts both near-future shapes ACCEPT.
 * - **Margin.** The reviewer's own recommendation (task-3-re-review-4.md):
 *   ~2× the near-future max (40–56 after the C-1 correction), landing at
 *   100 — "leaving room for one more field or one more nesting level
 *   without landing exactly on the line," the same F-1 lesson
 *   `depth-limit.ts`'s own recalibration comment already paid for once (a
 *   budget set AT the observed legit max is a production outage waiting for
 *   one new field).
 * - **Budget: 100** (unchanged by the task-4-review.md correction — only the
 *   cited floor moved, 52 → 56; 1.8× margin over 56 still clears
 *   comfortably, task-4-review.md M-2).
 * - **Gap to nearest attack.** The alias-repetition family sits at breadth
 *   120 (12-aliased `searchSuggestions`), 400 (200×`nodes(ids:[100])`), and
 *   3200 (200-alias grid fan-out) — 100 clears the near-future legit max
 *   with margin AND sits 20 below the SMALLEST of those (120), a real gap,
 *   not a coin-flip boundary. (That smallest one, 120, is also caught
 *   independently by `COMPLEXITY_BUDGET` below — losing no coverage even
 *   though its own breadth margin over 100 is comparatively thin.) The two
 *   costliest PROVEN attacks (the 3-hop `nodes()` cycle, the Series-arm
 *   2-hop) measure breadth **14** — below even the OLD legit max of 41, let
 *   alone 100 — confirming (task-3-report.md §5) that breadth cannot be
 *   this budget's only defense against them; `COMPLEXITY_BUDGET` is what
 *   catches those two. What breadth's 100 uniquely defends against — the
 *   job `COMPLEXITY_BUDGET` structurally cannot do (see that budget's own
 *   doc comment) — is the scalar-list alias attack: 200 aliased
 *   `viewer { library { authors subjects } }` calls measure breadth 800 /
 *   complexity **800** (`cost-limit.test.ts` pins this) — complexity clears
 *   it by miles under its own budget, breadth alone rejects it.
 *
 *   **Correction (task-4-re-review.md, N-2): an earlier version of this
 *   sentence claimed "every attack shape in this schema measures breadth
 *   ≥120" — FALSE, and self-contradicting the paragraph above it, which
 *   already states the two costliest attacks measure breadth 14. Most
 *   attack fixtures in `cost-limit.test.ts` measure breadth 5–14 (the
 *   pagination-cycle family) — complexity, not breadth, is what catches
 *   them, exactly as this file's own catch-split table documents.** The
 *   TRUE, narrower claim, which IS sound: of the attacks breadth is the
 *   SOLE defense against (nothing else in this rule catches them — the
 *   alias-repetition family: 12-alias `searchSuggestions`, 200-alias grid,
 *   the scalar-list attack), the smallest measures breadth 120, and every
 *   legit shape measured tops out at 56 — so "gap to nearest attack" is a
 *   sound argument for THAT specific family, on THIS axis, not a claim
 *   about every attack this rule has ever measured. (See
 *   `COMPLEXITY_BUDGET`'s own doc comment for why the equivalent argument
 *   does NOT hold on the complexity axis at all, task-4-review.md I-1 —
 *   complexity-only attacks and legit traffic overlap continuously, there
 *   is no floor to cite.)
 */
export const BREADTH_BUDGET = 100;

/**
 * **Task 4 — the complexity budget, ENFORCED.** Set at 33,000 (Task 3,
 * `.superpowers/sdd/2026-08-03-cost-calibration-suite/task-3-report.md` —
 * RAISED a third time, from 30,000, after adopting the cost-calibration
 * suite's 70%-headroom ruling: at 30,000 the admin user-list mirror (22,602)
 * and the near-future richer-grid shape (22,283) both exceeded 70% of budget
 * — 75.3% and 74.3% respectively — even though both were already ADMITTED;
 * "admitted" and "admitted with margin" are different properties, and this
 * raise is what makes the calibration suite assert the second one. 30,000
 * was itself RAISED a second time, from 25,000 (final-review.md, I-2), after
 * the whole-branch final review found a REAL shipping screen — the admin
 * user-list mirror, see "Derivation" below — sitting at 91% of the
 * then-current budget and absent from every calibration table; 25,000 was
 * itself RAISED from an initial 17,000 by task-4-review.md, ruling (b),
 * after independent review found THAT number miscalibrated on both sides;
 * see "Corrections from review" below for the full history, kept rather
 * than deleted per this codebase's "corrections edit the original sentence
 * in place" discipline).
 *
 * **Derivation: legit anchors, not "gap to nearest attack."** Unlike
 * `BREADTH_BUDGET` above, complexity's legit and attack ranges are NOT
 * cleanly separated — see "The overlap band" below — so this budget is
 * derived from the highest MEASURED, schema-valid, Task-1-PERMITTED legit
 * traffic, not from a gap to any particular attack number:
 *
 * - **19,103** — the richest calibrated grid fixture (`entries` + the
 *   `Series` arm's `books`, full `BookCard`), paginated with
 *   `entries(first: 100)` — the MAXIMUM page size `CONNECTION_LIMITS.
 *   libraryEntries.maxSize` (`schema/pagination.ts`) and Task 1's
 *   `rejectOversizePage` both explicitly PERMIT. A budget below this number
 *   creates a real contradiction between this validation-time rule and the
 *   resolver-time rule that already allows the identical request
 *   (task-4-review.md, C-2) — a client paginating at the documented maximum
 *   page size must not get a 400 from a DIFFERENT layer of this same plan.
 * - **22,283** — the near-future "richer grid" shape (breadth 56, above),
 *   corrected to valid GraphQL (task-4-review.md, C-1): one more real card
 *   field (`author`), `Validation.messages` (through `edges { node { … } }`,
 *   default page size 20), and one more nesting level, at the connections'
 *   DEFAULT (not maximum) page sizes.
 * - **7,705** — the highest complexity measured among this repo's
 *   PRE-EXISTING, ACCEPT-asserting real-HTTP tests
 *   (`depth-limit-integration.test.ts`'s "two hops of Book → Series → books
 *   off a single `book(id:)` field", `first: 50` — task-4-review.md I-3).
 * - **22,602** — (final-review.md, I-2) the admin user-list mirror,
 *   `viewer { users { library { progress(first: 50) { edges { node {
 *   document percentage device timestamp } } pageInfo { hasNextPage
 *   endCursor } } } } } } }` — the exact four `Progress` fields
 *   `component/user-progress-row` renders, at `Library.progress`'s own
 *   default page size (50), plus the two `pageInfo` fields a paginated
 *   client needs to keep fetching. Unlike the other three anchors, this one
 *   is a REAL, presently-reachable screen — `component/user-progress-row`
 *   above actually renders it, not a hypothetical
 *   or near-future shape — and it was never in any calibration table before
 *   this fix (`cost-limit.test.ts`'s "every legit fixture ACCEPTS" describe
 *   block, below, now carries it permanently). At the then-shipped 25,000
 *   budget it measured 91% — higher than every other anchor here — and one
 *   more `Progress` field (+2,500, `INSTANCE_USER_MULTIPLIER` × the
 *   connection's own multiplier compounding on any addition beneath both)
 *   would have rejected it. See `INSTANCE_USER_MULTIPLIER`'s own doc comment
 *   (above) for why the fix is a budget raise, not a multiplier cut.
 *
 * **Budget: 33,000 (Task 3 derivation).** Per this plan's own headroom
 * ruling (`docs/superpowers/specs/2026-08-03-cost-calibration-suite-design.md`
 * §3): `COMPLEXITY_BUDGET = worst_legit_complexity / 0.70`, rounded UP to a
 * round number, never from gap-to-attack. The worst measured legit anchor,
 * re-confirmed after Task 3's `INSTANCE_DEVICE_MULTIPLIER` raise (20 → 100,
 * above) moved the device-touching fixtures and left this one unchanged, is
 * still **22,602** — the admin user-list mirror, above. 22,602 / 0.70 =
 * 32,288.57 (worst_legit / HEADROOM_FRACTION), rounded up to the nearest
 * round thousand: **33,000**. (32,288.57 is also this task's measured FLOOR
 * of the usable budget window — the cost-calibration-suite ledger's Task 2
 * block records the full window as [32,289, 36,102], ceiling set by
 * separation, not headroom; 33,000 sits inside it with room to the ceiling.)
 * At 33,000: 22,602 is 68.5% of budget, 22,283 is 67.5% — both now clear the
 * suite's 70% headroom line, which is the whole point of this raise. +72.7%
 * over 19,103, +48.1% over 22,283, +46.0% over the top anchor (22,602).
 * Clears every schema-valid legit and near-future shape measured for this
 * task, including the four anchors above. Every committed attack fixture
 * still rejects (re-verified by this raise, `task-3-report.md`'s own
 * separation check; see the catch-split table in `cost-calibration.test.ts`'s
 * "Separation" describe block, which is where the attack corpus now lives).
 *
 * Do NOT read a safety margin into the gap to the nearest committed attack
 * fixture: an earlier revision of this comment claimed "21.2% below the
 * smallest complexity-only attack (36,367)", which is false. A CONSTRUCTIBLE
 * complexity-only attack sits at 30,103 (`library { series { books(first:
 * 100) … } }`) — relative to budget in both cases (task-3-review.md, M-1: an
 * earlier version of this sentence mixed bases, ~0.3% of the OLD budget vs.
 * ~9.6% of the attack's OWN value, not comparable numbers): at the
 * PRE-Task-3 budget (30,000) this sat ~0.3% ABOVE budget (rejected, barely);
 * at 33,000 it now sits ~8.8% BELOW budget (ADMITTED) — an explicit,
 * acknowledged consequence of this raise, not a
 * silent one (design doc §3: "raising the budget widens the overlap band
 * with bounded-cost attack shapes... it does not create a new one" — this
 * shape was never a committed REJECT-asserting fixture, only a prose
 * example of the overlap band described below, and Task 1's per-hop
 * `CONNECTION_LIMITS` still cap its real row count regardless of verdict).
 * One sat ~0% above the previous 25,000 too (25,003).
 *
 * **Quantified (task-3-review.md, (c)): the 30,000→33,000 raise widens the
 * overlap band by +3,000 complexity (+10.0% of the old budget) but only
 * ~+1% in real rows** — the reviewer swept `series → books(first:N)` for
 * `N: 85…110` and `nodes(k ids) → books(first:100)` for `k: 1…120` and found
 * complexity SATURATES at 30,103/30,101 respectively (this cost model
 * already clamps at `CONNECTION_LIMITS.nodesBatch = 100`), so the raise
 * admits the ENTIRE top of both families, not "some more of" them, while the
 * real row count they fetch moves only from ~10,000 (`series →
 * books(first:99)`, 29,803) to ~10,100 (`series → books(first:100)`,
 * 30,103) — Task 1's per-hop caps saturate first, well before this budget's
 * own headroom does.
 *
 * That is the documented
 * overlap band (see "OVERLAP" below), not a regression introduced by this
 * raise, and it is exactly why gap-to-nearest-attack reasoning was
 * abandoned in Task 4: it measures the fixtures we happened to write, not
 * the attack floor.
 *
 * **The principle "no budget may reject a Task-1-permitted shape" (C-2) is
 * satisfiable only loosely, not literally — stated honestly here, not
 * smoothed over (task-4-re-review.md, N-1: an earlier version of this
 * paragraph got the boundary shape's own number wrong by 5×, the same
 * defect class as C-1 one round earlier — a false measurement inside the
 * file the report calls "the source of truth"; corrected in place, not
 * just noted).** Task 1 caps page size PER HOP (each connection's own
 * `first`/`last` independently, ≤100); complexity multiplies ACROSS hops —
 * so the true set of "Task-1-permitted" shapes is unbounded, and no finite
 * complexity budget admits all of it. The worst such shape this task
 * measured — `entries(first: 100)` with the `Series` arm's `books` ALSO at
 * `first: 100`, today's shipped `BookCard` on both — is **172,103**, not
 * the ~34,400 an earlier version of this paragraph named (that number
 * belongs to a DIFFERENT, cheaper shape — `entries(first: 20)` + the
 * Series arm's `books(first: 100)`, only ONE connection at its max, not
 * both — a mis-transcription now corrected). 33,000 does not, and by
 * construction cannot, admit either shape; satisfying the principle
 * literally would require raising the budget to ≥172,103, which would also
 * admit the 2-hop `nodes()` cycle (30,402–40,402) and the single-query
 * suggestions attack (36,367) — i.e. it would delete this rule's coverage
 * of its own named attack family. **The honest restatement: this budget
 * admits every REALISTIC Task-1-permitted shape measured for this task (the
 * anchors above), not every ARITHMETICALLY permitted composition of
 * independently-maxed connections — the validation layer and Task 1's
 * per-hop resolver bounds are DELIBERATELY not coextensive, the same way
 * `MAX_DEPTH` does not admit every depth `rejectOversizePage` would
 * separately allow.**
 *
 * **The nearest counterexample needs no explicit argument at all — a real
 * client-facing trap, flagged here for §Q's own handoff (see that doc's
 * "Query budget" section for the client-facing explanation, corrected by
 * final-review.md I-1 to give the cost MODEL rather than a single magic
 * number).** At `entries(first: 100)`, the `Series` arm's nested `books`
 * connection must stay at `first: 18` or below to clear THIS budget
 * (33,000) with today's shipped `BookCard` (measured: `first: 13` →
 * 24,203, `first: 16` → 29,303, `first: 18` → 32,703, all admitted;
 * `first: 19` → 34,403, rejected — Task 3's raise from 30,000 moved this
 * boundary from 16 to 18, a direct, deliberate consequence of the 70%
 * headroom derivation above, not an oversight; the earlier 25,000 → 30,000
 * raise had already moved it from 13 to 16) — but
 * `CONNECTION_LIMITS.seriesBooks.defaultSize` is **20**, still ABOVE 18. A
 * client that pages the grid at the documented maximum and writes the
 * Series arm's `books` with NO argument at all — the single most natural
 * way to write it, taking the server's own default rather than specifying
 * one — measures **36,103** and still gets a 400 (each raise gave
 * headroom, not a bypass: the no-argument shape sits 3,103 above even this,
 * the third, raised budget). Pinned as committed tests
 * (`cost-calibration.test.ts`'s "Boundary" describe block, where the attack
 * and boundary corpus now lives): `books(first: 13)` accepts (THE
 * BOUNDARY), `books` with no argument (server default 20) rejects (THE
 * TRAP), and a dedicated adjacency proof pins the TRUE current wall exactly
 * (`books(first: 18)` accepts, `books(first: 19)` rejects) — both still
 * true, unchanged in verdict by this budget raise (13 was never the exact
 * boundary these tests claimed to pin, only A value inside the accepted
 * range; the boundary itself moving 13→16→18 across three successive
 * raises is exactly why §Q no longer states a magic number as if it were
 * fixed — see I-1's fix there) — so this boundary cannot drift silently the
 * way the ~34,400 number did.
 *
 * **The overlap band — stated plainly, not implied away.** Complexity-only
 * attack shapes and legitimate paginated traffic overlap CONTINUOUSLY across
 * roughly 15,000–23,000: the identical AST shape (a bounded connection at a
 * large page size) reads as "legit" or "attack" depending only on which
 * field it happens to be rooted at, not on any structural difference this
 * walk can see. Measured (task-4-review.md, I-1): `nodes(ids:[56]) →
 * books(first: 100)` (breadth 5, complexity 16,857) and `series →
 * books(first: 56)` (breadth 7, complexity 16,903, `S` genuinely uncapped —
 * `UNBOUNDED_LIST_MULTIPLIER`'s own assumed-worst-case 100 is what prices
 * `S`, not a real bound on it) sit in the SAME band as this budget's own
 * legit anchors (19,103 / 22,283 / 22,602) and are ADMITTED at 33,000, same
 * as they were at 30,000, at 25,000, and at 17,000 — raising the budget (any
 * of the three times) does not newly admit this family, it was never
 * excluded by any complexity number in the range this project has ever
 * measured. **No complexity
 * threshold in this band can cleanly
 * separate legit traffic from these bounded-cost attack shapes — that is
 * not a gap in this number, it is a property of the metric on this
 * schema.** What makes admitting some attack-shaped queries in this band
 * ACCEPTABLE is Task 1's own `CONNECTION_LIMITS` capping the real row count
 * on every individual connection hop to 100 — `nodes(ids:[56]) →
 * books(first:100)` fetches at most 5,600 real rows, not an unbounded
 * amount — not that this rule discriminates cost by intent. Complexity's
 * real job, proven by the attack table (task-3-report.md §5,
 * `cost-limit.test.ts`'s "budget enforcement" describe), is catching
 * COMPOUNDING across multiple hops (the million-plus-complexity multi-hop
 * cycles) — a coarse ceiling against unbounded amplification, not a
 * fine-grained legit/attack classifier in the tens-of-thousands range. Task
 * 3's own carried debt already named the root cause: `Library.series`'s
 * multiplier (100, `UNBOUNDED_LIST_MULTIPLIER`) is an ASSUMPTION, not a
 * measured bound — now load-bearing rather than merely advisory, because
 * this rule enforces (task-4-review.md, I-1).
 *
 * `Library.entries(first: 999999999)` (breadth 6, complexity 303) clears
 * BOTH budgets by design — Task 1's execution-time `rejectOversizePage` is
 * the layer that stops it, not this validation-time rule (task-3-report §5's
 * own conclusion, unchanged by Task 4).
 *
 * **Why this budget cannot be the only one enforced** (the mirror image of
 * `BREADTH_BUDGET`'s own "why not complexity alone" note): complexity is
 * `FIELD_COST + multiplier × Σchildren` — a scalar leaf field has no
 * sub-selection for any multiplier to act on. Task 3's own handoff
 * (task-3-report.md §5, "Handoff requirement for Task 4") measured this
 * precisely: 200 aliased `viewer { library { authors subjects } }` calls
 * (`Library.subjects`/`Library.authors` are unpaginated scalar lists, no
 * `LIMIT`, `services/book-catalog.ts`'s `getSubjects`/`getAuthors`) score complexity **800** — 2.4% of THIS
 * budget, nowhere near rejecting — while breadth (800) clears
 * `BREADTH_BUDGET` (100) 8× over. Neither number is decorative — each is
 * the ONLY defense against one proven attack family (see
 * `cost-limit.test.ts`'s "both budgets are load-bearing" describe block,
 * which disables each independently and shows the other's own regression
 * tests red without it).
 *
 * **Corrections from review (task-4-review.md), kept in place per this
 * plan's own "corrections edit the original sentence in place" discipline,
 * not deleted:**
 * 1. (C-1) The ORIGINAL 13,483/52 "richer grid" floor was measured from a
 *    fixture that is not valid GraphQL against this schema (`messages {
 *    severity message }` selected directly on `ValidationMessagesConnection`
 *    instead of through `edges { node { … } }}`) — it validated only because
 *    the ACCEPT test ran `costLimitRule` in isolation, where
 *    `FieldsOnCorrectType` never fires; over real HTTP the same document is
 *    a 400. The schema-valid rewrite measures 56/22,283, not 52/13,483.
 *    Corrected: `cost-limit.test.ts`'s `accepts()` helper now asserts
 *    `specifiedRules` validity for every ACCEPT fixture, not just this one.
 * 2. (C-2) 17,000 rejected `entries(first: 100)` on the richest grid
 *    (19,103) — a page size Task 1's own `rejectOversizePage` explicitly
 *    permits. Corrected: 25,000 clears it.
 * 3. (I-1) The original "gap to nearest attack" framing for THIS axis
 *    (20,200, 200×`nodes(ids:[100])`) was doubly wrong: that attack is
 *    independently breadth-caught (400 > 100) so it never constrained
 *    complexity at all, AND the replacement "nearest complexity-only
 *    ceiling" (36,367) was also not real — complexity-only-admitted shapes
 *    exist continuously below it (15,051 / 16,857 / 16,903, all still
 *    admitted at 25,000). Corrected: derivation now anchors on legit
 *    traffic only ("Derivation: legit anchors" above), and the overlap band
 *    is stated explicitly rather than implying a clean corridor exists.
 * 4. (final-review.md, I-2) A whole-branch review measured a REAL admin
 *    screen — `viewer { users { library { progress(first: 50) { … } } } }`
 *    (`component/user-progress-row`'s exact fields) — at complexity 22,602,
 *    91% of the then-shipped 25,000 and higher than every anchor that
 *    number was derived from; it was in no calibration table. Two fixes
 *    were possible: shrink `INSTANCE_USER_MULTIPLIER` (would under-price
 *    the genuine worst case a larger self-hosted deployment could reach),
 *    or add the anchor and raise the budget with real headroom. Corrected:
 *    `INSTANCE_USER_MULTIPLIER` kept at 50 (see its own doc comment for the
 *    stated deployment-size reasoning), `COMPLEXITY_BUDGET` raised to
 *    30,000 (see "Derivation" above for the anchor and margin math), and
 *    the admin user-list mirror added permanently to `cost-limit.test.ts`'s
 *    calibration describe block so it can never again go unmeasured.
 * 5. (Task 3, `task-3-report.md`) The cost-calibration suite's 70%-headroom
 *    ruling (`.superpowers/sdd/2026-08-03-cost-calibration-suite`) found the
 *    admin user-list mirror (22,602, 75.3% of 30,000) and the near-future
 *    richer-grid shape (22,283, 74.3%) both ADMITTED but both over the new
 *    70% line — "admitted" and "admitted with margin" are different
 *    properties, and 30,000 only proved the first for these two. Order
 *    matters here (the plan's own binding rule): `INSTANCE_DEVICE_MULTIPLIER`
 *    was re-derived FIRST (20 → 100, its own doc comment above), the suite
 *    was RE-MEASURED (worst legit anchor unchanged at 22,602 — the device
 *    raise moved the device-touching fixtures but not the worst one), and
 *    only THEN was the budget derived from that measurement: 22,602 / 0.70 =
 *    32,288.57, rounded up to 33,000. Every attack fixture re-verified
 *    rejecting at 33,000 (`cost-calibration.test.ts`'s "Separation" describe
 *    block); both deferred headroom assertions (`it.fails()`,
 *    `cost-calibration.test.ts`) now pass and were flipped to plain,
 *    always-enforced assertions.
 * 6. (task-3-review.md, I-1/I-2) Review of item 5's own commit found two
 *    documentation/naming residues, no number wrong: (I-1) the
 *    `deferredToTask3` deferral scaffolding item 5 cleared survived as dead
 *    code with a stale "TODAY's numbers (`COMPLEXITY_BUDGET = 30_000`)"
 *    comment — deleted outright (`cost-calibration.test.ts`), not left
 *    dormant, per this codebase's "a guardrail never seen to fail is not
 *    known to work" discipline extended to its logical conclusion: scaffolding
 *    no fixture can ever reach again is not worth keeping either. (I-2) the
 *    device multiplier's own name, `HOUSEHOLD_DEVICE_MULTIPLIER`, contradicted
 *    its own re-derivation (item 5: explicitly instance-scale, not household
 *    scale) — renamed to `INSTANCE_DEVICE_MULTIPLIER` throughout, mechanical,
 *    number unchanged.
 */
export const COMPLEXITY_BUDGET = 33_000;

/** `extensions.code`/`extensions.http.status` for a breadth-budget rejection — same shape convention `pagination.ts`'s `PAGE_SIZE_EXCEEDED` and `builder.ts`'s `UNAUTHENTICATED`/`FORBIDDEN` already use (`{ code, http: { status } }`), and the same CODE NAMING `@pothos/plugin-complexity`'s own validator seam used (task-2-report.md, probe 6 — `QUERY_DEPTH`/`QUERY_BREADTH`/`QUERY_COMPLEXITY`) — reused here for the naming, not the plugin's behavior (that seam shipped no `http.status` at all, one of the gaps this rule closes). `depth-limit.ts`'s own `GraphQLError` carries NO explicit `extensions` (it relies on graphql-js/yoga's default `GRAPHQL_VALIDATION_FAILED` + content-negotiated status) — this rule sets one explicitly so a client (the eventual Apollo `errorLink`) can distinguish "you asked for too much" from an ordinary validation typo, the same way `PAGE_SIZE_EXCEEDED` already distinguishes an over-max page from one. */
const breadthBudgetError = (breadth: number, node: OperationDefinitionNode): GraphQLError =>
  new GraphQLError(
    `Query breadth ${breadth} exceeds the maximum allowed (${BREADTH_BUDGET}). ` +
      'Split this into smaller operations, request fewer aliased copies of the same fields, ' +
      'or request fewer nested connections.',
    { nodes: node, extensions: { code: 'QUERY_BREADTH', http: { status: 400 } } }
  );

/** `complexity`'s counterpart to `breadthBudgetError` — same shape convention, distinct code. */
const complexityBudgetError = (complexity: number, node: OperationDefinitionNode): GraphQLError =>
  new GraphQLError(
    `Query complexity ${complexity} exceeds the maximum allowed (${COMPLEXITY_BUDGET}). ` +
      'Request smaller pages (lower `first`/`last`) or fewer nested connections.',
    { nodes: node, extensions: { code: 'QUERY_COMPLEXITY', http: { status: 400 } } }
  );

/**
 * A graphql-js `ValidationRule` factory, the same `addValidationRule` seam
 * `depthLimitRule` uses. **Task 4 arms this rule**: Task 3 shipped it
 * LOG-ONLY (never called `context.reportError`); it now enforces BOTH
 * `BREADTH_BUDGET` and `COMPLEXITY_BUDGET`, independently — a query over
 * EITHER budget is rejected, and a query over BOTH gets two distinct errors
 * (one per axis), never silently coalesced into one, so a client sees
 * exactly what it exceeded. This is a hard requirement, not a style choice
 * (task-3-report.md §5's headline + its round-3 "Handoff requirement for
 * Task 4" subsection, reproduced in both budgets' own doc comments above):
 * breadth is structurally blind to the pagination-cycle attack family
 * (the costliest proven attacks measure breadth 14, comfortably under 100);
 * complexity is structurally blind to the scalar-list alias family (a
 * scalar leaf has no sub-selection for any multiplier to act on). Shipping
 * either budget alone reopens the OTHER family — see the "both budgets are
 * load-bearing" describe block in `cost-limit.test.ts` for the seen-to-fail
 * proof (each budget disabled independently, in turn).
 *
 * `onMeasured` still fires for EVERY operation, unconditionally — accepted
 * or rejected — the same "measurement pass" behavior Task 3 shipped
 * (`yoga-plugins.ts`'s `useCostLimit` logs `{operationName, breadth,
 * complexity}` at info regardless of verdict; a rejection is what an
 * operator most wants visibility into, not less of it).
 *
 * This rule does NOT log a WARN line itself for a rejection — it doesn't
 * need to. `context.reportError` feeds into the SAME `ValidationContext`
 * every validation rule in this pipeline shares, and `useOperationLogging`
 * (yoga-plugins.ts)'s own `onValidate` hook already observes that shared
 * result as a whole (not per-rule) and logs exactly one WARN line —
 * `{operationName, viewerId, durationMs, errorCount}`, no query text — for
 * ANY rejected operation, regardless of which rule(s) rejected it. This is
 * the identical mechanism `depth-limit.ts`'s own rejections already ride
 * (task-3 review's own M-4 finding: "one warn line per validation rejection
 * is the cheapest attack signal available"). The moment this rule starts
 * calling `context.reportError`, its rejections get that same WARN line for
 * free, with zero new logging code — `cost-limit-integration.test.ts` pins
 * that this rule's own rejection really does reach it.
 *
 * Takes no `schema` parameter (task-3-review, M-2) — `context.getSchema()`
 * already provides the schema this same `validate()` call was invoked with,
 * so threading a module-level singleton in from `yoga.ts` was a seam this
 * rule didn't need and would silently diverge from the moment another
 * plugin wraps or transforms the schema before validation runs.
 *
 * Skips introspection-ONLY operations entirely (`isIntrospectionOnly`,
 * above) — task-3-review, I-3: `getIntrospectionQuery()` measures breadth
 * 220 / complexity 220, well past EITHER budget, for the same reason
 * `depth-limit.ts`'s `depthLimitRule` skips it (see `isIntrospectionOnly`'s
 * doc comment) — a budget derived from real-screen maxima must not also
 * reject GraphiQL's own schema-fetch in dev (verified end-to-end,
 * `cost-limit-integration.test.ts`, not just asserted at the unit level).
 * A query that merely INCLUDES `__schema` alongside real fields is NOT
 * exempt — `isIntrospectionOnly` requires EVERY top-level selection to be a
 * meta-field, pinned by `cost-limit.test.ts`.
 *
 * Never throws: `costOfSelectionSet` cannot recurse unboundedly on a cyclic
 * fragment (`resolveFragment`'s in-progress guard breaks the cycle, same as
 * `depth-limit.ts`'s), and an unresolvable field/fragment/type condition is
 * skipped rather than treated as an error (`fieldDefOf` returning
 * `undefined`, or the `fragments[name]` miss above) — those are other
 * rules' problems (`FieldsOnCorrectType`, `KnownFragmentNames`), exactly the
 * discipline `depth-limit.ts` already documents for the same cases. Budget
 * violations are reported via `context.reportError` (a clean GraphQL
 * validation error), never a JS `throw` — the same "report through
 * `ValidationContext`, never throw" discipline every other rule in this
 * codebase's validation pipeline follows.
 *
 * Deliberately does NOT itself report a cyclic fragment as a validation
 * error the way `depth-limit.ts` does: `depth-limit.ts` is wired
 * UNCONDITIONALLY in `yoga.ts` (ahead of this rule in the `plugins:` array),
 * so any cyclic-fragment document is already rejected with a clean error
 * (in practice TWO: `depth-limit.ts`'s own `onCycle` report AND graphql-js's
 * built-in `NoFragmentCycles` both fire independently — task-3-review, M-1;
 * pre-existing on `main`, not introduced here) before this rule's own
 * silence could matter — reporting a third copy here would only add MORE
 * noise, not a missing layer of protection. What this rule DOES own,
 * independently, is not CRASHING on the same document; `cost-limit.test.ts`
 * pins that directly (seen-to-fail against a memo-less version), the same
 * way `depth-limit.test.ts` pins it for depth.
 *
 * One `onMeasured` call, and up to two `reportError` calls, per
 * `OperationDefinition` in the document, not per EXECUTED operation
 * (task-3-review, M-4) — a document naming N operations (only one of which
 * `operationName` selects to run) is fully measured, and fully enforced,
 * for all N. Bounded by the 100KB body-size cap and arguably correct (every
 * defined operation's shape gets recorded and enforced, not just the
 * winner), but it is a log-volume knob a client controls; worth a line in
 * the Task-5 handoff docs, not fixed here.
 */
export const costLimitRule =
  (onMeasured: (operationName: string, cost: OperationCost) => void) =>
  (context: ValidationContext): ASTVisitor => {
    const schema = context.getSchema();
    const fragments: Record<string, FragmentDefinitionNode> = {};
    for (const definition of context.getDocument().definitions) {
      if (definition.kind === Kind.FRAGMENT_DEFINITION)
        fragments[definition.name.value] = definition;
    }
    const memo: CostMemo = createFragmentWalkMemo(() => {});

    return {
      OperationDefinition(node: OperationDefinitionNode) {
        if (isIntrospectionOnly(node.selectionSet)) return;
        const cost = costOfSelectionSet(
          node.selectionSet,
          rootTypeOf(schema, node.operation),
          fragments,
          schema,
          memo
        );
        onMeasured(node.name?.value ?? 'anonymous', cost);
        if (cost.breadth > BREADTH_BUDGET)
          context.reportError(breadthBudgetError(cost.breadth, node));
        if (cost.complexity > COMPLEXITY_BUDGET)
          context.reportError(complexityBudgetError(cost.complexity, node));
      },
    };
  };
