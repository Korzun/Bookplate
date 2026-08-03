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
 * `library/model.ts:267-275`) at the default multiplier of 1, handing a
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
 *    (`library/model.ts:267-275`); reaches `Series.books`.
 *  - `Library.pendingFixes` — `findMany({where:{userId}})`, no cap
 *    (`library/model.ts:411-423`); reaches `PendingFix.book.series.books`.
 *  - `Viewer.users` — `findMany({})`, no `where` clause AT ALL (every user
 *    on the instance), admin-only (`viewer/model.ts:67-73`); reaches
 *    `User.library.{entries,progress,series,pendingFixes}` — i.e. it can
 *    chain into every other field this map prices, once per user.
 *  - `Viewer.devices` — `findMany`, no cap on either branch
 *    (`viewer/model.ts:127-140`); reaches `Device.enabledUsers`.
 *  - `Device.enabledUsers` — `findMany`, no cap, admin-only
 *    (`device/model.ts:87-97`); reaches `User.library.*`, same as
 *    `Viewer.users` above but scoped to one device.
 *  - `Book.lineage` — I-7. See `BOOK_LINEAGE_MULTIPLIER` below; delegates to
 *    `BookStore.getBookLineage` (`book/model.ts:270-278`); reaches
 *    `LinkedDocument.{oldBook,newBook}.series.books`.
 *  - `ScanResult.imported` — `findMany({where:{id:{in:importedBookIds}}})`;
 *    the `findMany` itself is bounded by `importedBookIds`, but that id
 *    list has no cap and scales with scan size (`scan-result/model.ts:32-47`);
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
 * (`services/book-store.ts:530-559`) is `SELECT old_id, timestamp, type
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
 * (`device/model.ts:87-97`) is `user.findMany({where:{deviceAccess:{some:
 * {deviceId}}}})`, a SUBSET of the instance's users, which cannot exceed
 * `Viewer.users`'s own count — so both now share
 * `INSTANCE_USER_MULTIPLIER`. (Previously `Device.enabledUsers` used a
 * separate, tighter `HOUSEHOLD_DEVICE_MULTIPLIER`, with no code, REST, or
 * schema basis for pricing a subset of the instance's users more tightly
 * than the instance's users themselves — on a 50-user instance a single
 * shared device can legally return up to 50 rows.) `Viewer.devices` keeps
 * its own `HOUSEHOLD_DEVICE_MULTIPLIER` — a genuinely different quantity
 * (device count, not user count) — but round-3 also records, for Task 4,
 * that `Viewer.devices` is **NOT household-scoped for an admin caller**:
 * `viewer/model.ts:127-140` runs `device.findMany({orderBy})` with **no
 * `where`** when the viewer is an admin — every device on the instance, not
 * one household's e-readers; the household framing below holds only for
 * the non-admin branch, and an admin-scale instance (e.g. 60 users × 1-2
 * readers ⇒ 60-120 devices) plausibly exceeds the assumed 20.
 *
 * The `Viewer.devices`/`Device.enabledUsers` compounding shape this task
 * exists to fix — round-3, M-9, correcting an overstated claim in an
 * earlier version of this comment: `devices { … enabledUsers { … } }` is
 * NOT a query the client ships today. `app/client/src/page/device-list/`
 * (`component/device-list/index.tsx`) fetches exactly the 8 fields
 * `app/client/src/provider/device/type.ts`'s `Device` type declares (`id
 * name slug coverWidth coverHeight coverFit bwCover simplify`) — it never
 * requests `enabledUsers` at all. `GET /api/devices/:id/users`
 * (`routes/devices.ts:178`) is fetched separately, per-device, by
 * `component/device-form`'s `useDeviceUsers` when an admin edits ONE
 * device. `devices { … enabledUsers { … } }` is a PLAUSIBLE GraphQL
 * consolidation of those two real REST reads, not a shipped query — real
 * cardinality on a self-hosted instance is still roughly 2-6 devices ×
 * 1-5 users each (a household's e-readers, non-admin branch), and
 * `Viewer.devices` × `Device.enabledUsers` at the PRE-round-2 flat 100×100
 * scored complexity 20,402 — 5.3× the (then-stale) legit ceiling — for
 * ~15 real rows either way. No REST endpoint, admin UI, or schema
 * constraint caps device or user count numerically (confirmed:
 * `routes/users.ts`'s own `GET /users` is equally unpaginated), so
 * `HOUSEHOLD_DEVICE_MULTIPLIER`/`INSTANCE_USER_MULTIPLIER` are ASSUMED, not
 * measured or sourced from code — stated as such, not disguised as a real
 * bound — but chosen an order of magnitude below the library-scale 100 to
 * reflect that a self-hosted server's household/instance user count is
 * genuinely a smaller-scale quantity than its book catalog:
 * `HOUSEHOLD_DEVICE_MULTIPLIER = 20` for `Viewer.devices` (headroom for a
 * large household's e-reader collection), and `INSTANCE_USER_MULTIPLIER =
 * 50` for `Viewer.users`/`Device.enabledUsers` (headroom for a larger
 * shared instance — e.g. a small book club or extended family).
 */
const UNBOUNDED_LIST_MULTIPLIER = CONNECTION_LIMITS.nodesBatch;
const HOUSEHOLD_DEVICE_MULTIPLIER = 20;
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
    maxSize: HOUSEHOLD_DEVICE_MULTIPLIER,
    defaultSize: HOUSEHOLD_DEVICE_MULTIPLIER,
  },
  // M-8: shares Viewer.users's multiplier, not HOUSEHOLD_DEVICE_MULTIPLIER —
  // enabledUsers is a SUBSET of the instance's users (device/model.ts:87-97's
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
 * (`services/book-store.ts:172-301`) caps every branch at `LIMIT 30`
 * (4 occurrences: `book-store.ts:195,227,253,265`, one per suggestion
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
 * `groups.push(...)` sites, `book-store.ts:202` (`author`), `:234`
 * (`series`), `:274` (`book`), `:291` (`subject`), each behind its own
 * guard and pushed at most once (full function: `book-store.ts:172-301`);
 * each group's `items` is capped at `LIMIT 30`.
 * `Suggestion.book` (`schema/suggestion/model.ts:33-40`) only resolves a
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
 * `last`, same as `first` — `rejectOversizePage`, `pagination.ts:66-81`), so
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
 * `depth-limit.ts` does not export its own copy of this check (and stays
 * byte-identical to base per the CONTROLLER RULING, so it cannot be made to
 * export one) — this is a second, deliberately duplicated copy, same
 * disposition as `fragment-walk-memo.ts` vs `depth-limit.ts`'s own memo
 * (task-3-review.md, I-2): re-derived because the source can't be imported
 * from, not extracted. Carried debt: if either copy's definition of
 * "introspection-only" ever changes, the other needs the same edit by hand.
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
 *   real field on the shared card, `author`, plus one more nesting level —
 *   `.superpowers/sdd/2026-08-02-query-cost-control/probes/rereview4/verify.ts`)
 *   at **breadth 52**. 52 is the highest MEASURED plausible-legit number and
 *   the one this budget must clear — `cost-limit.test.ts` asserts both
 *   near-future shapes ACCEPT.
 * - **Margin.** The reviewer's own recommendation (task-3-re-review-4.md):
 *   ~2× the near-future max (40–52), landing at 100 — "leaving room for one
 *   more field or one more nesting level without landing exactly on the
 *   line," the same F-1 lesson `depth-limit.ts`'s own recalibration comment
 *   already paid for once (a budget set AT the observed legit max is a
 *   production outage waiting for one new field).
 * - **Budget: 100.**
 * - **Gap to nearest attack.** The alias-repetition family sits at breadth
 *   120 (12-aliased `searchSuggestions`), 400 (200×`nodes(ids:[100])`), and
 *   3200 (200-alias grid fan-out) — 100 clears the near-future legit max
 *   with 2× margin AND sits 20 below the SMALLEST of those (120), a real
 *   gap, not a coin-flip boundary. (That smallest one, 120, is also caught
 *   independently by `COMPLEXITY_BUDGET` below at 436,404 — losing no
 *   coverage even though its own breadth margin over 100 is comparatively
 *   thin.) The two costliest PROVEN attacks (the 3-hop `nodes()` cycle, the
 *   Series-arm 2-hop) measure breadth **14** — below even the OLD legit max
 *   of 41, let alone 100 — confirming (task-3-report.md §5) that breadth
 *   cannot be this budget's only defense against them; `COMPLEXITY_BUDGET`
 *   is what catches those two. What breadth's 100 uniquely defends against —
 *   the job `COMPLEXITY_BUDGET` structurally cannot do (see that budget's
 *   own doc comment) — is the scalar-list alias attack: 200 aliased
 *   `viewer { library { authors subjects } }` calls measure breadth 800 /
 *   complexity **800** (`cost-limit.test.ts` pins this) — complexity clears
 *   it by miles under its own budget, breadth alone rejects it.
 */
export const BREADTH_BUDGET = 100;

/**
 * **Task 4 — the complexity budget, ENFORCED.** Measured max → margin →
 * budget → gap to nearest attack:
 *
 * - **Measured max (legit).** Task 3's own table records complexity 84–3823
 *   (the richest SHIPPED grid fixture). But — same recalibration as
 *   `BREADTH_BUDGET` above, and for the identical reason (a budget set from
 *   "today's shipped max" alone repeats the F-1 mistake the moment one more
 *   real field lands) — the richer-grid near-future fixture measured above
 *   scores complexity **13,483**, not 3823: one more real card field
 *   (`author`) plus `validation.messages` plus one more nesting level pushes
 *   a plausible near-future screen 3.5× past the "shipped today" number.
 *   **13,483 is this budget's real floor, not 3823** — `cost-limit.test.ts`
 *   asserts this exact fixture ACCEPTS, alongside the `BookCard`-on-lineage
 *   near-future shape (complexity 724, comfortably clear) and the labeled
 *   PLAUSIBLE device-list + `enabledUsers` consolidation (2,182).
 * - **Margin.** Unlike breadth's wide-open corridor (52 legit vs. 120
 *   smallest attack — room for a full 2×), complexity's corridor is
 *   genuinely narrow: the nearest attack this project has ever measured is
 *   **20,200** (200×`nodes(ids:[100])`, the ledger's own N-1 probe) — only
 *   1.5× the near-future legit max of 13,483. A 2×-style margin (≈27,000)
 *   would land ABOVE the attack and admit it; that is not available here,
 *   and pretending otherwise would be inventing headroom the measurements
 *   don't support. The honest number sits inside the corridor with real
 *   space on both sides: **17,000** is +26.1% over the 13,483 legit floor
 *   and −15.8% below the 20,200 attack floor — not landing exactly on
 *   either line, the same non-negotiable the breadth budget above and
 *   `depth-limit.ts`'s own `MAX_DEPTH` recalibration both insist on, even
 *   though the available room is smaller on this axis.
 * - **Budget: 17,000.**
 * - **Gap to nearest attack: 3,200 (20,200 − 17,000), 15.8% below it.**
 *   Every OTHER measured attack clears this budget by 2–3 orders of
 *   magnitude (40,402 for the 2-hop-from-`nodes()` cycle up to 4,040,402 for
 *   the 3-hop cycle) — 20,200 is the single tightest gap in the whole attack
 *   table, which is why it, not one of the million-plus rows, sets the
 *   ceiling on how much margin this budget can safely claim.
 *   `Library.entries(first: 999999999)` (breadth 6, complexity 303) clears
 *   BOTH budgets by design — Task 1's execution-time `rejectOversizePage`
 *   is the layer that stops it, not this validation-time rule (task-3-report
 *   §5's own conclusion, unchanged by Task 4).
 *
 * **Why this budget cannot be the only one enforced** (the mirror image of
 * `BREADTH_BUDGET`'s own "why not complexity alone" note): complexity is
 * `FIELD_COST + multiplier × Σchildren` — a scalar leaf field has no
 * sub-selection for any multiplier to act on. Task 3's own handoff
 * (task-3-report.md §5, "Handoff requirement for Task 4") measured this
 * precisely: 200 aliased `viewer { library { authors subjects } }` calls
 * (`Library.subjects`/`Library.authors` are unpaginated scalar lists, no
 * `LIMIT`, `book-store.ts:155-169`) score complexity **800** — 21% of THIS
 * budget, nowhere near rejecting — while breadth (800) clears
 * `BREADTH_BUDGET` (100) 8× over. Complexity would need ~950 aliases of the
 * same shape before it noticed; breadth catches it at ~13. Neither number
 * is decorative — each is the ONLY defense against one proven attack family
 * (see `cost-limit.test.ts`'s "both budgets are load-bearing" describe
 * block, which disables each independently and shows the other's own
 * regression tests red without it).
 */
export const COMPLEXITY_BUDGET = 17_000;

/** `extensions.code`/`extensions.http.status` for a breadth-budget rejection — same shape convention `pagination.ts`'s `PAGE_SIZE_EXCEEDED`/`BACKWARD_PAGINATION_UNSUPPORTED` and `builder.ts`'s `UNAUTHENTICATED`/`FORBIDDEN` already use (`{ code, http: { status } }`), and the same CODE NAMING `@pothos/plugin-complexity`'s own validator seam used (task-2-report.md, probe 6 — `QUERY_DEPTH`/`QUERY_BREADTH`/`QUERY_COMPLEXITY`) — reused here for the naming, not the plugin's behavior (that seam shipped no `http.status` at all, one of the gaps this rule closes). `depth-limit.ts`'s own `GraphQLError` carries NO explicit `extensions` (it relies on graphql-js/yoga's default `GRAPHQL_VALIDATION_FAILED` + content-negotiated status) — this rule sets one explicitly so a client (the eventual Apollo `errorLink`) can distinguish "you asked for too much" from an ordinary validation typo, the same way `PAGE_SIZE_EXCEEDED` already lets it distinguish that from `BACKWARD_PAGINATION_UNSUPPORTED`. */
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
