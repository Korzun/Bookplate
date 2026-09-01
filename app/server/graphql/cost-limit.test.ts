import { GraphQLError, parse, validate, type DocumentNode } from 'graphql';

import { BREADTH_BUDGET, COMPLEXITY_BUDGET, costLimitRule, type OperationCost } from './cost-limit';
import { costOf } from './cost-test-support';
import { schema } from './schema';

// Real-HTTP tests (logging spies, `createGraphqlHandler`, the regression
// suite's integration-level twins, the GraphiQL end-to-end check) live in
// `cost-limit-integration.test.ts` — same file split `depth-limit.ts` /
// `depth-limit-integration.test.ts` already use. This file stays unit-level:
// pure `measureOperationCost` boundary math plus `validate()`-driven
// `costLimitRule` assertions, no HTTP, no harness, no mocked logger. The
// fixture CORPUS (every legit/near-future ACCEPT fixture, every attack
// REJECT fixture) lives in `cost-calibration.test.ts`, which owns the
// headroom/separation/table assertions over it — this file keeps only
// rule-behaviour: memoization, cycles, introspection exemption, arg pricing.
// `costOf`/`accepts`/`runCostLimitRule` are shared with that file via
// `cost-test-support.ts` (one implementation, not two copies).

describe('measureOperationCost — boundary math (real schema, needed for args-aware multipliers)', () => {
  it('a single leaf field is breadth 1, complexity 1 (FIELD_COST)', () => {
    expect(costOf('{ viewer { id: username } }')).toEqual({ breadth: 2, complexity: 2 });
  });

  it('breadth SUMS siblings; depth takes their max — a field with a sub-selection contributes 1 + its own children', () => {
    // `Viewer.username` (leaf) and `Viewer.isAdmin` (leaf) are siblings under
    // `viewer` — breadth must count BOTH (1 + 1 + 1 = 3), unlike depth's max.
    expect(costOf('{ viewer { username isAdmin } }')).toEqual({ breadth: 3, complexity: 3 });
  });

  it('an inline fragment does not itself add a breadth/complexity node — same transparency depth-limit.ts gives depth', () => {
    const withoutFragment = costOf('{ viewer { library { book(id: "x") { title } } } }');
    const withFragment = costOf(
      '{ viewer { library { book(id: "x") { ... on Book { title } } } } }'
    );
    expect(withFragment).toEqual(withoutFragment);
  });

  it('a fragment spread does not itself add a breadth/complexity node, and is computed once regardless of type condition position', () => {
    const withoutFragment = costOf('{ viewer { library { book(id: "x") { title author } } } }');
    const withFragment = costOf(
      '{ viewer { library { book(id: "x") { ...Frag } } } } fragment Frag on Book { title author }'
    );
    expect(withFragment).toEqual(withoutFragment);
  });

  // Task-3-review, M-5: `rootTypeOf` resolves `schema.getMutationType()` for
  // a mutation operation, but no committed assertion pinned that before this
  // — the code path existed, unexercised.
  it('resolves the mutation root type, not just the query root', () => {
    const mutation = costOf('mutation { progressDelete(input: { id: "u" }) { __typename } }');
    // progressDelete(1) + __typename(1) = 2, no multiplier (not one of the 5 bounded fields).
    expect(mutation).toEqual({ breadth: 2, complexity: 2 });
  });

  // Byte-identical to `depth-limit.test.ts`'s `LIBRARY_GRID_FIXTURE` (minus
  // its `... on Book {}` line wrapping, immaterial to parsing) — the same
  // fixture `depth-limit.ts`'s calibration comment pins at depth 6. Measured
  // via `probe-8-task3-calibration.ts` against the real schema.
  it('measures the library-grid calibration fixture (thin card) at breadth 16, complexity 263', () => {
    const GRID = `{ viewer { library { entries(first: 20) {
      edges { node { ... on Book {
        series { id name }
        progress { percentage }
        validation { id valid }
      } } }
      pageInfo { hasNextPage endCursor }
    } } } }`;

    expect(costOf(GRID)).toEqual({ breadth: 16, complexity: 263 });
  });

  // Byte-identical to `depth-limit-integration.test.ts`'s "grid + Series arm
  // + full card" fixture (depth 11, the richest LEGITIMATE shape that
  // exercise found) — both `LibraryEntry` union arms, a `BookCard` fragment
  // reused across both (fragment-composed, as Apollo generates), including
  // `pendingFix.state.autoFixes`. This is the richest legitimate screen this
  // task's own calibration measured; its breadth (41) is BYTE-IDENTICAL to
  // `@pothos/plugin-complexity`'s own measurement of the same fixture
  // (task-2-report.md, probe 5's real-schema table) — breadth is a
  // structural, schema-agnostic-ISH count, so two independent
  // implementations agreeing on it is a real cross-check, not a coincidence.
  it('measures the grid + Series-arm + full-card fixture at breadth 41, complexity 3823 — the richest legitimate screen calibrated', () => {
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

    expect(costOf(GRID_WITH_SERIES_ARM)).toEqual({ breadth: 41, complexity: 3823 });
  });
});

