import { encodeGlobalID } from '@pothos/plugin-relay';

import { createHarness, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.device.create({
    data: { id: 'dev-1', name: 'Kobo Clara', slug: 'kobo-clara' },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

const MUTATION = `
  mutation Enable($input: DeviceEnableUserInput!) {
    deviceEnableUser(input: $input) {
      __typename
      ... on DeviceEnableUserPayload { device { id } user { username } }
      ... on InvalidInputError { message }
    }
  }
`;

describe('Mutation.deviceEnableUser', () => {
  it('enables a user on a device, for an admin', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: { deviceId: 'dev-1', userId: encodeGlobalID('User', harness.bobOwner.userId) },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.deviceEnableUser).toMatchObject({
      __typename: 'DeviceEnableUserPayload',
      user: { username: 'bob' },
    });
    expect(await harness.stores.device.isEnabled('dev-1', harness.bobOwner.userId)).toBe(true);
  });

  it('is idempotent: enabling an already-enabled pair succeeds and changes nothing else', async () => {
    await harness.stores.device.enableUser('dev-1', harness.bobOwner.userId);

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: { deviceId: 'dev-1', userId: encodeGlobalID('User', harness.bobOwner.userId) },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.deviceEnableUser).toMatchObject({ __typename: 'DeviceEnableUserPayload' });
    expect(await harness.prisma.deviceUser.count({ where: { deviceId: 'dev-1' } })).toBe(1);
  });

  it('resolves to null for an unknown deviceId', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: {
          deviceId: 'no-such-device',
          userId: encodeGlobalID('User', harness.bobOwner.userId),
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.deviceEnableUser).toBeNull();
  });

  it('resolves to null for a User global ID that names no user', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: { deviceId: 'dev-1', userId: encodeGlobalID('User', 'no-such-user') },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.deviceEnableUser).toBeNull();
    expect(await harness.prisma.deviceUser.count({ where: { deviceId: 'dev-1' } })).toBe(0);
  });

  it('returns InvalidInputError for a blank deviceId', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: { deviceId: '', userId: encodeGlobalID('User', harness.bobOwner.userId) },
      },
    });

    expect(result.data?.deviceEnableUser).toMatchObject({ __typename: 'InvalidInputError' });
  });

  it('refuses a non-admin caller acting on another user, leaving enablement untouched', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { deviceId: 'dev-1', userId: encodeGlobalID('User', harness.bobOwner.userId) },
      },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(await harness.stores.device.isEnabled('dev-1', harness.bobOwner.userId)).toBe(false);
  });

  /**
   * Seen-to-fail (Task 6's discrimination rule): the "other user" test above
   * is denied under both `{ admin: true }` and a naive
   * `{ ownerOf: args.input.userId.id }` scope (alice owns neither the device
   * nor bob's account), so it cannot by itself prove `{ admin: true }` is
   * actually wired rather than `ownerOf`. Only a non-admin acting on
   * THEMSELVES discriminates the two: under `ownerOf`, alice naming her own
   * `userId` would match the owner branch and succeed. Confirmed live:
   * swapping this resolver's `authScopes` to
   * `{ ownerOf: args.input.userId.id }` turns this test red (`expected
   * undefined to be 'FORBIDDEN'`, alice successfully enabling herself), then
   * reverted.
   */
  it('refuses a non-admin caller attempting to enable themselves', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { deviceId: 'dev-1', userId: harness.aliceGlobalId } },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(await harness.stores.device.isEnabled('dev-1', harness.aliceOwner.userId)).toBe(false);
  });
});
