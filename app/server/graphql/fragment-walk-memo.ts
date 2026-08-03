/**
 * The generic shape of `depth-limit.ts`'s `FragmentDepthMemo` (task-3
 * review, C-1/C-2), extracted so a SECOND AST walk — `cost-limit.ts`'s
 * combined breadth+complexity walk — can reuse the identical
 * memoize-by-fragment-name + cycle-guard discipline without copying it.
 * `depth-limit.ts` itself is intentionally left untouched (query-cost-control
 * ledger, "CONTROLLER RULING": its file and both its test files stay
 * UNCHANGED) — this module is what a walk built AFTER it reaches for instead
 * of re-deriving the same fix from scratch, which is exactly how the two
 * walks would otherwise diverge (the "shared guards extracted, never
 * copied" rule, `rejectBackwardPagination` precedent).
 *
 * Generalized over `T` (a plain `number` for depth, `{breadth, complexity}`
 * for the cost walk) because the VALUE a fragment contributes differs per
 * walk, but the CONTROL FLOW around computing it does not:
 *   - without a cache, a document where fragment N spreads fragment N-1
 *     twice costs `2^N` traversals (measured 4777ms at N=24 before
 *     `depth-limit.ts` was fixed; `@pothos/plugin-complexity` reproduces the
 *     identical curve today — task-2 report, probe 1);
 *   - without an in-progress guard, a cyclic fragment recurses until the
 *     stack overflows (`RangeError`, task-2 report probe 2, our own C-2).
 *
 * Caching by fragment name alone (not by name + calling context) is sound
 * for any walk where a named fragment's contribution depends only on its
 * OWN declared type condition, never on where it is spread from — true for
 * depth (`depth-limit.ts`'s own reasoning) and equally true for breadth and
 * complexity (a fragment always carries a type condition, so summing its
 * fields costs the same number of nodes / the same weight regardless of
 * which parent spreads it).
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