describe('multiplierFor — args-aware connection weighting (via measureOperationCost)', () => {
  // Isolate the multiplier's effect: a fixed one-field connection body
  // (`edges { node { id } }`, complexity 1+1+1=3 as a bare sub-selection —
  // FIELD_COST for `edges`, `node`, `id`) so the ONLY thing that changes
  // between cases is `entries`'s own multiplier. `entries` itself sits under
  // `viewer { library { … } }`, each contributing its OWN FIELD_COST(1) with
  // multiplier 1 (neither is a bounded connection) on top of `entries`'s own
  // total — `totalComplexity(mult)` accounts for that wrapping explicitly
  // rather than asserting a bare `entries`-only number.
  const entriesQuery = (firstArg: string): string =>
    `{ viewer { library { entries${firstArg} { edges { node { id } } } } } }`;
  const totalComplexity = (multiplier: number): number => {
    const edgesNodeId = 3; // edges(1) + node(1) + id(1), no multiplier below `entries`
    const entries = 1 + multiplier * edgesNodeId;
    const library = 1 + entries;
    const viewer = 1 + library;
    return viewer;
  };

  it("omitted `first` uses CONNECTION_LIMITS.libraryEntries.defaultSize (20) — the CONTROLLER RULING's own instruction", () => {
    const { complexity } = costOf(entriesQuery(''));
    expect(complexity).toBe(totalComplexity(20));
  });

  it('a literal `first` within maxSize uses that literal value', () => {
    const { complexity } = costOf(entriesQuery('(first: 7)'));
    expect(complexity).toBe(totalComplexity(7));
  });

  it('a literal `first` past maxSize (100) is CLAMPED, not left unbounded — Task 1 rejects this at execution time, this rule just avoids reporting a nine-digit number', () => {
    const { complexity } = costOf(entriesQuery('(first: 999999999)'));
    expect(complexity).toBe(totalComplexity(100));
  });

  it('a variable-valued `first` (unreadable at validation time) falls back to maxSize — worst case, not a guess', () => {
    const { complexity } = costOf(
      'query Q($n: Int) { viewer { library { entries(first: $n) { edges { node { id } } } } } }'
    );
    expect(complexity).toBe(totalComplexity(100));
  });

  // Task-3-review, I-1: `Series.books`/`Validation.messages` genuinely
  // support backward pagination (Task 1 only rejects an OVERSIZE `last`,
  // same as `first` — `rejectOversizePage`, `pagination.ts`), so a
  // `last:100` read fetches exactly as many rows as `first:100` — reading
  // only `first` priced it at `defaultSize` regardless, a 120× underprice
  // measured on the real amplification fixtures (task-3-report.md §4).
  const booksQuery = (arg: string): string =>
    `{ viewer { library { book(id: "x") { series { books${arg} { edges { node { id } } } } } } } }`;
  const totalComplexityForBooks = (multiplier: number): number => {
    const edgesNodeId = 3;
    const books = 1 + multiplier * edgesNodeId;
    const series = 1 + books;
    const book = 1 + series;
    const library = 1 + book;
    const viewer = 1 + library;
    return viewer;
  };

  it('a literal `last` prices exactly like a literal `first` of the same value — the bypass this task fixed', () => {
    const { complexity } = costOf(booksQuery('(last: 7)'));
    expect(complexity).toBe(totalComplexityForBooks(7));
  });

  it('`last` past maxSize is clamped, same as `first`', () => {
    const { complexity } = costOf(booksQuery('(last: 999999999)'));
    expect(complexity).toBe(totalComplexityForBooks(100));
  });

  it('a variable-valued `last` falls back to maxSize, same as a variable-valued `first`', () => {
    const { complexity } = costOf(
      'query Q($n: Int) { viewer { library { book(id: "x") { series { books(last: $n) { edges { node { id } } } } } } } }'
    );
    expect(complexity).toBe(totalComplexityForBooks(100));
  });

  it('when both `first` and `last` are present, the LARGER wins — this rule never underprices relative to reading either alone', () => {
    const { complexity } = costOf(booksQuery('(first: 3, last: 30)'));
    expect(complexity).toBe(totalComplexityForBooks(30));
  });

  it('a non-connection field with a `first`-shaped argument name is unaffected — the multiplier is keyed by (parent type, field), not by argument name alone', () => {
    // `Book.progress` is a plain field (no `first` arg at all in the SDL) —
    // sanity check that `multiplierFor` only fires on the 12 registered
    // coordinates (5 connections + 7 unbounded lists, I-4), never
    // generically on "any list-ish field".
    const flat = costOf('{ viewer { library { book(id: "x") { progress { percentage } } } } }');
    // progress{percentage}: percentage=1; progress = FIELD_COST(1) + 1*1 = 2;
    // book = 1 + 1*2 = 3; library = 1 + 1*3 = 4; viewer = 1 + 1*4 = 5.
    expect(flat).toEqual({ breadth: 5, complexity: 5 });
  });

  it('Query.nodes(ids:) multiplies by ids.length, not by a fixed weight — the gap task-2 flagged breadth alone cannot close', () => {
    const three = costOf('{ nodes(ids: ["a", "b", "c"]) { id } }');
    // id = 1; nodes = 1 + 3*1 = 4.
    expect(three).toEqual({ breadth: 2, complexity: 4 });
  });

  it('Query.nodes(ids:) with more ids than CONNECTION_LIMITS.nodesBatch (100) is clamped, matching the connection case', () => {
    const ids = Array.from({ length: 150 }, (_, i) => `"id${i}"`).join(', ');
    const { complexity } = costOf(`{ nodes(ids: [${ids}]) { id } }`);
    expect(complexity).toBe(1 + 100 * 1);
  });

  it('Query.nodes(ids:) with a variable-valued ids list falls back to nodesBatch — same worst-case reasoning as connections', () => {
    const { complexity } = costOf('query Q($ids: [ID!]!) { nodes(ids: $ids) { id } }');
    expect(complexity).toBe(1 + 100 * 1);
  });
});

