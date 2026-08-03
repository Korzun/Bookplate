import {
  FragmentDefinitionNode,
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
 * one depth enforcer. This file is LOG-ONLY this task: it never calls
 * `context.reportError` and rejects nothing — see `costLimitRule` below.
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
 * The full sweep this finding required (`grep`-level inventory of every
 * non-connection list field returning a non-scalar type, `schema.generated.graphql`):
 * of ~24 such fields, MOST are safe with no code change — their element
 * type is scalar-only (`Book.identifiers` → `Identifier {scheme, value}`,
 * `PendingFixState.autoFixes`/`appliedFixes`/`proposals` → `MetadataFix`,
 * `EpubValidationError.messages`/`BookAnalyzeReplacePayload.messages` →
 * `EpubValidationMessage`, `InvalidInputError.issues` → `InputIssue`,
 * `UndoSnapshot.appliedFixes`/`proposals` → `MetadataFix`,
 * `BookUnlinkDocumentPayload.identifiers` → `IdentifierInput`) — there is
 * nothing further under them to multiply, so pricing them above 1 would
 * inflate the calibration record for no real risk, the same "don't invent
 * a number where there's nothing to multiply" discipline
 * `CONNECTION_FIELD_LIMITS` already follows. One more is safe with EVIDENCE
 * rather than by leaf-type inspection: `Library.searchSuggestions` /
 * `SuggestionGroup.items` reaches `Suggestion.book: Book` (which DOES reach
 * `Book.series.books`) but is genuinely bounded — `getSearchSuggestions`
 * (`services/book-store.ts:188-261`) caps every branch at `LIMIT 30`, at
 * most 4 groups, ≤120 rows total, a real code-enforced ceiling, not an
 * assumption.
 *
 * The seven fields below all reach further amplifiable content AND have no
 * code-enforced ceiling — before this fix, EVERY ONE of them priced at the
 * default multiplier of 1 (i.e. completely unpriced; none of them restates
 * an existing bound the way `CONNECTION_FIELD_LIMITS` does):
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
 *  - `Book.lineage` — delegates to `BookStore.getBookLineage`, no cap
 *    visible at the schema layer (`book/model.ts:270-278`); reaches
 *    `LinkedDocument.{oldBook,newBook}.series.books`.
 *  - `ScanResult.imported` — `findMany({where:{id:{in:importedBookIds}}})`;
 *    the `findMany` itself is bounded by `importedBookIds`, but that id
 *    list has no cap and scales with scan size (`scan-result/model.ts:32-47`);
 *    reaches `Book.series.books`. Reachable via `Library.scanStatus`,
 *    `libraryScan`'s mutation payload, and the `scanProgress` subscription.
 *
 * None of these has a REST precedent or a measured real-world bound —
 * exactly the position `Query.nodes(ids:)` was in before Task 1
 * (`pagination.ts`'s own doc comment: "NO REST or client precedent... Set
 * to the largest per-page ceiling established for any single connection
 * above"). Reusing that SAME shared reference point (100, `nodesBatch`)
 * here, rather than inventing seven new unmeasured numbers, is the
 * identical choice Task 1 already made for exactly this situation — an
 * assumed worst case, stated as such, not a measured one.
 */
const UNBOUNDED_LIST_MULTIPLIER = CONNECTION_LIMITS.nodesBatch;

const UNBOUNDED_LIST_FIELD_LIMITS: Record<string, { maxSize: number; defaultSize: number }> = {
  'Library.series': { maxSize: UNBOUNDED_LIST_MULTIPLIER, defaultSize: UNBOUNDED_LIST_MULTIPLIER },
  'Library.pendingFixes': {
    maxSize: UNBOUNDED_LIST_MULTIPLIER,
    defaultSize: UNBOUNDED_LIST_MULTIPLIER,
  },
  'Viewer.users': { maxSize: UNBOUNDED_LIST_MULTIPLIER, defaultSize: UNBOUNDED_LIST_MULTIPLIER },
  'Viewer.devices': { maxSize: UNBOUNDED_LIST_MULTIPLIER, defaultSize: UNBOUNDED_LIST_MULTIPLIER },
  'Device.enabledUsers': {
    maxSize: UNBOUNDED_LIST_MULTIPLIER,
    defaultSize: UNBOUNDED_LIST_MULTIPLIER,
  },
  'Book.lineage': { maxSize: UNBOUNDED_LIST_MULTIPLIER, defaultSize: UNBOUNDED_LIST_MULTIPLIER },
  'ScanResult.imported': {
    maxSize: UNBOUNDED_LIST_MULTIPLIER,
    defaultSize: UNBOUNDED_LIST_MULTIPLIER,
  },
};

/**
 * The single lookup `multiplierFor` reads — `CONNECTION_FIELD_LIMITS` and
 * `UNBOUNDED_LIST_FIELD_LIMITS` are documented separately (genuine
 * `first`/`last`-bearing connections vs. assumed-worst-case plain lists)
 * because their NUMBERS have different provenance, but they are read
 * through one map so `multiplierFor` doesn't need to know which kind of
 * field it found — `pageSizeMultiplier` already does the right thing for a
 * field with no `first`/`last` argument at all (both read as `undefined`,
 * falling through to `defaultSize`, which for every
 * `UNBOUNDED_LIST_FIELD_LIMITS` entry equals its own `maxSize`).
 */
const FIELD_MULTIPLIER_LIMITS: Record<string, { maxSize: number; defaultSize: number }> = {
  ...CONNECTION_FIELD_LIMITS,
  ...UNBOUNDED_LIST_FIELD_LIMITS,
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
 * except the twelve `FIELD_MULTIPLIER_LIMITS` prices: five real,
 * `first`/`last`-bearing connections and seven unbounded plain lists
 * (`UNBOUNDED_LIST_FIELD_LIMITS`, above — task-3-review round 2, I-4).
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
 * A graphql-js `ValidationRule` factory, the same `addValidationRule` seam
 * `depthLimitRule` uses — but this one calls `context.reportError` NEVER.
 * LOG-ONLY this task (query-cost-control plan, task 3): it computes
 * `{breadth, complexity}` per operation and hands them to `onMeasured`
 * rather than rejecting anything, so `yoga-plugins.ts`'s `useCostLogging`
 * can log them without this rule owning a budget yet.
 *
 * Takes no `schema` parameter (task-3-review, M-2) — `context.getSchema()`
 * already provides the schema this same `validate()` call was invoked with,
 * so threading a module-level singleton in from `yoga.ts` was a seam this
 * rule didn't need and would silently diverge from the moment another
 * plugin wraps or transforms the schema before validation runs.
 *
 * Skips introspection-ONLY operations entirely (`isIntrospectionOnly`,
 * above) — task-3-review, I-3: `getIntrospectionQuery()` measures breadth
 * 220, more than 5× this task's own calibrated legit max, for the same
 * reason `depth-limit.ts`'s `depthLimitRule` skips it (see
 * `isIntrospectionOnly`'s doc comment). A future Task-4 budget derived from
 * "legit max ~41" must not also reject GraphiQL's own schema-fetch in dev.
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
 * discipline `depth-limit.ts` already documents for the same cases.
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
 * One `onMeasured` call per `OperationDefinition` in the document, not per
 * EXECUTED operation (task-3-review, M-4) — a document naming N operations
 * (only one of which `operationName` selects to run) logs N lines. Bounded
 * by the 100KB body-size cap and arguably correct for a measurement pass
 * (every defined operation's shape gets recorded, not just the winner), but
 * it is a log-volume knob a client controls; worth a line in the Task-5
 * handoff docs, not fixed here.
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
      },
    };
  };
