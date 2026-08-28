import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

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

  // REST's `GET /api/devices/:id/users` carried `adminAuth`, unlike that
  // router's `GET /`, before Phase 0 removed both. The same split holds
  // here: `Viewer.devices` is open to every authenticated user and this
  // field is not.
  //
  // `enabledUsers` is nullable (pre-client hardening spec, §4 "Nullability
  // ruling"): a denial nulls JUST that field on EACH device, not the whole
  // operation — `Viewer.devices` (itself a non-null list of non-null
  // `Device`) stays populated with every device, each carrying
  // `enabledUsers: null`. Seen-to-fail: reverting `Device.enabledUsers`'s
  // `nullable: true` (device/model.ts) turns this red — a denied non-null
  // field on a list ITEM nulls the whole non-null list, and that propagates
  // all the way to root `data: null`, exactly like `Viewer.users` did before
  // its own fix (see users.test.ts).
  it('refuses a non-admin — nulls only `enabledUsers` per device, the list stays alive', async () => {
    const denied = await harness.execute(DEVICES, { viewer: harness.aliceViewer });

    expect(denied.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    // Alice is a non-admin, so `Viewer.devices` itself already scopes her to
    // only the devices she is enabled on (dev-1) — same scoping as the
    // "allowed" call below. This is `enabledUsers`'s own denial, not a
    // second, different restriction.
    expect((denied.data as DevicesData).viewer.devices).toEqual([
      { name: 'Device dev-1', enabledUsers: null },
    ]);

    const allowed = await harness.execute('{ viewer { devices { name } } }', {
      viewer: harness.aliceViewer,
    });
    expect(allowed.errors).toBeUndefined();
    expect((allowed.data as { viewer: { devices: { name: string }[] } }).viewer.devices).toEqual([
      { name: 'Device dev-1' },
    ]);
  });
});