/**
 * Task-3-review ROUND 2, I-4: `Library.series: [Series!]!` is an unbounded
 * `findMany` (`library/model.ts`) that reached `Series.books` (a
 * priced connection) while itself pricing at the default multiplier of 1 —
 * a free `×S` (S = the library's series count) handed to anything nested
 * under it. Measured pre-fix: `{ series { books(first:12) { … }
 * books(first:100) { … } } }` (132 bytes) scored breadth 11 / complexity
 * 3,652 / depth 10 — INSIDE every one of this task's own calibrated
 * envelopes (41 / 3823 / 12) — while fetching `S × 1,200` rows, against the
 * richest calibrated legit screen's ~220 rows at complexity 3823. Fixed via
 * `UNBOUNDED_LIST_FIELD_LIMITS` — see `cost-limit.ts`'s doc comment there
 * for the full inventory: 25 composite-element list fields total, 9 priced
 * (7 here + `Library.searchSuggestions`/`SuggestionGroup.items`, priced
 * separately below — round-2 re-review, I-5), 1 priced elsewhere
 * (`Query.nodes`), 4 are a priced connection's own `edges` (not
 * double-counted), 11 leaf-terminating (nothing to multiply).
 */
describe('UNBOUNDED_LIST_FIELD_LIMITS — I-4, unbounded plain lists that reach a priced connection', () => {
  it('Library.series prices its children at the assumed worst case (100), same as a real connection would', () => {
    const { complexity } = costOf(
      '{ viewer { library { series { books(first: 100) { edges { node { id } } } } } } }'
    );
    // edges{node{id}} = 3; books(first:100) = 1 + 100*3 = 301;
    // series (multiplier 100) = 1 + 100*301 = 30101; library = 1+30101=30102; viewer = 1+30102=30103.
    expect(complexity).toBe(30103);
  });

  it("Library.pendingFixes gets the SAME class of pricing (PendingFix.book.series.books reaches the identical connection one hop further) — kept as a committed fixture per the review's own instruction", () => {
    const { breadth, complexity } = costOf(
      '{ viewer { library { pendingFixes { book { series { books(first: 100) { edges { node { id } } } } } } } } }'
    );
    expect({ breadth, complexity }).toEqual({ breadth: 9, complexity: 30303 });
  });

  it('the I-4 sharpest row (2 hops through Library.series) now measures far OUTSIDE the calibrated legit envelope (41 breadth / 3823 complexity) — it must never again land inside it', () => {
    const source = `{ viewer { library { series {
      books(first: 12) { edges { node { series {
        books(first: 100) { edges { node { id } } }
      } } } }
    } } } }`;
    const { breadth, complexity } = costOf(source);
    // Pre-fix (task-3-review.md, I-4): breadth 11 / complexity 3,652 — BOTH
    // inside the legit envelope. Post-fix: complexity clears it by ~95x;
    // breadth (unaffected by any multiplier, by design — see cost-limit.ts's
    // own doc comment on why breadth prices repetition, not cardinality)
    // stays inside the breadth envelope, which is expected and matches the
    // review's own "breadth CAN be enforced loosely, complexity is the
    // separator for this family" conclusion (task-3-review.md, I-1(d)).
    expect(breadth).toBe(11);
    expect(complexity).toBeGreaterThan(3823 * 10); // clearly outside, not marginally
    expect(complexity).toBe(364903);
  });

  it('a control: the IDENTICAL 2-hop shape rooted at nodes() instead of Library.series is UNCHANGED by this fix — proves the fix targets the unbounded field, not the shape', () => {
    const source = `{ nodes(ids: ["x"]) { ... on Series {
      books(first: 12) { edges { node { series {
        books(first: 100) { edges { node { id } } }
      } } } }
    } } }`;
    const { breadth, complexity } = costOf(source);
    // task-3-review.md's own control measured 3,650 for this exact shape
    // (its `edges { cursor }` vs this fixture's `edges { node { id } }`
    // account for the +/-3 in complexity and +2 breadth vs their number).
    expect(breadth).toBe(9);
    expect(complexity).toBe(3650);
  });

  // Round-2 re-review, I-6: `Viewer.users` prices at `INSTANCE_USER_MULTIPLIER`
  // (50), NOT the shared library-scale `UNBOUNDED_LIST_MULTIPLIER` (100) —
  // see `cost-limit.ts`'s doc comment for why (Bookplate is a self-hosted,
  // single-instance app; total user count is a smaller-scale quantity than
  // a library's book/series count, and the flat 100 was measured to
  // compound into false rejections of shipping admin screens, below).
  it('Viewer.users (admin, every user on the instance) reaching User.library.entries is priced at 50, not free and not the library-scale 100', () => {
    const { complexity } = costOf(
      '{ viewer { users { library { entries(first: 100) { edges { node { ... on Book { id } } } } } } } }'
    );
    // edges{node{...on Book{id}}} = 3; entries(first:100){edges} = 1+100*3 = 301;
    // library{entries} = 1+301=302; users(mult 50){library} = 1+50*302=15101; viewer{users}=1+15101=15102.
    expect(complexity).toBe(15102);
    expect(complexity).toBeGreaterThan(3823); // still clears the legit complexity max
  });

  // Tight, seen-to-fail-verified pins for the 3 remaining registered
  // coordinates — NOT loose `>N` thresholds. `Viewer.devices`'s fixture also
  // nests `Series.books` (a connection priced independently of I-4), so a
  // loose ">10"-style assertion would pass whether or not THIS field's own
  // multiplier fired.
  //
  // Round-3, M-8: `Device.enabledUsers` now shares `INSTANCE_USER_MULTIPLIER`
  // (50) with `Viewer.users`, not its own `INSTANCE_DEVICE_MULTIPLIER`
  // (task 3: re-derived 20 -> 100 and renamed from HOUSEHOLD_DEVICE_MULTIPLIER,
  // `cost-limit.ts`'s own doc comment above that constant) — it prices a SUBSET of the instance's users
  // (`device/model.ts`'s `where: {deviceAccess: {some: {deviceId}}}`),
  // which cannot exceed the instance's own user count, so it must never be
  // priced tighter than `Viewer.users` itself.
  it('Viewer.devices -> Device.enabledUsers -> User.library.series.books compounds three multipliers (100 x 50 x 100 — instance devices x instance users x library series)', () => {
    const { breadth, complexity } = costOf(
      '{ viewer { devices { enabledUsers { library { series { books(first: 100) { edges { node { id } } } } } } } } }'
    );
    // books(first:100){edges{node{id}}}=301; series(mult 100, library-scale, unchanged){books}=1+100*301=30101;
    // library{series}=1+30101=30102; enabledUsers(mult 50){library}=1+50*30102=1505101;
    // devices(mult 100, task 3 re-derivation){enabledUsers}=1+100*1505101=150510101;
    // viewer{devices}=1+150510101=150510102.
    expect({ breadth, complexity }).toEqual({ breadth: 9, complexity: 150510102 });
  });

  // Round-3, M-9 (correcting a prior version of this test, which mislabeled
  // itself "the REAL admin device-list screen" using only `id name slug` —
  // it never fetches `enabledUsers` at all): `page/device-list/index.tsx`
  // spreads `DeviceRowFragment` (`component/device-row/index.tsx`), exactly
  // the 8 fields below, and NOTHING under `enabledUsers`. Enabled users are
  // a SEPARATE read — today `DeviceUsersDocument` (`graphql/device.ts`,
  // `viewer { devices { id enabledUsers { id } } }`, `id` only), issued by
  // `component/device-form` when an admin edits ONE device; before the
  // client's GraphQL migration, the REST `GET /api/devices/:id/users` served
  // it, and Phase 0 has since removed that route. Not part of the list
  // screen either way.
  //
  // (Doc sweep: this note cited `provider/device/type.ts` for the 8-field
  // list and a `useDeviceUsers` hook; the client migration deleted both.
  // The 8 fields and the enabled-users read are named above at their live
  // homes.)
  it('the REAL device-list screen (8 real Device fields, no enabledUsers) is cheap — this is what ships today', () => {
    const { breadth, complexity } = costOf(
      '{ viewer { devices { id name slug coverWidth coverHeight coverFit bwCover simplify } } }'
    );
    // devices(mult 100, task 3 re-derivation){8 leaves}=1+100*8=801; viewer{devices}=1+801=802.
    expect({ breadth, complexity }).toEqual({ breadth: 10, complexity: 802 });
    expect(complexity).toBeLessThan(3823);
  });

  it('a PLAUSIBLE (not shipped) GraphQL consolidation of the device-list screen + enabledUsers still measures well inside the legit envelope', () => {
    const { breadth, complexity } = costOf(
      '{ viewer { devices { id name slug coverWidth coverHeight coverFit bwCover simplify enabledUsers { id username } } } }'
    );
    // Previously recorded as 882 (id/name/slug only), then 982 (8 fields,
    // enabledUsers still at the pre-M-8 device constant, then named
    // HOUSEHOLD_DEVICE_MULTIPLIER), then 2182 (M-8 raised Device.enabledUsers
    // to INSTANCE_USER_MULTIPLIER=50, devices still at the pre-Task-3 value,
    // 20) — all stale now that task 3 re-derived and renamed the device
    // constant to INSTANCE_DEVICE_MULTIPLIER=100:
    // enabledUsers{id,username}=2; enabledUsers(50)=1+50*2=101;
    // devices(mult 100){8 leaves + enabledUsers(101)}=1+100*(8+101)=10901;
    // viewer=1+10901=10902.
    expect({ breadth, complexity }).toEqual({ breadth: 13, complexity: 10902 });
    // M-2 (task-3-review.md): a sanity upper bound, replacing the stale
    // `toBeLessThan(3823)` this test used before Task 3's budget raise moved
    // this fixture past that comparator — the fixture's REAL headroom
    // against COMPLEXITY_BUDGET (33.0% at time of writing) is asserted
    // permanently by `cost-calibration.test.ts`'s corpus, not here; this
    // guard only confirms the fixture still ADMITS at all, never silently.
    expect(complexity).toBeLessThan(COMPLEXITY_BUDGET);
  });

  it('Device.enabledUsers in isolation (no nested connection at all) is still priced on its own, at instance-user scale', () => {
    const { breadth, complexity } = costOf('{ viewer { devices { enabledUsers { username } } } }');
    // username=1; enabledUsers(mult 50){username}=1+50*1=51;
    // devices(mult 100, task 3 re-derivation){enabledUsers}=1+100*51=5101; viewer{devices}=1+5101=5102.
    expect({ breadth, complexity }).toEqual({ breadth: 4, complexity: 5102 });
  });

  // Round-3, I-7: `Book.lineage` now uses its own `BOOK_LINEAGE_MULTIPLIER`
  // (20, per-book re-import-event scale) instead of the library-scale 100 —
  // see `cost-limit.ts`'s doc comment for the full reasoning and the
  // near-miss this fixes (the `BookCard`-on-lineage calibration fixture,
  // below, previously measured 4,004 / breadth 44 at the old 100 — OVER
  // both the complexity ceiling (104.7%) and the breadth max, for ~2 real
  // rows).
  it('Book.lineage -> newBook.series.books is priced at per-book scale (20), not library scale (100)', () => {
    const { breadth, complexity } = costOf(
      '{ viewer { library { book(id: "x") { lineage { newBook { series { books(first: 100) { edges { node { id } } } } } } } } } }'
    );
    // books(first:100){edges{node{id}}}=301; series{books}=1+1*301=302 (Book.series is a singular field, mult 1);
    // newBook{series}=1+1*302=303; lineage(mult 20){newBook}=1+20*303=6061; book{lineage}=1+6061=6062;
    // library{book}=1+6062=6063; viewer{library}=1+6063=6064.
    expect({ breadth, complexity }).toEqual({ breadth: 10, complexity: 6064 });
  });

  it("the BookCard-on-lineage shape (the obvious next UI step, reusing the app's own shared fragment) now lands well inside the legit envelope on BOTH metrics", () => {
    const source = `
      fragment BookCard on Book {
        series { id name }
        progress { percentage }
        validation { id valid }
        pendingFix { state { autoFixes { field kind from to } } }
      }
      { viewer { library { book(id: "x") { lineage {
          oldId newId timestamp type
          oldBook { ...BookCard }
          newBook { ...BookCard }
        } } } } }`;
    const { breadth, complexity } = costOf(source);
    // Pre-fix (task-3-re-review-3.md, I-7): breadth 44 / complexity 4,004 —
    // OVER the breadth max (41) AND 104.7% of the complexity ceiling
    // (3,823), for ~2 real rows. Post-fix, both metrics clear with margin.
    expect(breadth).toBeLessThanOrEqual(41);
    expect(complexity).toBeLessThan(3823);
    expect({ breadth, complexity }).toEqual({ breadth: 40, complexity: 724 });
  });
});

