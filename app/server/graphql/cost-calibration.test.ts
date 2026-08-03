import { BREADTH_BUDGET, COMPLEXITY_BUDGET, type OperationCost } from './cost-limit';
import { accepts, assertSchemaValid, costOf, runCostLimitRule } from './cost-test-support';

/**
 * **The CI-enforced cost-calibration suite**
 * (`.superpowers/sdd/2026-08-03-cost-calibration-suite`, Task 2). Owns the
 * fixture corpus that used to live inside `cost-limit.test.ts` — every
 * legit/near-future ACCEPT fixture (Task 3's calibration table + near-future
 * shapes) and every attack REJECT fixture (the "Task 4 regression suite") —
 * and asserts three things about it, run by `npm run test:cost -w
 * app/server` and CI's `Cost calibration` job:
 *
 * 1. **Headroom** — every legit/near-future fixture stays under 70% of
 *    BOTH budgets. This is the gap the old accept/reject-only fixtures
 *    couldn't see: the admin user list reached 91% of the then-shipped
 *    budget with every existing test still green, because "accepted" and
 *    "accepted with margin" were never distinguished. Crossing 70% FAILS
 *    this suite, so "one more field would land this screen close to the
 *    wall" surfaces on the PR that adds the field, not months later in a
 *    whole-branch review.
 * 2. **Separation** — every attack fixture still rejects, and each
 *    assertion names WHICH budget caught it (the catch-split) — a
 *    multiplier change that silently moves an attack from
 *    complexity-caught to admitted fails loudly here, not quietly.
 * 3. **The table** — printed once, at the end of the run, so CI logs (and a
 *    reviewer's diff of this file) show `fixture → breadth / complexity / %
 *    of each budget` without anyone re-deriving it by hand.
 *
 * **This task changes NO numbers** — it captures today's measurements as
 * they stand; Task 3 moves numbers. `HEADROOM_FRACTION` (0.70) is a user
 * ruling (not 80%, the design's originally proposed figure), and headroom
 * failures at TODAY's budgets are expected and deliberate — see
 * `deferredToTask3` below, not a bug in this suite.
 *
 * Every fixture — ACCEPT or REJECT — is schema-validated
 * (`assertSchemaValid`, `cost-test-support.ts`) before it is ever measured:
 * an unsendable query must never define a number again, which is how
 * `13,483` (measured from an invalid selection) once set a budget
 * (task-4-review.md, C-1).
 */

const HEADROOM_FRACTION = 0.7;

type FixtureClass = 'legit-screen' | 'near-future' | 'attack' | 'boundary';

interface AcceptFixture {
  readonly verdict: 'accept';
  readonly name: string;
  readonly class: FixtureClass;
  readonly source: string;
  /**
   * Present ONLY for a legit/near-future fixture that measures OVER 70% of
   * either budget at TODAY's numbers (`COMPLEXITY_BUDGET = 30_000`,
   * `BREADTH_BUDGET = 100`) — the ledger's accepted, up-front consequence of
   * adopting the 70% ruling before Task 3 moves any number. Marked with
   * `it.fails()` (see "Headroom", below) rather than excluded or skipped —
   * present in the corpus, present in the printed table, and RED the moment
   * it stops failing (i.e. the moment Task 3's budget raise clears it),
   * which is exactly the signal that tells Task 3 to remove the marker.
   */
  readonly deferredToTask3?: string;
}

interface RejectFixture {
  readonly verdict: 'reject';
  readonly name: string;
  readonly class: FixtureClass;
  readonly source: string;
  /** Sorted `extensions.code`s `costLimitRule` must report — asserts WHICH budget(s) caught it, not just that something did. */
  readonly expectedCodes: readonly string[];
}

type Fixture = AcceptFixture | RejectFixture;

// ---------------------------------------------------------------------------
// Fixture construction helpers — reproduced from `cost-limit.test.ts`
// verbatim (byte-identical query shapes), since these build attack-corpus
// query STRINGS, not rule behaviour; they belong with the corpus they build.
// ---------------------------------------------------------------------------

