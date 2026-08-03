import {
  FragmentDefinitionNode,
  GraphQLError,
  Kind,
  OperationDefinitionNode,
  SelectionSetNode,
  ValidationContext,
} from 'graphql';
import type { ASTVisitor } from 'graphql';

/**
 * Hand-rolled replacement for a `graphql-depth-limit`-shaped package — no new
 * dependency, wired into yoga via the same `addValidationRule` seam
 * `useSchemaConcealment` (yoga.ts) already uses for
 * `NoSchemaIntrospectionCustomRule`.
 *
 * RECALIBRATION (final pre-client-polish review wave, finding F-1; measured
 * 2026-08-02, this same depth algorithm): `MAX_DEPTH = 9` (task-3's own
 * calibration) was measured against a library-grid fixture that only walked
 * the `... on Book` arm of `Library.entries` — but `LibraryEntry` is a
 * `Book | Series` union and the shipped UI ALSO renders the `Series` arm
 * with its own nested books (`app/client/src/page/library/index.tsx` →
 * `SeriesRow` → `useSeriesBookList`), which costs 3 more levels before a
 * book card even starts. That arm, combined with a book card rich enough to
 * show a pending-fix banner (`pendingFix { state { autoFixes { … } } }`),
 * measured depth 11 — REJECTED at the old limit of 9. Full measurement
 * table (every number reproduced with `measureOperationDepth`, the same
 * function `depthLimitRule` below calls):
 *
 * | shape                                                              | depth |
 * |---------------------------------------------------------------------|------|
 * | flat grid, thin card (`series`/`progress`/`validation`)             |    6 |
 * | flat grid, card w/ `pendingFix.state.autoFixes`                     |    8 |
 * | grid + `Series` arm, thin card                                      |    9 |
 * | grid + `Series` arm, card w/ `pendingFix.state.autoFixes` (either union arm; a `BookCard` fragment reused across both arms measures the same — fragments are depth-transparent, see `relativeDepthOf`) | **11** |
 * | series detail (`seriesByName → books → node`, thin card or w/ `pendingFix.state.autoFixes`) |    9 |
 * | series detail + full `validation.messages` per book (richest plausible) |   10 |
 * | book detail (`pendingFix.state.autoFixes` + `validation.messages` together) |    7 |
 * | admin `user(id:) { library { … } }` + `Series` arm, thin card        |    9 |
 * | admin `user(id:) { library { … } }` + `Series` arm, full card (incl. `pendingFix.state.autoFixes`) | **11** |
 * | one hop of `Book.series ↔ Series.books` (legitimate "sibling books") |    7 |
 * | two-hop `Book.series ↔ Series.books` cycle, rooted at `Library.entries` (the amplification fixture this rule exists to stop — see `depth-limit-integration.test.ts`) | **13** |
 *
 * (See `depth-limit.test.ts` for the byte-identical `LIBRARY_GRID_FIXTURE`
 * pinning the first row, and `depth-limit-integration.test.ts` for the
 * grid+Series+autoFixes and amplification rows run end-to-end over real
 * HTTP against the real schema.)
 *
 * The worst LEGITIMATE shape found is 11. The amplification cycle this rule
 * exists to stop measures 13 — a client could otherwise nest it
 * indefinitely, each hop multiplying the response's fan-out. `MAX_DEPTH =
 * 12`: legitimate max 11 + a 1-level margin, and it still rejects the
 * amplification fixture (13 > 12, a 1-level gap). This is a narrow corridor,
 * not a generous one — 11 and 13 leave exactly one integer between them —
 * so there is no room for a repeat of F-1 (a shape landing exactly on the
 * limit with zero margin): any future field added to a book card that
 * itself needs a sub-selection will need this table re-measured, not just
 * eyeballed. A single two-hop cycle rooted at a directly-addressed
 * `book(id:)` (rather than through `Library.entries`) measures 11, not 13 —
 * within the new legitimate range, and thus no longer independently
 * rejected; what remains bounded is INDEFINITE nesting (a third hop of the
 * same cycle measures 15, still well past 12) — depth alone cannot and does
 * not need to distinguish "one bounded structural cycle" from "a
 * numerically identical legitimate shape", only "unboundedly repeated"
 * from "bounded".
 */