/**
 * Round-2 re-review, I-5: `Library.searchSuggestions` / `SuggestionGroup.items`
 * were ruled SAFE (priced at 1) because `getSearchSuggestions`
 * (`services/search-suggestions.ts`) caps every branch at `LIMIT 30`
 * (4 occurrences), at most 4 groups — but "has a
 * code-enforced bound" was used as grounds for EXEMPTION, when this file's
 * own precedent (`Library.entries` etc.) is to price AT a bound, not skip
 * it. Measured pre-fix: `searchSuggestions { items { book { series {
 * books(first:100) … } } } }` (138 bytes) scored breadth 10 / complexity
 * 307 — inside all three calibrated envelopes — for ~3,000 real rows,
 * while the identical real cost routed through the now-priced
 * `Library.series` scored 30,103 (98x higher for the same cost).
 */
describe('SUGGESTION_FIELD_LIMITS — I-5, "bounded" priced AT its bound, not exempted for having one', () => {
  it('Library.searchSuggestions prices at its real group-count bound (4), SuggestionGroup.items at its real per-group bound (30)', () => {
    const { breadth, complexity } = costOf(
      '{ viewer { library { searchSuggestions(query: "a") { items { book { series { books(first: 100) { edges { node { id } } } } } } } } } }'
    );
    // books(first:100){edges{node{id}}}=301; series{books}=1+1*301=302; book{series}=1+1*302=303;
    // items(mult 30){book}=1+30*303=9091; searchSuggestions(mult 4){items}=1+4*9091=36365; library{searchSuggestions}=1+36365=36366; viewer{library}=1+36366=36367.
    expect({ breadth, complexity }).toEqual({ breadth: 10, complexity: 36367 });
    expect(complexity).toBeGreaterThan(3823 * 9); // clearly outside the legit envelope, not marginally
  });

  it('the SAME real cost through the now-priced Library.series (a single suggestion-sized S=30) scores in the same order of magnitude — the "two prices for one cost" gap this fix closes', () => {
    const suggestionsPath = costOf(
      '{ viewer { library { searchSuggestions(query: "a") { items { book { series { books(first: 100) { edges { node { id } } } } } } } } } }'
    );
    const seriesPath = costOf(
      '{ viewer { library { series { books(first: 100) { edges { node { id } } } } } } }'
    );
    // Before this fix these scored 307 vs 30,103 — a 98x gap for identical
    // real cost. After: both land in the tens of thousands, no longer two
    // prices for one cost.
    expect(suggestionsPath.complexity).toBeGreaterThan(seriesPath.complexity / 10);
    expect(suggestionsPath.complexity).toBeLessThan(seriesPath.complexity * 10);
  });

  it('a real search-as-you-type screen (one query, label/value only, no nested connection) stays well inside the legit envelope', () => {
    const { breadth, complexity } = costOf(
      '{ viewer { library { searchSuggestions(query: "dune") { type items { label value } } } } }'
    );
    expect(complexity).toBeLessThan(3823);
    expect({ breadth, complexity }).toEqual({ breadth: 7, complexity: 251 });
  });

  it('aliasing searchSuggestions (a free-text query arg makes aliases trivially distinct) is priced per-alias like every other field — SUMS, does not collapse', () => {
    const twoAliases = costOf(
      `{
        a: viewer { library { searchSuggestions(query: "a") { items { book { series { books(first: 100) { edges { node { id } } } } } } } } }
        b: viewer { library { searchSuggestions(query: "b") { items { book { series { books(first: 100) { edges { node { id } } } } } } } } }
      }`
    );
    const oneAlias = costOf(
      '{ viewer { library { searchSuggestions(query: "a") { items { book { series { books(first: 100) { edges { node { id } } } } } } } } } }'
    );
    expect(twoAliases.complexity).toBe(oneAlias.complexity * 2);
    expect(twoAliases.breadth).toBe(oneAlias.breadth * 2);
  });
});

