import { createOwnerLoader } from './owner';
import { createHarness, type Harness } from './test-util';

vi.mock('../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

describe('createOwnerLoader', () => {
  it('resolves a userId to its Owner', async () => {
    const load = createOwnerLoader(harness.prisma);

    expect(await load(harness.aliceOwner.userId)).toEqual({
      userId: harness.aliceOwner.userId,
      username: 'alice',
    });
  });

  it('returns null for an unknown userId', async () => {
    const load = createOwnerLoader(harness.prisma);

    expect(await load('does-not-exist')).toBeNull();
  });

  it('queries once for repeated lookups of the same userId', async () => {
    const spy = vi.spyOn(harness.prisma.user, 'findUnique');
    const load = createOwnerLoader(harness.prisma);

    await load(harness.aliceOwner.userId);
    await load(harness.aliceOwner.userId);
    await load(harness.aliceOwner.userId);

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('caches the miss too, so a bad id cannot be queried repeatedly', async () => {
    const spy = vi.spyOn(harness.prisma.user, 'findUnique');
    const load = createOwnerLoader(harness.prisma);

    await load('does-not-exist');
    await load('does-not-exist');

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('issues one query for concurrent lookups of the same userId', async () => {
    const spy = vi.spyOn(harness.prisma.user, 'findUnique');
    const load = createOwnerLoader(harness.prisma);

    const results = await Promise.all([
      load(harness.aliceOwner.userId),
      load(harness.aliceOwner.userId),
      load(harness.aliceOwner.userId),
    ]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { userId: harness.aliceOwner.userId, username: 'alice' },
      { userId: harness.aliceOwner.userId, username: 'alice' },
      { userId: harness.aliceOwner.userId, username: 'alice' },
    ]);
    spy.mockRestore();
  });
});
