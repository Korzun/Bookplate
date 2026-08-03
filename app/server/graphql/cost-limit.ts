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
 * field EXCEPT the four connections `CONNECTION_LIMITS` already bounds
 * (`Library.entries`, `Library.progress`, `Series.books`,
 * `Validation.messages`) and `Query.nodes(ids:)`, where it is the field's
 * effective page size / batch size — see `multiplierFor` below.
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

/** Reads a literal `Int` argument's value off a `Field` AST node. `undefined` = argument absent or explicit `null`; `'variable'` = present but not a literal we can read at validation time (a `$variable`) — `multiplierFor` treats both non-literal cases conservatively, never by guessing the runtime value. */
const literalIntArg = (field: FieldNode, argName: string): number | 'variable' | undefined => {
  const arg = field.arguments?.find((a) => a.name.value === argName);
  if (!arg || arg.value.kind === Kind.NULL) return undefined;
  if (arg.value.kind === Kind.INT) return Number.parseInt(arg.value.value, 10);
  return 'variable';
};

/**
 * The args-aware multiplier for one field occurrence — `1` for every field
 * except the five this module knows are bounded, real-page-size-carrying
 * fields.
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
 * Connections: a literal `first` is clamped to `[1, maxSize]` — never left
 * unclamped, so a single `first: 999999999` (Task 1 already rejects this at
 * EXECUTION time, in the resolver — this rule runs at VALIDATION time,
 * before Task 1's guard ever sees it) reports a sane, bounded multiplier
 * rather than a nine-digit one. Omitted `first` uses `defaultSize` — the
 * CONTROLLER RULING's own instruction (query-cost-control ledger) —  a
 * variable-valued `first` (can't be read at validation time; `graphql-js`
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
    ? CONNECTION_FIELD_LIMITS[`${parentTypeName}.${fieldName}`]
    : undefined;
  if (!limits) return 1;
  const first = literalIntArg(field, 'first');
  if (first === undefined) return limits.defaultSize;
  if (first === 'variable') return limits.maxSize;
  return Math.min(Math.max(first, 1), limits.maxSize);
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

/**
 * Exposed for `cost-limit.test.ts`'s direct measurement assertions and the
 * calibration probes — mirrors `depth-limit.ts`'s `measureOperationDepth`.
 * Each call gets its own fresh memo with a no-op `onCycle`: a cyclic
 * fragment here just measures as contributing `{breadth: 0, complexity: 0}`
 * at the cycle point (this function has no `ValidationContext` to report
 * through, and — unlike `depth-limit.ts` — `costLimitRule` below does not
 * report cycles either; see its own doc comment for why that is still
 * correct, not a gap).
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
    {
      cache: new Map(),
      inProgress: new Set(),
      onCycle: () => {},
    }
  );

/**
 * A graphql-js `ValidationRule` factory, the same `addValidationRule` seam
 * `depthLimitRule` uses — but this one calls `context.reportError` NEVER.
 * LOG-ONLY this task (query-cost-control plan, task 3): it computes
 * `{breadth, complexity}` per operation and hands them to `onMeasured`
 * rather than rejecting anything, so `yoga-plugins.ts`'s `useCostLogging`
 * can log them without this rule owning a budget yet.
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
 * before this rule's own silence could matter — reporting it a second time
 * here would just be a duplicate error for the client to see, not a second
 * layer of protection. What this rule DOES own, independently, is not
 * CRASHING on the same document; `cost-limit.test.ts` pins that directly
 * (seen-to-fail against a memo-less version), the same way
 * `depth-limit.test.ts` pins it for depth.
 */
export const costLimitRule =
  (schema: GraphQLSchema, onMeasured: (operationName: string, cost: OperationCost) => void) =>
  (context: ValidationContext): ASTVisitor => {
    const fragments: Record<string, FragmentDefinitionNode> = {};
    for (const definition of context.getDocument().definitions) {
      if (definition.kind === Kind.FRAGMENT_DEFINITION)
        fragments[definition.name.value] = definition;
    }
    const memo: CostMemo = createFragmentWalkMemo(() => {});

    return {
      OperationDefinition(node: OperationDefinitionNode) {
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