/**
 * Task-3-review, I-3: `getIntrospectionQuery()` measures breadth 220 (see
 * task-3-report.md's calibration table) — 5.4× this task's own calibrated
 * legit max of 41 — for the same reason `depth-limit.ts`'s own
 * `isIntrospectionOnly` exemption exists (its own doc comment, its I-1):
 * `__Type.fields.type.ofType.ofType…` is deep, legitimate self-reference,
 * not amplification, and in dev `useSchemaConcealment` is deliberately not
 * installed, so GraphiQL's own schema-fetch reaches this rule.
 */
describe('costLimitRule — introspection exemption', () => {
  const measure = (source: string): OperationCost[] => {
    const measured: OperationCost[] = [];
    validate(schema, parse(source), [costLimitRule((_name, cost) => measured.push(cost))]);
    return measured;
  };

  it('every getIntrospectionQuery() variant produces NO onMeasured call — exempt, same as depth-limit.ts', async () => {
    const { getIntrospectionQuery } = await import('graphql');
    for (const options of [{}, { descriptions: false }, { inputValueDeprecation: true }]) {
      expect(measure(getIntrospectionQuery(options))).toEqual([]);
    }
  });

  it('a client query that merely INCLUDES __schema alongside real fields is still measured — not a bypass', () => {
    const measured = measure('{ __schema { types { name } } viewer { username } }');
    expect(measured).toHaveLength(1);
  });

  it("measureOperationCost (the pure calibration primitive) stays UNEXEMPTED, unlike costLimitRule — it is what records introspection's real number for the report", async () => {
    const { getIntrospectionQuery } = await import('graphql');
    const { breadth, complexity } = costOf(getIntrospectionQuery());
    // Real, large numbers — NOT skipped, NOT zero. `costLimitRule`'s own
    // `onMeasured` callback never fires for this same document (test
    // above); this function is the one the calibration probe calls
    // directly, bypassing that exemption on purpose.
    expect(breadth).toBeGreaterThan(41); // > this task's own calibrated legit max
    expect(complexity).toBeGreaterThan(41);
  });
});