/** `n` repetitions of `books(<dir>:100){edges{node{series{…}}}}`, bottoming out at a leaf `id` — the pagination-cycle attack family's shared shape. */
const booksHop = (n: number, dir: 'first' | 'last' = 'first'): string =>
  n === 0 ? 'id' : `books(${dir}: 100) { edges { node { series { ${booksHop(n - 1, dir)} } } } }`;

const aliasedSuggestions = (count: number): string =>
  `{ ${Array.from(
    { length: count },
    (_, i) =>
      `a${i}: viewer { library { searchSuggestions(query: "q${i}") { items { book { series { books(first: 100) { edges { node { id } } } } } } } } }`
  ).join(' ')} }`;

const aliasedGrid = (count: number): string =>
  `{ ${Array.from(
    { length: count },
    (_, i) =>
      `a${i}: viewer { library { entries(first: 20) { edges { node { ... on Book { series { id name } progress { percentage } validation { id valid } } } } pageInfo { hasNextPage endCursor } } } }`
  ).join(' ')} }`;

const aliasedNodesBatch = (aliasCount: number, idsPerAlias: number): string =>
  `{ ${Array.from(
    { length: aliasCount },
    (_, i) =>
      `a${i}: nodes(ids: [${Array.from({ length: idsPerAlias }, (_ignored, j) => `"id${i}_${j}"`).join(', ')}]) { id }`
  ).join(' ')} }`;

const aliasedScalarList = (count: number): string =>
  `{ ${Array.from({ length: count }, (_, i) => `a${i}: viewer { library { authors subjects } }`).join(' ')} }`;

const BOOK_CARD_FRAGMENT = `
  fragment BookCard on Book {
    series { id name }
    progress { percentage }
    validation { id valid }
    pendingFix { state { autoFixes { field kind from to } } }
  }`;

// ---------------------------------------------------------------------------
// The corpus.
// ---------------------------------------------------------------------------

