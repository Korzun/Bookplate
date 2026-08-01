import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.device.create({
    data: {
      id: 'dev-1',
      name: 'Kobo Clara',
      slug: 'kobo-clara',
      coverWidth: 1072,
      coverHeight: 1448,
      coverFit: 'contain',
      bwCover: true,
      simplify: false,
    },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

describe('Viewer.devices', () => {
  it('lists every device for an admin', async () => {
    const result = await harness.execute(
      '{ viewer { devices { id name slug coverWidth coverHeight coverFit bwCover simplify } } }',
      { viewer: harness.adminViewer }
    );

    expect(result.errors).toBeUndefined();
    const devices = (result.data as { viewer: { devices: { name: string }[] } }).viewer.devices;
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toBe('Kobo Clara');
  });

  it('serializes coverFit as the enum member name for a stored lowercase value', async () => {
    const result = await harness.execute('{ viewer { devices { coverFit } } }', {
      viewer: harness.adminViewer,
    });

    expect(result.errors).toBeUndefined();
    const device = (result.data as { viewer: { devices: { coverFit: string }[] } }).viewer
      .devices[0];
    // Discriminating case for CoverFit: stored 'contain' must serialize as wire 'CONTAIN'.
    expect(device.coverFit).toBe('CONTAIN');
  });

  it('exposes createdAt/updatedAt as DateTime', async () => {
    const result = await harness.execute('{ viewer { devices { createdAt updatedAt } } }', {
      viewer: harness.adminViewer,
    });

    expect(result.errors).toBeUndefined();
    const device = (
      result.data as { viewer: { devices: { createdAt: string; updatedAt: string }[] } }
    ).viewer.devices[0];
    expect(Number.isNaN(Date.parse(device.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(device.updatedAt))).toBe(false);
  });

  // REST parity, NOT the brief's "refuses a non-admin" assertion: routes/devices.ts's
  // `GET /` handler is reachable by any logged-in user (only `requireAuth`, no
  // `adminAuth`) — a non-admin gets `deviceStore.listForUser`, not FORBIDDEN. A
  // regular user not enabled on any device sees an empty list, not an error.
  it('returns an empty list for a non-admin enabled on no device', async () => {
    const result = await harness.execute('{ viewer { devices { name } } }', {
      viewer: harness.aliceViewer,
    });

    expect(result.errors).toBeUndefined();
    expect((result.data as { viewer: { devices: { name: string }[] } }).viewer.devices).toEqual([]);
  });

  it('returns only the devices a non-admin is enabled on', async () => {
    await harness.prisma.device.create({
      data: {
        id: 'dev-2',
        name: 'Kindle Oasis',
        slug: 'kindle-oasis',
        coverWidth: 1264,
        coverHeight: 1680,
        coverFit: 'contain',
        bwCover: true,
        simplify: false,
      },
    });
    await harness.prisma.deviceUser.create({
      data: { deviceId: 'dev-1', userId: harness.aliceOwner.userId },
    });

    const result = await harness.execute('{ viewer { devices { name } } }', {
      viewer: harness.aliceViewer,
    });

    expect(result.errors).toBeUndefined();
    expect((result.data as { viewer: { devices: { name: string }[] } }).viewer.devices).toEqual([
      { name: 'Kobo Clara' },
    ]);
  });

  it('does not leak a device bob is not enabled on into alice devices list', async () => {
    await harness.prisma.deviceUser.create({
      data: { deviceId: 'dev-1', userId: harness.bobOwner.userId },
    });

    const result = await harness.execute('{ viewer { devices { name } } }', {
      viewer: harness.aliceViewer,
    });

    expect(result.errors).toBeUndefined();
    expect((result.data as { viewer: { devices: { name: string }[] } }).viewer.devices).toEqual([]);
  });
});