/**
 * Task-3 review (this task's own vetting gate, task-2-report.md): the exact
 * bug pair `@pothos/plugin-complexity` was REJECTED for — an un-memoized
 * fragment walk costing `2^N` (28.3s at N=27) and an un-cycle-guarded walk
 * throwing `RangeError` on a cyclic fragment. `fragment-walk-memo.ts` is
 * this walk's fix; these are its seen-to-fail regression tests — verified by
 * hand (temporarily short-circuiting `resolveFragment`'s cache/in-progress
 * check to always recompute) that both tests below fail without it: the
 * timing test blows past its bound well before N=24, and the cyclic test
 * throws `RangeError: Maximum call stack size exceeded` instead of
 * completing.
 */
describe('costOfSelectionSet — fragment memoization and cycle guard (via costLimitRule)', () => {
  // Each fragment F_i spreads F_(i-1) TWICE — identical construction to
  // `depth-limit.test.ts`'s own `chainedFragmentDoc`, retargeted onto a real
  // field (`Book.title`) since this walk needs real schema type info.
  const chainedFragmentDoc = (n: number): string => {
    const definitions = ['fragment F0 on Book { title }'];
    for (let i = 1; i <= n; i++) {
      definitions.push(`fragment F${i} on Book { x: title ...F${i - 1} y: title ...F${i - 1} }`);
    }
    return `{ viewer { library { book(id: "x") { ...F${n} } } } }\n${definitions.join('\n')}`;
  };

  const runRule = (
    document: DocumentNode,
    onMeasured: (name: string, cost: OperationCost) => void = () => {}
  ) => validate(schema, document, [costLimitRule(onMeasured)]);

  it.each([6, 12, 18, 24, 30])(
    'validates an N=%i chained-fragment amplification document in single-digit ms — Task 4: now CORRECTLY REJECTS it, still in constant time',
    (n) => {
      const document = parse(chainedFragmentDoc(n));

      const start = performance.now();
      const errors = runRule(document);
      const elapsedMs = performance.now() - start;

      // The plugin measured 3550ms at N=24 and 28255ms at N=27 (task-2
      // report, probe 1) — reproducing the un-memoized 2^N curve. Measured
      // here (see task-3-report.md): all of N=6..30 complete in under 2ms.
      // A 500ms bound is the same generosity `depth-limit.test.ts`'s own
      // N=24 timing test uses — comfortably two-plus orders of magnitude
      // below "still exponential" while absorbing CI jitter. This bound is
      // about WALK TIME, not verdict — memoization guarantees the walk
      // stays O(N), it says nothing about how large the resulting number is.
      expect(elapsedMs).toBeLessThan(500);
      // Task 3 asserted `errors` was always `[]` here ("LOG-ONLY: this rule
      // never reports an error, no matter how large the computed cost is").
      // Task 4 arms the rule, and this fixture's construction — each F_i
      // spreads F_(i-1) TWICE — is genuine exponential amplification of
      // REAL selection count (two leaf fields doubling at every level), not
      // an artifact of how the walk is implemented: at N=6 its own breadth
      // already measures 193, over BREADTH_BUDGET (100), and it only grows
      // from there. Rejecting it is the CORRECT verdict a budget exists to
      // produce, not a regression — what this test still proves is that
      // reaching that correct verdict costs O(N) time, not O(2^N); a
      // memo-less version would compute the SAME large numbers (and thus
      // the same rejection) but take exponentially longer to get there.
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.every((error) => error instanceof GraphQLError)).toBe(true);
    }
  );

  it('a self-referential fragment spread does not throw, and reports no validation error (well under either budget)', () => {
    const document = parse(
      '{ viewer { library { book(id: "x") { ...F } } } } fragment F on Book { series { books(first: 1) { edges { node { ...F } } } } }'
    );

    expect(() => runRule(document)).not.toThrow();
    expect(runRule(document)).toEqual([]);
  });

  it('an indirect (mutually recursive) fragment cycle also does not throw', () => {
    const document = parse(
      '{ viewer { library { book(id: "x") { ...A } } } } fragment A on Book { ...B } fragment B on Book { ...A }'
    );

    expect(() => runRule(document)).not.toThrow();
    expect(runRule(document)).toEqual([]);
  });

  it('a fragment with a cyclic branch AND a legitimate field still measures the real one, via onMeasured', () => {
    const document = parse(
      '{ viewer { library { book(id: "x") { ...F } } } } fragment F on Book { ...F title author }'
    );

    const measured: OperationCost[] = [];
    runRule(document, (_name, cost) => measured.push(cost));

    // The cyclic branch contributes 0; `title`/`author` still measure as 2
    // ordinary leaf fields (breadth 2, complexity 2) inside F, wrapped by
    // book/library/viewer.
    expect(measured).toHaveLength(1);
    expect(measured[0]).toEqual({ breadth: 5, complexity: 5 });
  });
});

