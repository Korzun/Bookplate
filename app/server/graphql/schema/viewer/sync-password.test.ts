import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

type SyncData = { viewer: { syncPassword: string | null } };

const read = async (viewer: Harness['aliceViewer']) => {
  const result = await harness.execute('{ viewer { syncPassword } }', { viewer });
  expect(result.errors).toBeUndefined();
  return (result.data as SyncData).viewer.syncPassword;
};

describe('Viewer.syncPassword', () => {
  it("returns the viewer's own sync password", async () => {
    await harness.stores.user.changeSyncPassword('alice', 'alice-sync-secret');

    expect(await read(harness.aliceViewer)).toBe('alice-sync-secret');
  });

  it("returns the requesting viewer's password, never a fixed user's", async () => {
    await harness.stores.user.changeSyncPassword('alice', 'alice-sync-secret');
    await harness.stores.user.changeSyncPassword('bob', 'bob-sync-secret');

    // Bob must see his own. A resolver keyed on anything but the viewer would
    // hand him alice's, and the single-viewer test above could not tell.
    expect(await read(harness.bobViewer)).toBe('bob-sync-secret');
    expect(await read(harness.aliceViewer)).toBe('alice-sync-secret');
  });

  it('is null for the config-based admin, mirroring the REST route 403', async () => {
    expect(await read(harness.adminViewer)).toBeNull();
  });

  it('generates and persists one on first read, as the REST route does', async () => {
    // `UserStore.getSyncPassword` creates the KOSync credential lazily. This
    // read path must not diverge from REST's about whether a user has one.
    const generated = await read(harness.aliceViewer);

    expect(generated).toEqual(expect.any(String));
    expect(generated).not.toBe('');
    const stored = await harness.prisma.user.findUnique({
      where: { username: 'alice' },
      select: { syncPassword: true },
    });
    expect(stored?.syncPassword).toBe(generated);
  });
});