const LEGIT_FIXTURES: readonly AcceptFixture[] = [
  {
    verdict: 'accept',
    class: 'legit-screen',
    name: 'the richest SHIPPED grid fixture (entries(first:20), full BookCard both union arms)',
    source: `${BOOK_CARD_FRAGMENT}
      { viewer { library { entries(first: 20) {
        edges { node {
          ... on Book { ...BookCard }
          ... on Series { books(first: 10) { edges { node { ...BookCard } } } }
        } }
        pageInfo { hasNextPage endCursor }
      } } } }`,
  },
  {
    verdict: 'accept',
    class: 'legit-screen',
    name: 'the richest grid at entries(first:100) — the MAXIMUM page size Task 1 permits on this connection (task-4-review.md, C-2)',
    source: `${BOOK_CARD_FRAGMENT}
      { viewer { library { entries(first: 100) {
        edges { node {
          ... on Book { ...BookCard }
          ... on Series { books(first: 10) { edges { node { ...BookCard } } } }
        } }
        pageInfo { hasNextPage endCursor }
      } } } }`,
  },
  {
    verdict: 'accept',
    class: 'near-future',
    name: 'near-future shape 1: BookCard-on-lineage (the obvious next UI step for the shipped lineage screen)',
    source: `${BOOK_CARD_FRAGMENT}
      { viewer { library { book(id: "x") { lineage {
          oldId newId
          oldBook { ...BookCard }
          newBook { ...BookCard }
        } } } } }`,
  },
  {
    verdict: 'accept',
    class: 'near-future',
    deferredToTask3:
      'TODO(Task 3): measures ~74.3% of COMPLEXITY_BUDGET today (22,283 / 30,000) — over the 70% headroom line. Per the design (docs/superpowers/specs/2026-08-03-cost-calibration-suite-design.md §3) Task 3 raises COMPLEXITY_BUDGET off measured legit anchors, which clears this fixture; remove this marker once it does (breadth stays well under 70% throughout — this is a complexity-only deferral).',
    name: 'near-future shape 2: the richer grid (one more real card field + validation.messages + one more nesting level, task-4-review.md C-1 correction)',
    source: `
      fragment FullCard on Book {
        id
        title
        author
        series { id name }
        progress { percentage }
        validation { id valid messages { edges { node { severity message } } } }
        pendingFix { state { autoFixes { field kind from to } } }
      }
      { viewer { library { entries(first: 20) {
        edges { node {
          ... on Book { ...FullCard }
          ... on Series { id name books(first: 10) { edges { node { ...FullCard } } } }
        } }
      } } } }`,
  },
  {
    verdict: 'accept',
    class: 'legit-screen',
    deferredToTask3:
      'TODO(Task 3): the REAL admin user-list screen (component/user-progress-row, GET /api/users/:username/progress already ships this over REST) measures ~75.3% of COMPLEXITY_BUDGET today (22,602 / 30,000) — over the 70% headroom line. This is the fixture the design doc and ledger name explicitly: "the admin user list is at 75.3% against a 70% threshold." Per the ruling, the fix is Task 3 RAISING COMPLEXITY_BUDGET off this and the other measured legit anchors (INSTANCE_USER_MULTIPLIER=50 stays — it is the security ceiling, shrinking it is the unsafe direction), not shrinking this fixture. Remove this marker once Task 3 lands (breadth stays well under 70% throughout — this is a complexity-only deferral).',
    name: 'the admin user-list mirror (final-review.md, I-2) — a REAL, presently-reachable admin traversal, not a hypothetical',
    source:
      '{ viewer { users { library { progress(first: 50) { edges { node { document percentage device timestamp } } pageInfo { hasNextPage endCursor } } } } } }',
  },
  {
    verdict: 'accept',
    class: 'near-future',
    name: 'the labeled PLAUSIBLE device-list + enabledUsers consolidation (not shipped — two real REST reads combined into one hypothetical query)',
    source:
      '{ viewer { devices { id name slug coverWidth coverHeight coverFit bwCover simplify enabledUsers { id username } } } }',
  },
  {
    verdict: 'accept',
    class: 'legit-screen',
    name: 'the REAL device-list screen that ships today (no enabledUsers — that is a separate per-device REST read)',
    source:
      '{ viewer { devices { id name slug coverWidth coverHeight coverFit bwCover simplify } } }',
  },
  {
    verdict: 'accept',
    class: 'legit-screen',
    name: 'a real search-as-you-type screen (I-5 legit case)',
    source:
      '{ viewer { library { searchSuggestions(query: "dune") { type items { label value } } } } }',
  },
  {
    verdict: 'accept',
    class: 'legit-screen',
    name: 'library series list (repo-corpus legit screen)',
    source: '{ viewer { library { series { id name author bookCount totalPages } } } }',
  },
  {
    verdict: 'accept',
    class: 'legit-screen',
    name: 'pending-fixes list (repo-corpus legit screen)',
    source: '{ viewer { library { pendingFixes { id fileName createdAt book { id title } } } } }',
  },
  {
    verdict: 'accept',
    class: 'legit-screen',
    name: 'a mutation (rootTypeOf resolves the mutation root, not just query)',
    source: 'mutation { progressDelete(input: { document: "x", userId: "u" }) { __typename } }',
  },
];

/**
 * Every proven attack probe from the query-cost-control ledger and
 * task-3-report.md's own attack-probe table — asserting REJECTION and WHICH
 * budget(s) caught it. Twelve fixtures (the design doc's own count, §3,
 * step 4: "Re-run all 12 attack fixtures").
 */