describe('costLimitRule — operation-name resolution (unaffected by enforcement)', () => {
  const runRule = (source: string, onMeasured: (name: string, cost: OperationCost) => void) =>
    validate(schema, parse(source), [costLimitRule(onMeasured)]);

  it('resolves the operation name the same way operationNameOf does, falling back to "anonymous"', () => {
    const measured: string[] = [];
    runRule('{ viewer { username } }', (name) => measured.push(name));
    expect(measured).toEqual(['anonymous']);

    const measuredNamed: string[] = [];
    runRule('query MyQuery { viewer { username } }', (name) => measuredNamed.push(name));
    expect(measuredNamed).toEqual(['MyQuery']);
  });
});

/**
 * The attack corpus ("Task 4 regression suite" — every proven probe from the
 * query-cost-control ledger, asserting REJECTION and WHICH budget catches
 * it) and the full legit/near-future ACCEPT corpus (Task 3's calibration
 * table + near-future shapes + the Task-1-legal max-page/boundary/trap
 * shapes) have MOVED to `cost-calibration.test.ts`
 * (`.superpowers/sdd/2026-08-03-cost-calibration-suite`, Task 2) — that file
 * now owns the fixture corpus (headroom, separation, and the printed table);
 * this file keeps only rule-behaviour unit tests. `accepts()`/`costOf()`/
 * `runCostLimitRule()` moved to `cost-test-support.ts`, shared by both files
 * (ONE implementation, not two copies).
 */

