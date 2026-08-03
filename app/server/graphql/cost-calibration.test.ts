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
 *    whole-branch review. A DEFERRED fixture (see `deferredToTask3` below)
 *    still gets a plain, ALWAYS-enforced test that it is schema-valid,
 *    admitted, and under breadth headroom — only the ONE complexity
 *    assertion that is known to fail today is deferred, never the whole
 *    fixture (task-2-review.md, C-1: a fixture rejected outright by a
 *    regression must still be caught here, not swallowed by `it.fails()`).
 * 2. **Separation** — every attack fixture still rejects, and each
 *    assertion names WHICH budget caught it (the catch-split) — a
 *    multiplier change that silently moves an attack from
 *    complexity-caught to admitted fails loudly here, not quietly.
 * 3. **The table** — printed on EVERY run, pass or fail (`npm run test:cost`
 *    itself passes `--reporter=verbose`, task-2-review.md I-1: vitest only
 *    flushes buffered console output for a FAILING file under the default
 *    reporter, which means a green run — the one where drift is still small
 *    enough to watch, not yet large enough to fail — printed nothing), so
 *    CI logs (and a reviewer's diff of this file) show `fixture → breadth /
 *    complexity / % of each budget` without anyone re-deriving it by hand.
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
   * adopting the 70% ruling before Task 3 moves any number. The fixture
   * itself is NEVER exempted (see the Headroom describe block below): only
   * the one complexity-headroom assertion known to fail today is deferred,
   * via a SEPARATE `it.fails()` test that carries nothing else — schema
   * validity, admission, and breadth headroom are still enforced by a plain,
   * always-green-unless-regressed `it()` alongside it. RED the moment the
   * deferred assertion stops failing (i.e. the moment Task 3's budget raise
   * clears it), which is the forcing function that tells Task 3 to remove
   * the marker.
   */
  readonly deferredToTask3?: string;
}

interface RejectFixture {
  readonly verdict: 'reject';
  readonly name: string;
  readonly class: FixtureClass;
  readonly source: string;
  /**
   * Sorted `extensions.code`s `costLimitRule` must report — asserts WHICH
   * budget(s) caught it, not just that something did. Non-empty by
   * construction (`readonly [string, ...string[]]`, not `readonly
   * string[]`) — task-2-review.md, M-3: a plain `string[]` type admits `[]`,
   * which would silently turn a fixture DECLARED `verdict: 'reject'` into an
   * assertion that it is ACCEPTED (`expect(codes).toEqual([])` passes for a
   * genuinely-admitted attack). This type is NOT enforced by `npm run
   * lint`/CI in this repo — test files are excluded from `tsc --noEmit`
   * (same limitation as the `class`-binding types below `Fixture`) — so the
   * "Corpus inventory" describe block's runtime check (`expectedCodes.length
   * > 0`) is the guard that actually runs.
   */
  readonly expectedCodes: readonly [string, ...string[]];
}

type Fixture = AcceptFixture | RejectFixture;

// Array-level class binding (task-2-review.md, I-2 / the (c) ruling, point
// 1: "bind class to group"). Each corpus array's element type intersects
// `class` down to exactly the labels that array is FOR — not merely
// documented as being for — so a fixture declared `class: 'legit-screen'`
// cannot typecheck as a member of `BOUNDARY_FIXTURES` (or vice versa).
//
// CORRECTED CLAIM (an earlier version of this comment overstated what this
// buys in THIS repo's pipeline): `tsconfig.json` excludes `**/*.test.ts`
// from the production build entirely (`npx tsc --noEmit --listFiles`
// confirms this file, `cost-limit.test.ts`, and `cost-test-support.ts` are
// ALL absent), and `npm run lint`'s `tsc --noEmit` step uses that same
// config — so this constraint is NOT enforced by `npm run lint` or CI. It
// still catches a mismatch in an editor's TS language service (real value
// for whoever writes the next fixture), and documents the intended
// invariant precisely. The mechanism actually enforced by `npm run
// test:cost` / CI is the RUNTIME check directly below it, verified
// empirically: pasting the reviewer's exact probe (an 83.7%-complexity
// `legit-screen` fixture into `BOUNDARY_FIXTURES`) is accepted by `esbuild`
// (vitest's transform has no type-checking pass) but reds both the
// "corpus has exactly the fixture counts" and the "every fixture carries
// the class label" tests below — `it('every fixture carries the class
// label its own array is typed for', …)` is the PRIMARY guard in this
// codebase's actual pipeline, not mere defense-in-depth alongside a
// compile-time one.
type LegitAcceptFixture = AcceptFixture & { readonly class: 'legit-screen' | 'near-future' };
type AttackRejectFixture = RejectFixture & { readonly class: 'attack' };
type BoundaryFixture = (AcceptFixture | RejectFixture) & { readonly class: 'boundary' };

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

/**
 * `entries(first:100)` with the Series arm's nested `books` at a
 * caller-chosen `first` — the shape THE BOUNDARY/adjacency proof (below)
 * both build on, parameterized so the corpus fixture and its falsifiable
 * adjacent-value proof share one construction rather than two hand-copied
 * query strings.
 */
const entriesMaxWithSeriesBooksAt = (seriesArmBooksFirst: number): string => `${BOOK_CARD_FRAGMENT}
      { viewer { library { entries(first: 100) {
        edges { node {
          ... on Book { ...BookCard }
          ... on Series { books(first: ${seriesArmBooksFirst}) { edges { node { ...BookCard } } } }
        } }
        pageInfo { hasNextPage endCursor }
      } } } }`;

// ---------------------------------------------------------------------------
// The corpus.
// ---------------------------------------------------------------------------

const LEGIT_FIXTURES: readonly LegitAcceptFixture[] = [
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
      'TODO(Task 3): measures ~74.3% of COMPLEXITY_BUDGET today (22,283 / 30,000) — over the 70% headroom line. Per the design (docs/superpowers/specs/2026-08-03-cost-calibration-suite-design.md §3) Task 3 raises COMPLEXITY_BUDGET off measured legit anchors, which clears this fixture; remove this marker once it does (breadth stays well under 70% throughout — this is a complexity-only deferral, enforced separately below).',
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
      'TODO(Task 3): the REAL admin user-list screen (component/user-progress-row, GET /api/users/:username/progress already ships this over REST) measures ~75.3% of COMPLEXITY_BUDGET today (22,602 / 30,000) — over the 70% headroom line. This is the fixture the design doc and ledger name explicitly: "the admin user list is at 75.3% against a 70% threshold." Per the ruling, the fix is Task 3 RAISING COMPLEXITY_BUDGET off this and the other measured legit anchors (INSTANCE_USER_MULTIPLIER=50 stays — it is the security ceiling, shrinking it is the unsafe direction), not shrinking this fixture. Remove this marker once Task 3 lands (breadth stays well under 70% throughout — this is a complexity-only deferral, enforced separately below).',
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
const ATTACK_FIXTURES: readonly AttackRejectFixture[] = [
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
 * on purpose: "THE BOUNDARY" is constructed to be close to the wall for
 * `COMPLEXITY_BUDGET` (Task 3 moving the budget moves this boundary too,
 * task-4-re-review.md N-1), and "THE TRAP"/the oversize-`first` case test
 * rule-INTERACTION edges (validation-time budget vs. Task 1's
 * execution-time `rejectOversizePage`), not a screen anyone ships. All
 * three are still schema-validated, still measured, and still appear in the
 * printed table.
 *
 * task-2-review.md, (c) adjudication: the exemption is legitimate in
 * principle but was NOT constrained as implemented (an 83.7%-complexity
 * `legit-screen` fixture pasted into this array passed silently). Fixed two
 * ways: (1) `BoundaryFixture`'s type binds membership to `class: 'boundary'`
 * — a real constraint, but NOT one `npm run lint`/CI enforces in this repo
 * (test files are excluded from `tsc --noEmit` — see the type's own doc
 * comment above `LegitAcceptFixture`/`AttackRejectFixture`/`BoundaryFixture`
 * for the verified detail); the "Corpus inventory" describe block's runtime
 * check is the one CI actually runs, and is verified (by literally
 * reproducing the reviewer's probe and reverting it) to catch the mismatch;
 * (2) each fixture that claims "I am the edge" must PAY for that claim with
 * a falsifiable adjacent-value assertion, not just an exemption note — THE
 * TRAP and the oversize-`first` case already had one (they assert
 * reject/accept respectively); THE BOUNDARY's own adjacent-value proof is
 * the dedicated
 * test immediately after this array, below.
 */
const BOUNDARY_FIXTURES: readonly BoundaryFixture[] = [
  {
    verdict: 'accept',
    class: 'boundary',
    name: 'THE BOUNDARY: entries(first:100) + Series-arm books(first:13) — a literal `first` on this inner connection, inside (not exactly at) the wall for COMPLEXITY_BUDGET (task-4-re-review.md, N-1; the TRUE current wall is proved by the adjacency test below)',
    source: entriesMaxWithSeriesBooksAt(13),
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
  // Sorted by class then complexity descending — attacks and the near-wall
  // legit/boundary fixtures surface first, where a reviewer's eye needs to
  // go, rather than in fixture-declaration order.
  const order: Record<FixtureClass, number> = {
    attack: 0,
    boundary: 1,
    'near-future': 2,
    'legit-screen': 3,
  };
  const sorted = [...rows].sort(
    (a, b) => order[a.Class] - order[b.Class] || b.Complexity - a.Complexity
  );
  // eslint-disable-next-line no-console
  console.log(
    `\nCost-calibration table (${sorted.length} rows, BREADTH_BUDGET=${BREADTH_BUDGET}, COMPLEXITY_BUDGET=${COMPLEXITY_BUDGET}, headroom line=${HEADROOM_FRACTION * 100}%):`
  );
  // eslint-disable-next-line no-console
  console.table(sorted);

  // I-3: the table is only a drift-watching deliverable if every corpus
  // fixture actually produced a row — this is the executable version of the
  // old (tautological) "fully partitioned" claim. Every `it()` below that
  // records a row does so exactly once (C-1's split removed the only path
  // that could double-record via `it.fails()` + the global `retry: 1`), so
  // this is a set-equality check, not a count that could hide a swap.
  const recordedNames = new Set(rows.map((row) => row.Fixture));
  const expectedNames = new Set(ALL_FIXTURES.map((fixture) => fixture.name));
  expect(recordedNames).toEqual(expectedNames);
});

// ---------------------------------------------------------------------------
// 1. Headroom — every legit/near-future fixture stays under 70% of BOTH
//    budgets. A DEFERRED fixture (today's known >70% cases) still gets a
//    plain `it()` enforcing schema-validity, admission, and breadth
//    headroom UNCONDITIONALLY — only the one complexity-headroom assertion
//    known to fail today moves into a separate `it.fails()`
//    (task-2-review.md, C-1: at base, the combined `accepts()` + both
//    thresholds lived in ONE `it.fails()` body, so a regression that
//    rejected the fixture OUTRIGHT — e.g. `COMPLEXITY_BUDGET` dropped to
//    20,000 — still reported "expected fail" and stayed green, and the
//    plain acceptance assertions these two screens had at base were never
//    replaced). The `it.fails()` itself goes red the moment Task 3's budget
//    raise clears it, which is the forcing function to remove the marker.
// ---------------------------------------------------------------------------

describe('Headroom — every legit/near-future fixture stays under 70% of both budgets', () => {
  for (const fixture of LEGIT_FIXTURES) {
    if (fixture.deferredToTask3) {
      const deferredReason = fixture.deferredToTask3;
      it(`${fixture.name} — still schema-valid, admitted, and under breadth headroom`, () => {
        accepts(fixture.source); // schema-valid AND admitted by costLimitRule — NEVER deferred
        const cost = costOf(fixture.source);
        recordRow(fixture, cost, 'accept');
        expect(cost.breadth).toBeLessThanOrEqual(HEADROOM_FRACTION * BREADTH_BUDGET);
      });
      it.fails(`[DEFERRED] ${fixture.name} — ${deferredReason}`, () => {
        // Deliberately does NOT call `accepts()`/`recordRow` — this test
        // carries ONLY the one assertion known to fail today; the sibling
        // `it()` above already proved the fixture is real and admitted, and
        // already recorded its row.
        expect(costOf(fixture.source).complexity).toBeLessThanOrEqual(
          HEADROOM_FRACTION * COMPLEXITY_BUDGET
        );
      });
    } else {
      it(`${fixture.name} — stays under ${HEADROOM_FRACTION * 100}% of both budgets`, () => {
        accepts(fixture.source); // schema-valid AND admitted by costLimitRule
        const cost = costOf(fixture.source);
        recordRow(fixture, cost, 'accept');
        expect(cost.breadth).toBeLessThanOrEqual(HEADROOM_FRACTION * BREADTH_BUDGET);
        expect(cost.complexity).toBeLessThanOrEqual(HEADROOM_FRACTION * COMPLEXITY_BUDGET);
      });
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
      recordRow(fixture, cost, codes.join('+') || 'accept'); // recorded before the pass/fail check below
      expect(codes).toEqual([...fixture.expectedCodes].sort());
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Boundary — pinned edge-of-model behaviour, exempt from the Headroom
//    group by construction (see BOUNDARY_FIXTURES's own doc comment above).
//    Each fixture's row is recorded BEFORE the pass/fail check that could
//    throw (task-2-review.md, M-1) — the moment a boundary fixture's
//    verdict flips is the moment its number matters most.
// ---------------------------------------------------------------------------

describe('Boundary — pinned edge-of-model fixtures (not headroom-checked by design)', () => {
  for (const fixture of BOUNDARY_FIXTURES) {
    it(`${fixture.name}`, () => {
      assertSchemaValid(fixture.source);
      const cost = costOf(fixture.source);
      const errors = runCostLimitRule(fixture.source);
      const codes = [...errors].map((error) => String(error.extensions?.['code'])).sort();
      recordRow(fixture, cost, codes.join('+') || 'accept');
      if (fixture.verdict === 'accept') {
        expect(codes).toEqual([]);
      } else {
        expect(codes).toEqual([...fixture.expectedCodes].sort());
      }
    });
  }

  // task-2-review.md, (c) point 2 / M-4(b): THE BOUNDARY must pay for its
  // "I am the edge" exemption with a falsifiable adjacent-value proof, not
  // just an exemption note — this existed as unasserted prose at base
  // ("`first: 14` measures complexity 25,903 and would not [clear]") and
  // was lost entirely in the move. Made executable here, with corrected
  // numbers: DIRECT measurement (not the stale base-repo prose, which
  // predates the 25,000→30,000 raise) shows `first: 14` measures 25,903 —
  // UNDER 30,000 — so it does NOT reject; the stale claim was already
  // flagged, in different words, by `cost-limit.ts`'s own current
  // `COMPLEXITY_BUDGET` doc comment: "13 was never the exact boundary these
  // tests claimed to pin, only A value inside the accepted range; the
  // boundary itself moving from 13→16 is exactly why §Q no longer states a
  // magic number as if it were fixed." The TRUE current wall, matching that
  // same doc comment exactly, is between `first: 16` (29,303, admitted) and
  // `first: 17` (31,003, rejected) — asserted directly below. This is a
  // correction to the review's own suggested "first:13 accepts AND first:14
  // rejects" pairing, not a deviation from its intent: the intent (a
  // falsifiable pin that reds under Task 3's raise) is preserved; only the
  // adjacent value is corrected to one that is actually true today.
  // NOTE: this test deliberately does NOT call `recordRow` — the two probe
  // queries below are a falsifiable PROOF about the wall's location, not
  // named corpus fixtures, and are intentionally absent from `ALL_FIXTURES`
  // (they'd otherwise fail the "Corpus inventory" describe block's pinned
  // counts and the `afterAll` coverage check, both of which assert the
  // table's rows are exactly the 26 named fixtures, no more).
  it("THE BOUNDARY adjacency proof: Series-arm books(first:16) accepts AND books(first:17) rejects — the TRUE current wall for entries(first:100)+BookCard, per cost-limit.ts COMPLEXITY_BUDGET's own doc comment", () => {
    const admitted = entriesMaxWithSeriesBooksAt(16);
    const rejected = entriesMaxWithSeriesBooksAt(17);
    assertSchemaValid(admitted);
    assertSchemaValid(rejected);

    expect(runCostLimitRule(admitted)).toEqual([]);

    const rejectedCodes = [...runCostLimitRule(rejected)]
      .map((error) => String(error.extensions?.['code']))
      .sort();
    expect(rejectedCodes).toEqual(['QUERY_COMPLEXITY']);
  });
});

// ---------------------------------------------------------------------------
// Corpus inventory — pinned counts and cross-array class binding, replacing
// the tautological "fully partitioned" check (task-2-review.md, I-3: the old
// version asserted `ALL_FIXTURES.length === LEGIT.length + ATTACK.length +
// BOUNDARY.length`, which holds by construction — `ALL_FIXTURES` IS that
// spread — and can never red).
// ---------------------------------------------------------------------------

describe('Corpus inventory — pinned counts, not a tautology', () => {
  it('the corpus has exactly the fixture counts this suite is calibrated against (a deliberate, reviewed edit changes these numbers)', () => {
    const legitScreenCount = LEGIT_FIXTURES.filter((f) => f.class === 'legit-screen').length;
    const nearFutureCount = LEGIT_FIXTURES.filter((f) => f.class === 'near-future').length;
    expect(legitScreenCount).toBe(8);
    expect(nearFutureCount).toBe(3);
    expect(LEGIT_FIXTURES.length).toBe(11);
    expect(ATTACK_FIXTURES.length).toBe(12);
    expect(BOUNDARY_FIXTURES.length).toBe(3); // task-2-review.md, (c) point 3: caps the boundary exemption
    expect(ALL_FIXTURES.length).toBe(26);
  });

  // task-2-review.md, I-2 point 1: THIS is the guard `npm run lint`/CI
  // actually runs — the `LegitAcceptFixture`/`AttackRejectFixture`/
  // `BoundaryFixture` type constraints above are real but NOT enforced by
  // `tsc --noEmit` in this repo (it excludes `**/*.test.ts` entirely; see
  // that type's own doc comment for the verified detail) and vitest's
  // `esbuild` transform strips types without checking them, so a
  // type-invalid fixture object reaches this array at runtime unchanged.
  // Verified: reproducing the reviewer's exact probe (an 83.7%-complexity
  // `legit-screen` fixture appended to `BOUNDARY_FIXTURES`) reds this test
  // (and the pinned-count test above it), then reverting restores green.
  it('every fixture carries the class label its own array is typed for', () => {
    for (const fixture of LEGIT_FIXTURES) {
      expect(['legit-screen', 'near-future']).toContain(fixture.class);
    }
    for (const fixture of ATTACK_FIXTURES) expect(fixture.class).toBe('attack');
    for (const fixture of BOUNDARY_FIXTURES) expect(fixture.class).toBe('boundary');
  });

  // task-2-review.md, M-3: `readonly [string, ...string[]]` (non-empty
  // tuple) is, for the SAME reason as the class-binding types above, not
  // enforced by `npm run lint` in this repo (test files excluded from `tsc
  // --noEmit`). Runtime backstop: a `reject`-verdict fixture with zero
  // expected codes would make `expect(codes).toEqual([...expectedCodes])`
  // pass for a genuinely-ADMITTED attack — this catches that directly.
  it('every reject-verdict fixture names at least one expected code (M-3: a reject fixture with zero codes would assert admission, not rejection)', () => {
    for (const fixture of ATTACK_FIXTURES) expect(fixture.expectedCodes.length).toBeGreaterThan(0);
    for (const fixture of BOUNDARY_FIXTURES) {
      if (fixture.verdict === 'reject') expect(fixture.expectedCodes.length).toBeGreaterThan(0);
    }
  });
});
