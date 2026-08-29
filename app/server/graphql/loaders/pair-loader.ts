/**
 * The one batching-loader implementation the request-scoped loaders in this
 * directory share.
 *
 * WHY THESE LOADERS EXIST AT ALL, since it is not obvious and was three times
 * re-litigated: `@pothos/plugin-prisma` merges a field's `select` only into a
 * query IT planned — `wrapResolve` takes its fast path only on a
 * `getLoaderMapping` hit (`@pothos/plugin-prisma/lib/index.js`). `Library
 * .entries` is hand-declared over `builder.connectionObject`, so it is never
 * plugin-planned, and every `select`-carrying field on the rows it yields —
 * `t.relation`, `t.relationCount` — falls back to a PER-ROW `ModelLoader`
 * re-query.
 *
 * That was measured, twice, rather than assumed: converting `Progress.book` and
 * `Book.progress` to `t.relation` over a real Prisma relation took a page of 8
 * from 2 queries to 9 in both cases. A batching loader is therefore not a
 * workaround for a missing relation on that path — it is the only mechanism
 * that batches at all on a connection carrying a 100x multiplier.
 *
 * `Library.progress` USED to be the second such connection, and is no longer:
 * it is a `t.prismaConnection` (`schema/library/model.ts`), so it IS
 * plugin-planned, and the two loaders that existed only to serve it are gone.
 * `Progress.book` is a `t.relation` and `Progress.currentChapter` a field
 * `select` over the same relation; measured on a page of 8 selecting both,
 * 3 queries became 1. Retiring those two loaders cost an SDL change — the
 * connection gained `last`/`before`, reversing `e7f99557` — which is why the
 * same conversion is NOT available for `Library.entries` and why this file's
 * general rule survives with a narrower scope:
 *
 *   A field on `Book` or `Progress` reached through `Library.entries` cannot
 *   use plugin select-merging, whatever relations exist in `schema.prisma`.
 *
 * `Library.entries` cannot follow `Library.progress` even if the arg question
 * were reopened: its node type is the union `LibraryEntry = Book | Series`
 * over an interleaved two-table keyset, and `t.prismaConnection` binds to a
 * single model. That is structural, not a ruling.
 *
 * WHAT THE SHARED MECHANICS BUY, beyond deduplication: these loaders were
 * near-verbatim copies of one another, and the settle-on-throw discipline
 * below had to be discovered once (`progress-loader` shipped without it and a
 * transient DB error HUNG the request instead of surfacing an error) and then
 * hand-copied into each. There is one copy now.
 *
 * The three mechanics, each load-bearing:
 *
 *  1. **Two-level cache**, `userId -> key -> promise`, never one concatenated
 *     string key. There is no delimiter to choose and therefore no way for two
 *     distinct `(userId, key)` pairs to collide onto one entry.
 *  2. **The cache holds the PROMISE, not the resolved value**, so concurrent
 *     sibling-field resolution for the same key shares one query rather than
 *     racing two.
 *  3. **Both `resolve` and `reject` are captured up front**, and `flush` wraps
 *     the fetch AND the grouping so every lookup in a batch is settled even
 *     when the query throws. An unsettled resolver promise never surfaces as a
 *     GraphQL error — it just hangs the request.
 *
 * Callers batch by explicit `(userId, key)` PAIRS rather than a bare
 * `key IN (...)`, and that is a tenancy requirement, not a style choice: book
 * ids and KOReader `document` hashes are content hashes, so two users
 * routinely hold the identical key for the identical file. Each loader's own
 * doc comment restates this against its own table.
 */

/** One request-scoped batching loader over a compound `(userId, key)` lookup. */
export type PairLoader<V> = (userId: string, key: string) => Promise<V>;

/** The pairs handed to `fetch` for one flush. */
export type LoaderPair = { userId: string; key: string };

/**
 * Groups fetched rows into the `userId -> key -> value` shape `fetch` must
 * return. Convenience only — a loader whose rows accumulate per key (e.g. one
 * array per book) builds its map directly instead.
 */
export const groupByPair = <R, V>(
  rows: readonly R[],
  userIdOf: (row: R) => string,
  keyOf: (row: R) => string,
  valueOf: (row: R) => V
): Map<string, Map<string, V>> => {
  const byUser = new Map<string, Map<string, V>>();
  for (const row of rows) {
    const byKey = byUser.get(userIdOf(row)) ?? new Map<string, V>();
    byKey.set(keyOf(row), valueOf(row));
    byUser.set(userIdOf(row), byKey);
  }
  return byUser;
};

/**
 * Builds a request-scoped batching loader.
 *
 * `fetch` receives every `(userId, key)` pair requested during the current
 * microtask and returns them grouped `userId -> key -> value`. It may issue
 * more than one query (see `series-progress.ts`, which needs two) — what
 * matters is that the number of queries does not grow with the size of the
 * batch.
 *
 * `absent` is the value for a pair `fetch` returned no entry for. It is a
 * required argument rather than defaulting to `null` because the right answer
 * genuinely differs per loader — `0` for a count, `[]` for a tally list, `null`
 * for a row lookup — and a wrong default is a silently incorrect field rather
 * than a type error (`Book.deviceEditionCount` is `Int!`, so `undefined` there
 * would fail the whole request).
 */
export const createPairLoader = <V>(
  fetch: (pairs: readonly LoaderPair[]) => Promise<Map<string, Map<string, V>>>,
  absent: V
): PairLoader<V> => {
  const cache = new Map<string, Map<string, Promise<V>>>();
  let pending: (LoaderPair & { resolve: (value: V) => void; reject: (err: unknown) => void })[] =
    [];
  let flushScheduled = false;

  const flush = async (): Promise<void> => {
    const batch = pending;
    pending = [];
    flushScheduled = false;

    try {
      const grouped = await fetch(batch);
      for (const lookup of batch) {
        const value = grouped.get(lookup.userId)?.get(lookup.key);
        lookup.resolve(value === undefined ? absent : value);
      }
    } catch (err) {
      for (const lookup of batch) lookup.reject(err);
    }
  };

  return (userId: string, key: string): Promise<V> => {
    const byKey = cache.get(userId) ?? new Map<string, Promise<V>>();
    cache.set(userId, byKey);

    const cached = byKey.get(key);
    if (cached !== undefined) return cached;

    const result = new Promise<V>((resolve, reject) => {
      pending.push({ userId, key, resolve, reject });
      if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(() => void flush());
      }
    });
    byKey.set(key, result);
    return result;
  };
};
