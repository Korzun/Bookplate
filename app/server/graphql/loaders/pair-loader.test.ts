import { describe, expect, it, vi } from 'vitest';

import { createPairLoader, groupByPair, type LoaderPair } from './pair-loader';

/** One entry, so a fetch's return shape stays readable at the call sites below. */
const one = <V>(userId: string, key: string, value: V): Map<string, Map<string, V>> =>
  new Map([[userId, new Map([[key, value]])]]);

/** Echoes each requested pair back as a value, for the batching assertions. */
const echo = async (pairs: readonly LoaderPair[]) =>
  groupByPair(
    pairs.map((p) => ({ ...p, v: `${p.userId}:${p.key}` })),
    (r) => r.userId,
    (r) => r.key,
    (r) => r.v
  );

describe('createPairLoader', () => {
  it('collapses N different keys requested in one tick into ONE fetch', async () => {
    const fetch = vi.fn(echo);
    const load = createPairLoader(fetch, null as string | null);

    const values = await Promise.all([load('u1', 'a'), load('u1', 'b'), load('u1', 'c')]);

    expect(values).toEqual(['u1:a', 'u1:b', 'u1:c']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toHaveLength(3);
  });

  // `absent` is a required argument rather than defaulting to null precisely
  // because the right answer differs per loader, and a wrong one is a silently
  // incorrect field rather than a type error — `Book.deviceEditionCount` is
  // `Int!`, so `undefined` there fails the whole request.
  it.each([
    ['null (row lookup)', null],
    ['0 (count)', 0],
    ['[] (tally list)', []],
  ])(
    'resolves the loader’s own `absent` value — %s — for a pair the fetch omitted',
    async (_label, absent) => {
      const load = createPairLoader(async () => new Map(), absent as unknown);
      await expect(load('u1', 'missing')).resolves.toEqual(absent);
    }
  );

  it('does not confuse two users holding the identical key', async () => {
    // The hazard this loader family exists to avoid: book ids and KOReader
    // `document` hashes are content hashes, so the same key legitimately
    // belongs to two tenants at once.
    const load = createPairLoader(echo, null as string | null);

    const [a, b] = await Promise.all([load('alice', 'shared'), load('bob', 'shared')]);

    expect(a).toBe('alice:shared');
    expect(b).toBe('bob:shared');
  });

  it('memoizes per key, so a repeat lookup issues no second fetch', async () => {
    const fetch = vi.fn(async () => one('u1', 'a', 'A'));
    const load = createPairLoader(fetch, null as string | null);

    expect(await load('u1', 'a')).toBe('A');
    expect(await load('u1', 'a')).toBe('A');

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight fetch between concurrent lookups of the same key', async () => {
    const fetch = vi.fn(async () => one('u1', 'a', 'A'));
    const load = createPairLoader(fetch, null as string | null);

    const [x, y] = await Promise.all([load('u1', 'a'), load('u1', 'a')]);

    expect([x, y]).toEqual(['A', 'A']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  // The bug `progress-loader` shipped once: a loader that captures only
  // `resolve` leaves the batch's promises unsettled, which HANGS the request
  // instead of surfacing a GraphQL error. There is one copy of this discipline
  // now, so this test guards all seven loaders rather than one.
  it('rejects EVERY pending lookup when the fetch throws, rather than hanging', async () => {
    const load = createPairLoader(
      async () => {
        throw new Error('db unavailable');
      },
      null as string | null
    );

    const results = await Promise.allSettled([load('u1', 'a'), load('u1', 'b'), load('u2', 'c')]);

    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected']);
    for (const result of results) {
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    }
  });
});

describe('groupByPair', () => {
  it('nests rows userId -> key -> value', () => {
    const grouped = groupByPair(
      [
        { u: 'a', k: '1', v: 10 },
        { u: 'a', k: '2', v: 20 },
        { u: 'b', k: '1', v: 30 },
      ],
      (r) => r.u,
      (r) => r.k,
      (r) => r.v
    );

    expect(grouped.get('a')?.get('1')).toBe(10);
    expect(grouped.get('a')?.get('2')).toBe(20);
    expect(grouped.get('b')?.get('1')).toBe(30);
    expect(grouped.get('b')?.get('2')).toBeUndefined();
  });
});