export const MAX_DEPTH = 12;

/**
 * Per-document memoization + cycle guard for `relativeDepthOf`'s
 * `FragmentSpread` branch (task-3 review, C-1/C-2 — REQUIRED, not an
 * optimization: without it, a document that spreads fragment N inside
 * fragment N+1 costs `2^N` traversals — measured 4777ms for N=24 on a
 * 2.2KB unauthenticated POST — and a cyclic fragment recurses until the
 * stack overflows, surfacing as an unhandled `RangeError` → HTTP 500).
 * `cache` holds each fragment's relative depth, computed once no matter how
 * many times (or from how many operations in the same document) it is
 * spread — this is sound because a fragment's contribution to depth is
 * relative, not absolute (`depthOf(set, d) === d + relativeDepthOf(set)`),
 * so it does not depend on where the spread sits. `inProgress` holds the
 * names currently being computed; re-entering one mid-computation is a
 * cycle, reported once via `onCycle` and treated as contributing 0 (cyclic
 * fragments are invalid GraphQL regardless of this rule — this is a clean
 * validation error, not a crash, and lets the REST of a fragment with a
 * cyclic branch alongside legitimate fields still measure correctly).
 */
type FragmentDepthMemo = {
  cache: Map<string, number>;
  inProgress: Set<string>;
  onCycle: (fragmentName: string) => void;
};

/**
 * The max RELATIVE nesting depth added by `selectionSet` — "relative"
 * meaning independent of how deep the caller already is; the caller adds
 * its own base depth on top (`measureOperationDepth`/`depthLimitRule`
 * below, both starting the walk at depth 0). A Field with a sub-selection
 * contributes 1 plus whatever its own children contribute; a Field with
 * none (a leaf) contributes 0. `InlineFragment`s are transparent: `... on
 * Book { x }` names a type condition, not an extra hop, so it contributes
 * exactly what its own children contribute, no more. This mirrors how
 * every existing "amplification cycle" in this schema (`Book.series ↔
 * Series.books`, `LibraryEntry`'s own union) is built from real Fields, not
 * fragments — a rule that charged fragments an extra level would just push
 * a client to flatten with more fragments rather than actually shrinking
 * the query.
 *
 * `FragmentSpread`s are ALSO transparent depth-wise (same reasoning as
 * inline fragments — a named fragment is still just a type condition plus
 * a reusable selection, not a hop of its own), but unlike inline fragments
 * they can be spread more than once, from more than one place, including
 * from inside another fragment — hence `memo`.
 */
const relativeDepthOf = (
  selectionSet: SelectionSetNode,
  fragments: Record<string, FragmentDefinitionNode>,
  memo: FragmentDepthMemo
): number =>
  selectionSet.selections.reduce((max, selection) => {
    if (selection.kind === Kind.FIELD) {
      return selection.selectionSet
        ? Math.max(max, 1 + relativeDepthOf(selection.selectionSet, fragments, memo))
        : max;
    }
    if (selection.kind === Kind.INLINE_FRAGMENT) {
      return Math.max(max, relativeDepthOf(selection.selectionSet, fragments, memo));
    }
    // FragmentSpread: resolve by name; an unknown name is a different
    // rule's problem (`KnownFragmentNames`) — this rule just skips it
    // rather than duplicating that check.
    const name = selection.name.value;
    const cached = memo.cache.get(name);
    if (cached !== undefined) return Math.max(max, cached);
    if (memo.inProgress.has(name)) {
      memo.onCycle(name);
      return max; // cyclic — contributes nothing; the OUTER (still-in-progress)
      // computation for this same name keeps going and caches its own,
      // real value once it completes.
    }
    const fragment = fragments[name];
    if (!fragment) return max;
    memo.inProgress.add(name);
    const depth = relativeDepthOf(fragment.selectionSet, fragments, memo);
    memo.inProgress.delete(name);
    memo.cache.set(name, depth);
    return Math.max(max, depth);
  }, 0);

/**
 * Exposed for `depth-limit.test.ts`'s direct boundary-math assertions. Each
 * call gets its own fresh memo (a no-op `onCycle`, since this is a pure
 * measurement helper with no `ValidationContext` to report through — a
 * cyclic fragment here just measures as contributing 0 at the cycle point,
 * same as `depthLimitRule` below, minus the reported error).
 */