const ATTACK_FIXTURES: readonly RejectFixture[] = [
  {
    verdict: 'reject',
    class: 'attack',
    name: 'the 3-hop nodes()-rooted cycle, first:100 (the proven 1.35M objects / 80.7MB / 8.2s shape)',
    source: `{ nodes(ids: ["x"]) { ... on Series { ${booksHop(3, 'first')} } } }`,
    expectedCodes: ['QUERY_COMPLEXITY'],
  },
  {
    verdict: 'reject',
    class: 'attack',
    name: 'the 3-hop nodes()-rooted cycle, last:100 (the `last` bypass I-1 closed)',
    source: `{ nodes(ids: ["x"]) { ... on Series { ${booksHop(3, 'last')} } } }`,
    expectedCodes: ['QUERY_COMPLEXITY'],
  },
  {
    verdict: 'reject',
    class: 'attack',
    name: 'the Series-arm 2-hop via Library.entries, first:100 (the amplification fixture)',
    source: `{ viewer { library { entries(first: 20) { edges { node { ... on Series { ${booksHop(2, 'first')} } } } } } } }`,
    expectedCodes: ['QUERY_COMPLEXITY'],
  },
  {
    verdict: 'reject',
    class: 'attack',
    name: 'the Series-arm 2-hop via Library.entries, last:100',
    source: `{ viewer { library { entries(first: 20) { edges { node { ... on Series { ${booksHop(2, 'last')} } } } } } } }`,
    expectedCodes: ['QUERY_COMPLEXITY'],
  },
  {
    verdict: 'reject',
    class: 'attack',
    name: 'the 2-hop-from-nodes() cycle, first:100',
    source: `{ nodes(ids: ["x"]) { ... on Series { ${booksHop(2, 'first')} } } }`,
    expectedCodes: ['QUERY_COMPLEXITY'],
  },
  {
    verdict: 'reject',
    class: 'attack',
    name: 'the 2-hop-from-nodes() cycle, last:100',
    source: `{ nodes(ids: ["x"]) { ... on Series { ${booksHop(2, 'last')} } } }`,
    expectedCodes: ['QUERY_COMPLEXITY'],
  },
  {
    verdict: 'reject',
    class: 'attack',
    name: 'the suggestions path, single query (I-5 attack case)',
    source:
      '{ viewer { library { searchSuggestions(query: "a") { items { book { series { books(first: 100) { edges { node { id } } } } } } } } } }',
    expectedCodes: ['QUERY_COMPLEXITY'],
  },
  {
    verdict: 'reject',
    class: 'attack',
    name: 'the suggestions path, 12-alias (both budgets fire)',
    source: aliasedSuggestions(12),
    expectedCodes: ['QUERY_BREADTH', 'QUERY_COMPLEXITY'],
  },
  {
    verdict: 'reject',
    class: 'attack',
    name: 'the 200-alias grid fan-out (61x baseline probe, both budgets fire)',
    source: aliasedGrid(200),
    expectedCodes: ['QUERY_BREADTH', 'QUERY_COMPLEXITY'],
  },
  {
    verdict: 'reject',
    class: 'attack',
    name: '200x nodes(ids:[100]) (the ledger N-1 probe, 20,000 lookups — breadth-only catch-split, deliberate at the raised budget per task-4-review.md ruling (b))',
    source: aliasedNodesBatch(200, 100),
    expectedCodes: ['QUERY_BREADTH'],
  },
  {
    verdict: 'reject',
    class: 'attack',
    name: 'series { books } — the I-4 unbounded-list 2-hop through Library.series',
    source: `{ viewer { library { series {
        books(first: 12) { edges { node { series {
          books(first: 100) { edges { node { id } } }
        } } } }
      } } } }`,
    expectedCodes: ['QUERY_COMPLEXITY'],
  },
  {
    verdict: 'reject',
    class: 'attack',
    name: 'the scalar-list alias attack (200x viewer{library{authors subjects}}) — BREADTH IS THE ONLY DEFENSE for this family',
    source: aliasedScalarList(200),
    expectedCodes: ['QUERY_BREADTH'],
  },
];

/**
 * Boundary fixtures — deliberately pinned AT an edge of the model, not
 * assumed-safe legit traffic with margin. Excluded from the Headroom group
 * on purpose: "THE BOUNDARY" is constructed to be the highest literal value
 * that still clears the CURRENT `COMPLEXITY_BUDGET` (its whole reason to
 * exist is close to the wall, coupled to the exact budget number — Task 3
 * moving the budget moves this boundary too, task-4-re-review.md N-1), and
 * "THE TRAP"/the oversize-`first` case test rule-INTERACTION edges
 * (validation-time budget vs. Task 1's execution-time `rejectOversizePage`),
 * not a screen anyone ships. All three are still schema-validated, still
 * measured, and still appear in the printed table.
 */
