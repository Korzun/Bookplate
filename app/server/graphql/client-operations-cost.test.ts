import * as fs from 'fs';
import * as path from 'path';

import { BREADTH_BUDGET, COMPLEXITY_BUDGET } from './cost-limit';
import { accepts, costOf } from './cost-test-support';

/**
 * The client's shipped operations, measured against the same budgets the
 * enforcing rule uses — NOT hand-copied fixtures, which drift from what
 * actually ships.
 *
 * `accepts()` runs schema validity plus the REAL `costLimitRule` through
 * `validate()`, exactly as a live request does — which a bare `costOf()`
 * measurement would not. Schema validity is what catches a `last`/`before` on
 * `Library.entries`, which declares neither argument (see the
 * `entriesConnection` doc comment in `schema/library/model.ts`); it used to be
 * a resolver-level BACKWARD_PAGINATION_UNSUPPORTED that only a real request
 * would surface. `Library.progress` was in that sentence until it became a
 * `t.prismaConnection` and gained both arguments; the cost model already
 * prices `last` and `first` identically (`cost-limit.ts`'s
 * `pageSizeMultiplier`, the I-1 fix), so that gained no pricing gap — measured,
 * both shipped progress operations cost exactly what they did before
 * (`MyProgressList` 32/2507, `UserProgressList` 33/2508).
 *
 * NOTE on page sizes: a variable-valued `first`/`last` is priced at that
 * field's `maxSize`, not its default (cost-limit.ts, `multiplierFor`). Prefer
 * literal page sizes in client documents.
 */
const MANIFEST_PATH = path.join(
  __dirname,
  '..',
  '..',
  'client',
  'src',
  'gql',
  'persisted-documents.json'
);

/** The CI `Cost calibration` job's own threshold. */
const HEADROOM = 0.7;

const loadManifest = (): Record<string, string> =>
  JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as Record<string, string>;

describe('shipped client operations', () => {
  it('has a generated manifest to measure', () => {
    expect(fs.existsSync(MANIFEST_PATH)).toBe(true);
    expect(Object.keys(loadManifest()).length).toBeGreaterThan(0);
  });

  it('every operation is valid and admitted by the real cost rule', () => {
    for (const [hash, source] of Object.entries(loadManifest())) {
      try {
        accepts(source);
      } catch (error) {
        throw new Error(`operation ${hash} was rejected:\n${source}\n\n${String(error)}`);
      }
    }
  });

  it(`every operation stays under ${HEADROOM * 100}% of both budgets`, () => {
    const rows: string[] = [];
    const over: string[] = [];

    for (const [hash, source] of Object.entries(loadManifest())) {
      const cost = costOf(source);
      const breadthPct = cost.breadth / BREADTH_BUDGET;
      const complexityPct = cost.complexity / COMPLEXITY_BUDGET;
      const name = /(?:query|mutation|subscription)\s+(\w+)/.exec(source)?.[1] ?? hash.slice(0, 8);

      rows.push(
        `${name.padEnd(34)} breadth ${String(cost.breadth).padStart(3)} (${(breadthPct * 100).toFixed(1)}%)` +
          `  complexity ${String(cost.complexity).padStart(6)} (${(complexityPct * 100).toFixed(1)}%)`
      );
      if (breadthPct > HEADROOM || complexityPct > HEADROOM) over.push(name);
    }

    // Printed on every run, pass or fail — the same contract the calibration
    // suite follows, so the table is the current-as-of-HEAD source of truth.
    console.log('\nShipped client operations:\n' + rows.join('\n') + '\n');

    expect(over).toEqual([]);
  });
});
