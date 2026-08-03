/**
 * The generic shape of the per-document memoize-by-fragment-name +
 * cycle-guard discipline BOTH of this schema's structural-limit rules need
 * for their fragment-spread walk: `depth-limit.ts`'s `relativeDepthOf` and
 * `cost-limit.ts`'s `costOfSelectionSet`. Originally extracted (task-3
 * review, C-1/C-2) from `depth-limit.ts`'s own local `FragmentDepthMemo` so
 * a SECOND AST walk — `cost-limit.ts`'s combined breadth+complexity walk —
 * could reuse the identical discipline without copying it; `depth-limit.ts`
 * itself stayed on its own local copy for one release cycle, frozen by a
 * ruling (query-cost-control ledger, "CONTROLLER RULING") that its file and
 * both its test files must stay byte-identical in case a later task adopted
 * `@pothos/plugin-complexity` and deleted `depth-limit.ts` outright — no
 * point migrating a file that might be removed. That plugin was REJECTED
 * (its own fragment walk reproduces both bugs below — task-2 report, probes
 * 1-2) and `depth-limit.ts` is now permanent, so the ruling that justified
 * two copies has expired: `depth-limit.ts` consumes this module too
 * (cost-calibration-suite plan, task 1) — this is now the only place the
 * memo's SHAPE and CONSTRUCTION live, which is the point, not a cosmetic
 * tidy-up. Precisely (task-1 review): the cache/in-progress state and its
 * lifetime are unified here, and a test proves both rules share them —
 * neutering `inProgress` reddens the cyclic-fragment tests in BOTH files.
 * What is NOT unified is each walk's branch logic (inline in
 * `relativeDepthOf` vs `resolveFragment` in `cost-limit.ts`), because the
 * value a fragment contributes differs per walk; that residual duplication
 * is smaller but real, and a future third walk must consume this module
 * rather than re-derive it. Two copies of a security-relevant guard is a
 * silent-drift hazard: a future edit to one walk's cycle handling (or a new
 * third walk copy-pasting the "obvious" inline version instead of reaching
 * for this module) could silently reintroduce either bug below in only one
 * place:
 *   - without a cache, a document where fragment N spreads fragment N-1
 *     twice costs `2^N` traversals (measured 4777ms at N=24 on a 2.2KB
 *     unauthenticated POST, before `depth-limit.ts` was first fixed;
 *     `@pothos/plugin-complexity` reproduces the identical curve today —
 *     task-2 report, probe 1);
 *   - without an in-progress guard, a cyclic fragment recurses until the
 *     stack overflows (`RangeError`, task-2 report probe 2, our own C-2) —
 *     an unhandled crash (HTTP 500) instead of the clean GraphQL validation
 *     error a cyclic fragment should produce.
 *
 * Generalized over `T` (a plain `number` for depth, `{breadth, complexity}`
 * for the cost walk) because the VALUE a fragment contributes differs per
 * walk, but the CONTROL FLOW around computing it does not.
 *
 * Caching by fragment name alone (not by name + calling context) is sound
 * for any walk where a named fragment's contribution depends only on its
 * OWN declared type condition, never on where it is spread from — true for
 * depth (`depth-limit.ts`'s `relativeDepthOf`, whose own doc comment states
 * the underlying identity `depthOf(set, d) === d + relativeDepthOf(set)`)
 * and equally true for breadth and complexity (a fragment always carries a
 * type condition, so summing its fields costs the same number of nodes /
 * the same weight regardless of which parent spreads it).
 */
export type FragmentWalkMemo<T> = {
  cache: Map<string, T>;
  inProgress: Set<string>;
  onCycle: (fragmentName: string) => void;
};

/** Fresh, empty memo — one per document (or per test), never reused across documents (see `depth-limit.ts`'s own per-document memo lifetime, mirrored by `cost-limit.ts`). */
export const createFragmentWalkMemo = <T>(
  onCycle: (fragmentName: string) => void
): FragmentWalkMemo<T> => ({
  cache: new Map(),
  inProgress: new Set(),
  onCycle,
});

/**
 * Resolves fragment `name`'s value through `memo`, computing it via
 * `compute` at most once no matter how many times (or from how many places)
 * the fragment is spread. Re-entering `name` while it is still being
 * computed is a cycle: `onCycle` fires (once per name — `memo.cache` never
 * receives a value for a cyclic name, so every OTHER re-encounter of the
 * same name also re-detects `inProgress` and re-fires `onCycle`; a caller
 * that wants "reported once" dedupes in its own `onCycle`, exactly as
 * `depthLimitRule`'s `reportedCycles` set does) and `fallback` is returned
 * for that ONE occurrence — the outer, still-in-progress call for the same
 * name is unaffected and completes normally once its cyclic branch
 * bottoms out, caching the real value.
 */
export const resolveFragment = <T>(
  name: string,
  memo: FragmentWalkMemo<T>,
  fallback: T,
  compute: () => T
): T => {
  const cached = memo.cache.get(name);
  if (cached !== undefined) return cached;
  if (memo.inProgress.has(name)) {
    memo.onCycle(name);
    return fallback;
  }
  memo.inProgress.add(name);
  const value = compute();
  memo.inProgress.delete(name);
  memo.cache.set(name, value);
  return value;
};