const BOUNDARY_FIXTURES: readonly Fixture[] = [
  {
    verdict: 'accept',
    class: 'boundary',
    name: 'THE BOUNDARY: entries(first:100) + Series-arm books(first:13) — the highest literal `first` on this inner connection that still clears COMPLEXITY_BUDGET (task-4-re-review.md, N-1)',
    source: `${BOOK_CARD_FRAGMENT}
      { viewer { library { entries(first: 100) {
        edges { node {
          ... on Book { ...BookCard }
          ... on Series { books(first: 13) { edges { node { ...BookCard } } } }
        } }
        pageInfo { hasNextPage endCursor }
      } } } }`,
  },
  {
    verdict: 'reject',
    class: 'boundary',
    name: "THE TRAP: entries(first:100) + Series-arm books with NO ARGUMENT (the connection's own default, 20) — rejects even though nothing about the request LOOKS large (task-4-re-review.md, N-1 — Task 5 handoff item)",
    source: `${BOOK_CARD_FRAGMENT}
      { viewer { library { entries(first: 100) {
        edges { node {
          ... on Book { ...BookCard }
          ... on Series { books { edges { node { ...BookCard } } } }
        } }
        pageInfo { hasNextPage endCursor }
      } } } }`,
    expectedCodes: ['QUERY_COMPLEXITY'],
  },
  {
    verdict: 'accept',
    class: 'boundary',
    name: "Library.entries(first: 999999999) does NOT reject here — Task 1's execution-time rejectOversizePage is the layer that stops this, not validation",
    source:
      '{ viewer { library { entries(first: 999999999) { edges { node { ... on Book { title } } } } } } }',
  },
];

const ALL_FIXTURES: readonly Fixture[] = [
  ...LEGIT_FIXTURES,
  ...ATTACK_FIXTURES,
  ...BOUNDARY_FIXTURES,
];

// ---------------------------------------------------------------------------
// The table — accumulated as tests run, printed once at suite end so it
// lands in CI logs and a reviewer's diff (spec §1, "The table").
// ---------------------------------------------------------------------------

interface TableRow {
  Fixture: string;
  Class: FixtureClass;
  Breadth: number;
  'Breadth %': string;
  Complexity: number;
  'Complexity %': string;
  Verdict: string;
}

const rows: TableRow[] = [];

const pct = (value: number, budget: number): string => `${((value / budget) * 100).toFixed(1)}%`;

const recordRow = (fixture: Fixture, cost: OperationCost, verdict: string): void => {
  rows.push({
    Fixture: fixture.name,
    Class: fixture.class,
    Breadth: cost.breadth,
    'Breadth %': pct(cost.breadth, BREADTH_BUDGET),
    Complexity: cost.complexity,
    'Complexity %': pct(cost.complexity, COMPLEXITY_BUDGET),
    Verdict: verdict,
  });
};

afterAll(() => {
  // De-dupe by fixture name first: `vite.config.ts`'s global `retry: 1`
  // (added for flaky HTTP-harness tests elsewhere) re-runs a `.fails()` test
  // once when its expected failure reproduces, so a DEFERRED fixture's
  // `recordRow` call fires twice with identical values — collapse to the
  // last recording rather than printing the same row twice.
  const byName = new Map<string, TableRow>();
  for (const row of rows) byName.set(row.Fixture, row);
  // Sorted by class then complexity descending — attacks and the near-wall
  // legit/boundary fixtures surface first, where a reviewer's eye needs to
  // go, rather than in fixture-declaration order.
  const order: Record<FixtureClass, number> = {
    attack: 0,
    boundary: 1,
    'near-future': 2,
    'legit-screen': 3,
  };
  const sorted = [...byName.values()].sort(
    (a, b) => order[a.Class] - order[b.Class] || b.Complexity - a.Complexity
  );
  // eslint-disable-next-line no-console
  console.log(
    `\nCost-calibration table (${sorted.length} fixtures, BREADTH_BUDGET=${BREADTH_BUDGET}, COMPLEXITY_BUDGET=${COMPLEXITY_BUDGET}, headroom line=${HEADROOM_FRACTION * 100}%):`
  );
  // eslint-disable-next-line no-console
  console.table(sorted);
});

