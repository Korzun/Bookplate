import {
  buildSchema,
  FragmentDefinitionNode,
  getIntrospectionQuery,
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

/** Builds `f0 { f1 { … { f(N-1) { leaf } } … } }` (no outer braces — an
 * embeddable selection-set body) — `n` wrapping Fields around an innermost
 * leaf. Each wrapping Field has a sub-selection and so increments depth
 * once; the leaf does not. Contributes depth exactly `n`. */
const deepFieldChain = (n: number): string => {
  let query = 'leaf';
  for (let i = n - 1; i >= 0; i--) query = `f${i} { ${query} }`;
  return query;
};

/** `{ f0 { f1 { … { f(N-1) { leaf } } … } } }` — `deepFieldChain` as a
 * complete operation. Measures depth exactly `n`. */
const nestedQuery = (n: number): string => `{ ${deepFieldChain(n)} }`;

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
  });

  // Final-review-wave F-1: the grid ALSO renders `LibraryEntry`'s `Series`
  // arm (the shipped UI's `SeriesRow`/`useSeriesBookList`), nesting its own
  // books inside the same connection — a shape the task-3 calibration never
  // measured. A shared `BookCard` fragment reused across both union arms
  // (the canonical Apollo pattern) measures 11 here — see
  // `depth-limit.ts`'s recalibration comment for the full measurement
  // table. Byte-identical to `depth-limit-integration.test.ts`'s
  // "grid + Series arm, full card" HTTP-level fixture.
  it('measures the grid + Series-arm + full-card (incl. pendingFix.autoFixes) fixture at depth 11, and MAX_DEPTH clears it with margin to spare', () => {
    const GRID_WITH_SERIES_ARM = `
      fragment BookCard on Book {
        series { id name }
        progress { percentage }
        validation { id valid }
        pendingFix { state { autoFixes { field kind from to } } }
      }
      { viewer { library { entries(first: 20) {
        edges { node {
          ... on Book { ...BookCard }
          ... on Series { books(first: 10) { edges { node { ...BookCard } } } }
        } }
        pageInfo { hasNextPage endCursor }
      } } } }`;

    expect(depthOf(GRID_WITH_SERIES_ARM)).toBe(11);
    expect(MAX_DEPTH).toBeGreaterThanOrEqual(11);
  });

  it(`MAX_DEPTH (${MAX_DEPTH}) is the legitimate-max-11 + 1 margin, and still rejects the depth-13 amplification fixture`, () => {
    expect(MAX_DEPTH).toBe(12);
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

/**
 * Task-3 review, C-1/C-2: `relativeDepthOf`'s `FragmentSpread` branch used
 * to re-expand a fragment every time it was spread, with no cycle guard.
 * A document where each fragment spreads the next one TWICE cost `2^N`
 * traversals (measured 4777ms for N=24 on a 2.2KB unauthenticated POST);
 * a cyclic fragment recursed until the stack overflowed, surfacing as an
 * unhandled `RangeError` → HTTP 500. Both share one root cause (unmemoized,
 * unguarded recursion through `fragments[name]`) and one fix (per-document
 * memo cache + in-progress set — `FragmentDepthMemo` in depth-limit.ts).
 */
describe('relativeDepthOf — fragment memoization and cycle guard', () => {
  // Each fragment F_i spreads F_(i-1) TWICE — the exact exponential shape
  // the review measured. Depth itself stays flat (every F_i measures
  // relative depth 0 — the point is the traversal SHAPE, not the value),
  // so this is purely a wall-clock/CPU-cost regression test.
  const chainedFragmentDoc = (n: number): string => {
    const definitions = ['fragment F0 on T { a }'];
    for (let i = 1; i <= n; i++) {
      definitions.push(`fragment F${i} on T { x: a ...F${i - 1} y: a ...F${i - 1} }`);
    }
    return `{ ...F${n} }\n${definitions.join('\n')}`;
  };

  it('validates an N=24 chained-fragment amplification document in a small, bounded time', () => {
    const document = parse(chainedFragmentDoc(24));

    const start = performance.now();
    const errors = validate(dummySchema, document, [depthLimitRule(MAX_DEPTH)]);
    const elapsedMs = performance.now() - start;

    // Un-memoized, N=24 measured 4777ms (task-3 review, C-1) and scaled
    // ~4x per +2 fragments — even N=18 alone was 81ms. A generous 500ms
    // bound is still two-plus orders of magnitude below "still
    // exponential" while comfortably clearing normal timing jitter around
    // the memoized version's actual sub-millisecond cost.
    expect(elapsedMs).toBeLessThan(500);
    expect(errors).toEqual([]);
  });

  it('a self-referential fragment spread reports a clean validation error, not a crash', () => {
    const document = parse('{ a { ...F } } fragment F on T { b { ...F } }');

    expect(() => validate(dummySchema, document, [depthLimitRule(MAX_DEPTH)])).not.toThrow();

    const errors = validate(dummySchema, document, [depthLimitRule(MAX_DEPTH)]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('Cannot spread fragment "F" within itself.');
  });

  it('an indirect (mutually recursive) fragment cycle also reports cleanly, once', () => {
    const document = parse('{ ...A } fragment A on T { ...B } fragment B on T { ...A }');

    expect(() => validate(dummySchema, document, [depthLimitRule(MAX_DEPTH)])).not.toThrow();

    const errors = validate(dummySchema, document, [depthLimitRule(MAX_DEPTH)]);
    // One error, not two: the cycle is reported the first time it is
    // detected (whichever of A/B is entered first); the memo then treats
    // both names as resolved (0) for the rest of the walk.
    expect(errors).toHaveLength(1);
  });

  it('a fragment with a cyclic branch AND a legitimate deep branch still measures the real one', () => {
    // F spreads itself (cyclic, contributes 0) alongside a real, measurable
    // nested field — proves the cycle guard doesn't corrupt the REST of
    // the same fragment's depth computation.
    const document = parse(
      nestedQuery(3).replace('leaf', '...F') + ' fragment F on T { ...F g { h } }'
    );

    const errors = validate(dummySchema, document, [depthLimitRule(MAX_DEPTH)]);
    // depth 3 (nestedQuery(3)'s own wrapping) + 2 (F's own g{h}) = 5, well
    // under MAX_DEPTH — no depth-limit error, only the one cycle error.
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('within itself');
  });
});

/**
 * Task-3 review, I-1: the standard introspection query measures depth 14
 * under this algorithm — deep, legitimate self-reference
 * (`__Type.fields.type.ofType.ofType…`), not amplification. Exempting it
 * is what keeps `graphiql: !isProduction` (yoga.ts) actually usable in dev.
 */
describe('isIntrospectionOnly exemption', () => {
  it('every getIntrospectionQuery() variant passes the depth rule, regardless of MAX_DEPTH', () => {
    for (const options of [{}, { descriptions: false }, { inputValueDeprecation: true }]) {
      const document = parse(getIntrospectionQuery(options));
      const errors = validate(dummySchema, document, [depthLimitRule(MAX_DEPTH)]);
      expect(errors).toEqual([]);
    }
  });

  it('a client query that merely INCLUDES __schema alongside real fields is still depth-checked', () => {
    // The exemption is "introspection-only operations", not "any operation
    // that touches a meta-field" — mixing `__schema` into a real query
    // must not become a depth-limit bypass.
    const document = parse(`{ __schema { types { name } } ${deepFieldChain(MAX_DEPTH + 1)} }`);
    const errors = validate(dummySchema, document, [depthLimitRule(MAX_DEPTH)]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('nested too deeply');
  });
});
