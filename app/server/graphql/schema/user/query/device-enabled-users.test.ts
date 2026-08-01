import { createHarness, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
  for (const id of ['dev-1', 'dev-2']) {
    await harness.prisma.device.create({
      data: { id, name: `Device ${id}`, slug: id },
    });
  }
  // alice and bob on dev-1; nobody on dev-2.
  await harness.prisma.deviceUser.create({
    data: { deviceId: 'dev-1', userId: harness.bobOwner.userId },
  });
  await harness.prisma.deviceUser.create({
    data: { deviceId: 'dev-1', userId: harness.aliceOwner.userId },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

type DevicesData = {
  viewer: { devices: { name: string; enabledUsers: { username: string }[] }[] };
};

const DEVICES = '{ viewer { devices { name enabledUsers { username } } } }';

describe('Device.enabledUsers', () => {
  it('lists the users enabled on each device, ordered by username', async () => {
    const result = await harness.execute(DEVICES, { viewer: harness.adminViewer });

    expect(result.errors).toBeUndefined();
    const devices = (result.data as DevicesData).viewer.devices;
    // Inserted bob-first above, so an implementation without the orderBy would
    // return them in insertion order and this would read ['bob', 'alice'].
    expect(devices.find((d) => d.name === 'Device dev-1')?.enabledUsers).toEqual([
      { username: 'alice' },
      { username: 'bob' },
    ]);
  });

  it('is empty for a device nobody is enabled on', async () => {
    const result = await harness.execute(DEVICES, { viewer: harness.adminViewer });

    expect(
      (result.data as DevicesData).viewer.devices.find((d) => d.name === 'Device dev-2')
        ?.enabledUsers
    ).toEqual([]);
  });

  it('lists only the users of the device it hangs off', async () => {
    // A resolver that ignored the parent device — listing every user, or every
    // DeviceUser row — would give dev-2 the same two names as dev-1.
    const result = await harness.execute(DEVICES, { viewer: harness.adminViewer });

    const devices = (result.data as DevicesData).viewer.devices;
    expect(devices.map((d) => d.enabledUsers.length)).toEqual([2, 0]);
  });

  // `GET /api/devices/:id/users` carries `adminAuth`, unlike that router's
  // `GET /`. The two must not be conflated: `Viewer.devices` is open to every
  // authenticated user and this field is not.
  it('refuses a non-admin, while the device list itself stays open to them', async () => {
    const denied = await harness.execute(DEVICES, { viewer: harness.aliceViewer });
    expect(denied.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');

    const allowed = await harness.execute('{ viewer { devices { name } } }', {
      viewer: harness.aliceViewer,
    });
    expect(allowed.errors).toBeUndefined();
    expect((allowed.data as { viewer: { devices: { name: string }[] } }).viewer.devices).toEqual([
      { name: 'Device dev-1' },
    ]);
  });
});