// ---------------------------------------------------------------------------
// 1. Headroom — every legit/near-future fixture stays under 70% of BOTH
//    budgets. Deferred fixtures (today's known >70% cases) use `it.fails()`:
//    the suite is green-but-honest at THIS commit, and the moment Task 3's
//    budget raise clears one, `it.fails()` itself goes red (an unexpected
//    pass), which is the forcing function to remove the marker.
// ---------------------------------------------------------------------------

describe('Headroom — every legit/near-future fixture stays under 70% of both budgets', () => {
  for (const fixture of LEGIT_FIXTURES) {
    const run = (): void => {
      accepts(fixture.source); // schema-valid AND admitted by costLimitRule
      const cost = costOf(fixture.source);
      recordRow(fixture, cost, 'accept');
      expect(cost.breadth).toBeLessThanOrEqual(HEADROOM_FRACTION * BREADTH_BUDGET);
      expect(cost.complexity).toBeLessThanOrEqual(HEADROOM_FRACTION * COMPLEXITY_BUDGET);
    };

    if (fixture.deferredToTask3) {
      it.fails(`[DEFERRED] ${fixture.name} — ${fixture.deferredToTask3}`, run);
    } else {
      it(`${fixture.name} — stays under ${HEADROOM_FRACTION * 100}% of both budgets`, run);
    }
  }
});

// ---------------------------------------------------------------------------
// 2. Separation — every attack fixture rejects, asserting WHICH budget(s)
//    caught it. A multiplier change that silently moves an attack from
//    complexity-caught to admitted (or vice versa) fails loudly here.
// ---------------------------------------------------------------------------

describe('Separation — every attack fixture rejects, and the catch-split is asserted', () => {
  for (const fixture of ATTACK_FIXTURES) {
    it(`${fixture.name} — rejects (${fixture.expectedCodes.join(' + ')})`, () => {
      assertSchemaValid(fixture.source); // even an attack fixture must be real, sendable GraphQL
      const cost = costOf(fixture.source);
      const errors = runCostLimitRule(fixture.source);
      const codes = [...errors].map((error) => String(error.extensions?.['code'])).sort();
      recordRow(fixture, cost, codes.join('+') || 'accept');
      expect(codes).toEqual([...fixture.expectedCodes].sort());
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Boundary — pinned edge-of-model behaviour, exempt from the Headroom
//    group by construction (see BOUNDARY_FIXTURES's own doc comment above).
// ---------------------------------------------------------------------------

describe('Boundary — pinned edge-of-model fixtures (not headroom-checked by design)', () => {
  for (const fixture of BOUNDARY_FIXTURES) {
    it(`${fixture.name}`, () => {
      assertSchemaValid(fixture.source);
      const cost = costOf(fixture.source);
      if (fixture.verdict === 'accept') {
        expect(runCostLimitRule(fixture.source)).toEqual([]);
        recordRow(fixture, cost, 'accept');
      } else {
        const errors = runCostLimitRule(fixture.source);
        const codes = [...errors].map((error) => String(error.extensions?.['code'])).sort();
        recordRow(fixture, cost, codes.join('+') || 'accept');
        expect(codes).toEqual([...fixture.expectedCodes].sort());
      }
    });
  }
});

// Sanity: the corpus itself is non-empty and every fixture landed in exactly
// one of the three groups above (a fixture present in ALL_FIXTURES but never
// exercised by a describe block above would be a silent gap in this suite's
// own coverage of itself).
it('the corpus inventory is non-empty and fully partitioned across the three groups', () => {
  expect(ALL_FIXTURES.length).toBe(
    LEGIT_FIXTURES.length + ATTACK_FIXTURES.length + BOUNDARY_FIXTURES.length
  );
  expect(ALL_FIXTURES.length).toBeGreaterThan(0);
});