export const measureOperationDepth = (
  operation: OperationDefinitionNode,
  fragments: Record<string, FragmentDefinitionNode>
): number =>
  relativeDepthOf(operation.selectionSet, fragments, {
    cache: new Map(),
    inProgress: new Set(),
    onCycle: () => {},
  });

const INTROSPECTION_ROOT_FIELDS = new Set(['__schema', '__type']);

/**
 * True when every top-level selection of `selectionSet` is an
 * introspection meta-field (`__schema`/`__type`) — i.e. this operation IS
 * `getIntrospectionQuery()` (or a hand-written equivalent), not a client
 * query that merely happens to ask for one alongside real fields.
 *
 * Task-3 review, I-1: the standard introspection query measures depth 14
 * under this algorithm (it is deeply, and legitimately, self-referential —
 * `__Type.fields.type.ofType.ofType…`), which silently broke GraphiQL in
 * dev (`graphiql: !isProduction`, yoga.ts) and anything else that
 * introspects a running dev server. Exempting introspection-only operations
 * from the depth walk creates ZERO production exposure: `graphiql`'s
 * schema-fetch and every `getIntrospectionQuery()` variant match this
 * check, and `useSchemaConcealment`'s `NoSchemaIntrospectionCustomRule`
 * (yoga-plugins.ts) already rejects every introspection operation outright
 * in production, before depth would ever matter — this exemption only ever
 * takes effect in dev, where concealment is deliberately not installed.
 * Raising `MAX_DEPTH` past 14 instead would give back the entire
 * calibration margin for every OTHER query, not just introspection.
 */
const isIntrospectionOnly = (selectionSet: SelectionSetNode): boolean =>
  selectionSet.selections.every(
    (selection) =>
      selection.kind === Kind.FIELD && INTROSPECTION_ROOT_FIELDS.has(selection.name.value)
  );

/**
 * A graphql-js `ValidationRule` factory (the same shape
 * `NoSchemaIntrospectionCustomRule` has) — walks every operation in the
 * document and reports one error per operation that exceeds `maxDepth`. Runs
 * at validation time, before execution, so a rejected query never reaches a
 * resolver (same "before execution" guarantee the body-size limit gives,
 * one stage later in the pipeline).
 *
 * The memo (cache + in-progress set) is created ONCE per document, shared
 * across every operation `OperationDefinition` visits — correct because a
 * fragment's relative depth does not depend on which operation spreads it
 * (see `FragmentDepthMemo`'s doc comment), and it is what makes a document
 * that spreads the same fragment from multiple operations still only pay
 * for computing that fragment's depth once.
 */
export const depthLimitRule =
  (maxDepth: number) =>
  (context: ValidationContext): ASTVisitor => {
    const fragments: Record<string, FragmentDefinitionNode> = {};
    for (const definition of context.getDocument().definitions) {
      if (definition.kind === Kind.FRAGMENT_DEFINITION)
        fragments[definition.name.value] = definition;
    }
    const reportedCycles = new Set<string>();
    const memo: FragmentDepthMemo = {
      cache: new Map(),
      inProgress: new Set(),
      onCycle: (name) => {
        // Deduped: once a fragment's cycle is reported, `relativeDepthOf`
        // returning early (contributing 0) for every later re-encounter of
        // the SAME name is the correct math, not a second bug — one error
        // per cyclic fragment is the useful signal.
        if (reportedCycles.has(name)) return;
        reportedCycles.add(name);
        context.reportError(
          new GraphQLError(`Cannot spread fragment "${name}" within itself.`, {
            nodes: fragments[name],
          })
        );
      },
    };

    return {
      OperationDefinition(node: OperationDefinitionNode) {
        if (isIntrospectionOnly(node.selectionSet)) return;
        const depth = relativeDepthOf(node.selectionSet, fragments, memo);
        if (depth > maxDepth) {
          context.reportError(
            new GraphQLError(
              `Query is nested too deeply (depth ${depth}, max ${maxDepth}). ` +
                'Split this into smaller operations or request fewer nested connections.',
              { nodes: node }
            )
          );
        }
      },
    };
  };
