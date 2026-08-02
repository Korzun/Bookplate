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
 * dependency, ~20 lines of actual logic (`depthOf` below); wired into yoga
 * via the same `addValidationRule` seam `useSchemaConcealment` (yoga.ts)
 * already uses for `NoSchemaIntrospectionCustomRule`.
 *
 * CALIBRATION (measured 2026-08-02, this same `depthOf` algorithm): the
 * deepest real screen query — the library grid —
 *
 *   { viewer { library { entries(first: 20) {
 *       edges { node { ... on Book {
 *         series { id name }
 *         progress { percentage }
 *         validation { id valid }
 *       } } }
 *       pageInfo { hasNextPage endCursor }
 *   } } } }
 *
 * (see `depth-limit.test.ts`'s `LIBRARY_GRID_FIXTURE`, byte-identical to
 * this) measures depth 6: `viewer`→1, `library`→2, `entries`→3, `edges`→4,
 * `node`→5, `series`/`progress`/`validation`→6 (the inline `... on Book`
 * fragment does not itself add a level — see `depthOf`'s doc comment).
 * `pageInfo`, `entries`' other child, only reaches 4. MAX_DEPTH = 6 + 2 = 8:
 * enough margin for one more real hop (confirmed against the repo's test
 * corpus in `depth-limit.test.ts`) without opening the door to the
 * `Book.series ↔ Series.books` amplification cycle a client could otherwise
 * nest indefinitely.
 */
export const MAX_DEPTH = 8;

/**
 * The max nesting depth of `selectionSet`, where "depth" is the number of
 * Field levels a client's own selections pay a resolver for — a Field with a
 * sub-selection adds one level; a Field with none (a leaf) adds none.
 * `InlineFragment`s and `FragmentSpread`s are transparent: `... on Book { x
 * }` names a type condition, not an extra hop, so it does not itself
 * increment depth (its own child Fields still do, at the same level their
 * parent Field already established). This mirrors how every existing
 * "amplification cycle" in this schema (`Book.series ↔ Series.books`,
 * `LibraryEntry`'s own union) is built from real Fields, not fragments — a
 * rule that charged fragments an extra level would just push a client to
 * flatten with more fragments rather than actually shrinking the query.
 */
const depthOf = (
  selectionSet: SelectionSetNode,
  fragments: Record<string, FragmentDefinitionNode>,
  depth: number
): number =>
  selectionSet.selections.reduce((max, selection) => {
    if (selection.kind === Kind.FIELD) {
      return selection.selectionSet
        ? Math.max(max, depthOf(selection.selectionSet, fragments, depth + 1))
        : max;
    }
    if (selection.kind === Kind.INLINE_FRAGMENT) {
      return Math.max(max, depthOf(selection.selectionSet, fragments, depth));
    }
    // FragmentSpread: resolve by name; an unknown name is a different rule's
    // problem (`KnownFragmentNames`) — this rule just skips it rather than
    // duplicating that check.
    const fragment = fragments[selection.name.value];
    return fragment ? Math.max(max, depthOf(fragment.selectionSet, fragments, depth)) : max;
  }, depth);

/** Exposed for `depth-limit.test.ts`'s direct boundary-math assertions. */
export const measureOperationDepth = (
  operation: OperationDefinitionNode,
  fragments: Record<string, FragmentDefinitionNode>
): number => depthOf(operation.selectionSet, fragments, 0);

/**
 * A graphql-js `ValidationRule` factory (the same shape
 * `NoSchemaIntrospectionCustomRule` has) — walks every operation in the
 * document and reports one error per operation that exceeds `maxDepth`. Runs
 * at validation time, before execution, so a rejected query never reaches a
 * resolver (same "before execution" guarantee the body-size limit gives,
 * one stage later in the pipeline).
 */
export const depthLimitRule =
  (maxDepth: number) =>
  (context: ValidationContext): ASTVisitor => {
    const fragments: Record<string, FragmentDefinitionNode> = {};
    for (const definition of context.getDocument().definitions) {
      if (definition.kind === Kind.FRAGMENT_DEFINITION)
        fragments[definition.name.value] = definition;
    }
    return {
      OperationDefinition(node: OperationDefinitionNode) {
        const depth = measureOperationDepth(node, fragments);
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
