import {
  buildSchema,
  FragmentDefinitionNode,
  Kind,
  OperationDefinitionNode,
  parse,
  validate,
} from 'graphql';

import { depthLimitRule, MAX_DEPTH, measureOperationDepth } from './depth-limit';

// A minimal, throwaway schema — `depthLimitRule` never consults TypeInfo (it
// walks raw AST field nesting, not resolved types), so field existence and
// naming here are irrelevant. Using this instead of the real schema keeps
// this file's boundary-math tests independent of any real field ever
// changing shape.
const dummySchema = buildSchema('type Query { x: String }');

/** Builds `{ f0 { f1 { … { f(N-1) { leaf } } … } } }` — `n` wrapping Fields
 * around an innermost leaf. Each wrapping Field has a sub-selection and so
 * increments depth once; the leaf does not. Measures depth exactly `n`. */
const nestedQuery = (n: number): string => {
  let query = 'leaf';
  for (let i = n - 1; i >= 0; i--) query = `f${i} { ${query} }`;
  return `{ ${query} }`;
};

const operationAndFragmentsOf = (
  source: string
): { operation: OperationDefinitionNode; fragments: Record<string, FragmentDefinitionNode> } => {
  const document = parse(source);
  const operation = document.definitions.find(
    (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION
  );
  if (!operation) throw new Error('fixture has no operation');
  const fragments: Record<string, FragmentDefinitionNode> = {};
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments[definition.name.value] = definition;
  }
  return { operation, fragments };
};

const depthOf = (source: string): number => {
  const { operation, fragments } = operationAndFragmentsOf(source);
  return measureOperationDepth(operation, fragments);
};

describe('measureOperationDepth — boundary math', () => {
  it('a single leaf field is depth 0', () => {
    expect(depthOf('{ leaf }')).toBe(0);
  });

  it('counts one level per Field that carries a sub-selection', () => {
    expect(depthOf(nestedQuery(1))).toBe(1);
    expect(depthOf(nestedQuery(2))).toBe(2);
    expect(depthOf(nestedQuery(6))).toBe(6);
  });

  it('takes the max across sibling branches, not the sum', () => {
    expect(depthOf('{ a { b { c } } d { e } }')).toBe(2);
  });

  it(`MAX_DEPTH (${MAX_DEPTH}) itself is exactly the boundary this rule allows`, () => {
    expect(depthOf(nestedQuery(MAX_DEPTH))).toBe(MAX_DEPTH);
  });

  it('one level past MAX_DEPTH measures MAX_DEPTH + 1', () => {
    expect(depthOf(nestedQuery(MAX_DEPTH + 1))).toBe(MAX_DEPTH + 1);
  });

  it('an inline fragment does not itself add a depth level', () => {
    // Same shape as `nestedQuery(3)` (depth 2), with a type condition
    // wrapped around the middle field — should measure identically.
    expect(depthOf('{ a { ... on T { b { c } } } }')).toBe(2);
  });

  it('a fragment spread does not itself add a depth level', () => {
    expect(depthOf('{ a { ...Frag } } fragment Frag on T { b { c } }')).toBe(2);
  });

  // Byte-identical to the fixture in `depth-limit.ts`'s calibration comment
  // (also exercised end-to-end, over real HTTP against the real schema, in
  // `depth-limit-integration.test.ts`'s "passes the library-grid screen
  // query" test) — pins the comment's own depth-6 claim to this algorithm,
  // not just to eyeballing it.
  it('measures the library-grid calibration fixture at depth 6', () => {
    const LIBRARY_GRID_FIXTURE = `{ viewer { library { entries(first: 20) {
      edges { node { ... on Book {
        series { id name }
        progress { percentage }
        validation { id valid }
      } } }
      pageInfo { hasNextPage endCursor }
    } } } }`;

    expect(depthOf(LIBRARY_GRID_FIXTURE)).toBe(6);
    expect(MAX_DEPTH).toBe(6 + 2);
  });
});

describe('depthLimitRule', () => {
  const runRule = (source: string) =>
    validate(dummySchema, parse(source), [depthLimitRule(MAX_DEPTH)]);

  it('passes a query at exactly MAX_DEPTH', () => {
    expect(runRule(nestedQuery(MAX_DEPTH))).toEqual([]);
  });

  it('rejects a query one level past MAX_DEPTH, with a clear message', () => {
    const errors = runRule(nestedQuery(MAX_DEPTH + 1));

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain(`depth ${MAX_DEPTH + 1}`);
    expect(errors[0]?.message).toContain(`max ${MAX_DEPTH}`);
  });

  it('reports one error per over-depth operation, not per field', () => {
    const errors = runRule(nestedQuery(MAX_DEPTH + 3));
    expect(errors).toHaveLength(1);
  });
});