/**
 * **Task 4, Step 3 — "seen-to-fail both directions" (per the brief and the
 * ledger's own standing discipline): disable each budget independently and
 * confirm the tests that budget alone catches go red.** This is the
 * committed, load-bearing PROOF that both budgets matter, not just a
 * documented claim — run against `BREADTH_BUDGET`/`COMPLEXITY_BUDGET`
 * temporarily patched to `Infinity` one at a time (never both at once — that
 * would just reproduce Task 3's log-only state, already covered above).
 *
 * This describe does NOT patch the exported constants in place (they are
 * real `const`s, not designed to be mutable at runtime, and mutating a
 * shared module export from a test would leak into every other test file
 * importing this module in the same worker). Instead it reproduces each
 * budget's own enforcement check inline, parameterized by a budget value the
 * test controls directly — the exact same comparison `costLimitRule` itself
 * runs (`cost.breadth > BREADTH_BUDGET` / `cost.complexity >
 * COMPLEXITY_BUDGET`), just against `Infinity` for the "disabled" side. This
 * is not a different, weaker check: it is `costLimitRule`'s own two-line
 * enforcement logic, copied here specifically so it can be run with one side
 * disabled without touching module state.
 */
describe('costLimitRule — both budgets are load-bearing (seen-to-fail, both directions)', () => {
  // Reuses the module-level `costOf` (top of file) — same `measureOperationCost`
  // primitive every other describe block in this file already calls.
  const verdictWith = (
    source: string,
    budgets: { breadth: number; complexity: number }
  ): { breadthExceeded: boolean; complexityExceeded: boolean } => {
    const cost = costOf(source);
    return {
      breadthExceeded: cost.breadth > budgets.breadth,
      complexityExceeded: cost.complexity > budgets.complexity,
    };
  };

  const THREE_HOP_CYCLE =
    '{ nodes(ids: ["x"]) { ... on Series { books(first: 100) { edges { node { series { books(first: 100) { edges { node { series { books(first: 100) { edges { node { id } } } } } } } } } } } } } }';
  const SCALAR_LIST_ATTACK = `{ ${Array.from(
    { length: 200 },
    (_, i) => `a${i}: viewer { library { authors subjects } }`
  ).join(' ')} }`;

  it('with BREADTH_BUDGET disabled (Infinity): the 3-hop cycle still rejects (complexity alone catches it) — proves complexity is load-bearing on its own', () => {
    const verdict = verdictWith(THREE_HOP_CYCLE, {
      breadth: Infinity,
      complexity: COMPLEXITY_BUDGET,
    });
    expect(verdict.complexityExceeded).toBe(true);
  });

  it('with COMPLEXITY_BUDGET disabled (Infinity): the 3-hop cycle NO LONGER rejects (breadth 14 stays under BREADTH_BUDGET) — proves complexity was the ONLY thing catching it; disabling it truly opens the hole', () => {
    const verdict = verdictWith(THREE_HOP_CYCLE, { breadth: BREADTH_BUDGET, complexity: Infinity });
    expect(verdict.breadthExceeded).toBe(false);
    expect(verdict.complexityExceeded).toBe(false);
  });

  it('with COMPLEXITY_BUDGET disabled (Infinity): the scalar-list alias attack still rejects (breadth alone catches it) — proves breadth is load-bearing on its own', () => {
    const verdict = verdictWith(SCALAR_LIST_ATTACK, {
      breadth: BREADTH_BUDGET,
      complexity: Infinity,
    });
    expect(verdict.breadthExceeded).toBe(true);
  });

  it('with BREADTH_BUDGET disabled (Infinity): the scalar-list alias attack NO LONGER rejects (complexity 800 stays under COMPLEXITY_BUDGET) — proves breadth was the ONLY thing catching it; disabling it truly opens the hole', () => {
    const verdict = verdictWith(SCALAR_LIST_ATTACK, {
      breadth: Infinity,
      complexity: COMPLEXITY_BUDGET,
    });
    expect(verdict.breadthExceeded).toBe(false);
    expect(verdict.complexityExceeded).toBe(false);
  });
});
