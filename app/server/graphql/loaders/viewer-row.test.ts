import { ensureAdminUser } from '../../services/admin-account';
import { setUserEmail, markEmailVerified } from '../../services/email';
import { createHarness, type Harness } from '../test-util';
import { createViewerRowLoader } from './viewer-row';

vi.mock('../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

describe('createViewerRowLoader', () => {
  it("resolves the viewer's own row by userId", async () => {
    await setUserEmail(harness.prisma, harness.aliceOwner.userId, 'alice@example.com');
    await markEmailVerified(harness.prisma, harness.aliceOwner.userId);
    const load = createViewerRowLoader(harness.prisma, harness.aliceViewer);

    const row = await load();

    expect(row?.email).toBe('alice@example.com');
    expect(row?.emailVerifiedAt).not.toBeNull();
  });

  it('falls back to the isConfigAdmin row for the config-based admin, whose token carries no sub', async () => {
    await ensureAdminUser(harness.prisma, 'admin');
    const load = createViewerRowLoader(harness.prisma, harness.adminViewer);

    const row = await load();

    // Only assert it resolved (not null) and did NOT go through a `userId`
    // lookup, which would be `null` for the admin viewer.
    expect(row).not.toBeNull();
  });

  it('queries once for repeated calls in the same request', async () => {
    const spy = vi.spyOn(harness.prisma.user, 'findUnique');
    const load = createViewerRowLoader(harness.prisma, harness.aliceViewer);

    await load();
    await load();
    await load();

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('queries once for concurrent calls in the same request', async () => {
    const spy = vi.spyOn(harness.prisma.user, 'findUnique');
    const load = createViewerRowLoader(harness.prisma, harness.aliceViewer);

    await Promise.all([load(), load(), load()]);

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('uses findFirst, not findUnique, for the config-based admin', async () => {
    await ensureAdminUser(harness.prisma, 'admin');
    const findUniqueSpy = vi.spyOn(harness.prisma.user, 'findUnique');
    const findFirstSpy = vi.spyOn(harness.prisma.user, 'findFirst');
    const load = createViewerRowLoader(harness.prisma, harness.adminViewer);

    await load();
    await load();

    expect(findUniqueSpy).not.toHaveBeenCalled();
    expect(findFirstSpy).toHaveBeenCalledTimes(1);
    findUniqueSpy.mockRestore();
    findFirstSpy.mockRestore();
  });

  it('throws for a null viewer, mirroring requireViewer', async () => {
    const load = createViewerRowLoader(harness.prisma, null);

    await expect(load()).rejects.toThrow();
  });
});
