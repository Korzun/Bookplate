import { encodeGlobalID } from '@pothos/plugin-relay';

import { logger } from '../../../../logger';
import { createHarness, type Harness } from '../../../test-util';

// A bare `vi.mock('../../../../logger')` auto-mock hands back a FRESH mocked
// object on every `logger(namespace)` call — see `update.test.ts`'s identical
// comment (`book/mutation/replace.test.ts`'s original explanation).
vi.mock('../../../../logger', () => {
  const loggers = new Map<
    string,
    Record<'debug' | 'info' | 'warn' | 'error', ReturnType<typeof vi.fn>>
  >();
  return {
    logger: (namespace: string) => {
      let entry = loggers.get(namespace);
      if (entry === undefined) {
        entry = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        loggers.set(namespace, entry);
      }
      return entry;
    },
  };
});

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.device.create({
    data: { id: 'dev-1', name: 'Kobo Clara', slug: 'kobo-clara' },
  });
  await harness.stores.device.enableUser('dev-1', harness.bobOwner.userId);
});

afterEach(async () => {
  await harness.cleanup();
});

const MUTATION = `
  mutation Disable($input: DeviceDisableUserInput!) {
    deviceDisableUser(input: $input) {
      __typename
      ... on DeviceDisableUserPayload { device { id } user { username } }
      ... on InvalidInputError { message }
    }
  }
`;

describe('Mutation.deviceDisableUser', () => {
  it('disables a user on a device, for an admin', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: { deviceId: 'dev-1', userId: encodeGlobalID('User', harness.bobOwner.userId) },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.deviceDisableUser).toMatchObject({
      __typename: 'DeviceDisableUserPayload',
      user: { username: 'bob' },
    });
    expect(await harness.stores.device.isEnabled('dev-1', harness.bobOwner.userId)).toBe(false);
  });

  it('is idempotent: disabling an already-disabled pair succeeds with no error', async () => {
    await harness.stores.device.disableUser('dev-1', harness.bobOwner.userId);

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: { deviceId: 'dev-1', userId: encodeGlobalID('User', harness.bobOwner.userId) },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.deviceDisableUser).toMatchObject({
      __typename: 'DeviceDisableUserPayload',
    });
  });

  it('purges the edition cache for the device+user pair on success', async () => {
    await harness.prisma.deviceEdition.create({
      data: {
        deviceId: 'dev-1',
        userId: harness.bobOwner.userId,
        originalBookId: 'b'.repeat(32),
        editionId: 'e'.repeat(32),
        settingsHash: 'h',
      },
    });
    // A different user's edition on the same device must survive.
    await harness.prisma.deviceEdition.create({
      data: {
        deviceId: 'dev-1',
        userId: harness.aliceOwner.userId,
        originalBookId: 'b'.repeat(32),
        editionId: 'f'.repeat(32),
        settingsHash: 'h',
      },
    });

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: { deviceId: 'dev-1', userId: encodeGlobalID('User', harness.bobOwner.userId) },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(
      await harness.prisma.deviceEdition.findMany({
        where: { deviceId: 'dev-1' },
        select: { userId: true },
      })
    ).toEqual([{ userId: harness.aliceOwner.userId }]);
  });

  it('still succeeds when the edition-cache purge fails, and logs a warning', async () => {
    vi.spyOn(harness.stores.edition, 'purgeForDeviceAndUser').mockRejectedValueOnce(
      new Error('disk full')
    );

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: { deviceId: 'dev-1', userId: encodeGlobalID('User', harness.bobOwner.userId) },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.deviceDisableUser).toMatchObject({
      __typename: 'DeviceDisableUserPayload',
    });
    expect(logger('graphql-device-mutation').warn).toHaveBeenCalledWith(
      expect.stringContaining('deviceDisableUser — edition-cache purge failed — disk full')
    );
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
    expect(result.data?.deviceDisableUser).toBeNull();
  });

  it('resolves to null for a User global ID that names no user', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: { deviceId: 'dev-1', userId: encodeGlobalID('User', 'no-such-user') },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.deviceDisableUser).toBeNull();
    // bob's enablement is untouched by the failed lookup.
    expect(await harness.stores.device.isEnabled('dev-1', harness.bobOwner.userId)).toBe(true);
  });

  it('returns InvalidInputError for a blank deviceId', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: { deviceId: '', userId: encodeGlobalID('User', harness.bobOwner.userId) },
      },
    });

    expect(result.data?.deviceDisableUser).toMatchObject({ __typename: 'InvalidInputError' });
  });

  it('refuses a non-admin caller acting on another user, leaving enablement untouched', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { deviceId: 'dev-1', userId: encodeGlobalID('User', harness.bobOwner.userId) },
      },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(await harness.stores.device.isEnabled('dev-1', harness.bobOwner.userId)).toBe(true);
  });

  /**
   * Seen-to-fail (Task 6's discrimination rule) — same reasoning as
   * `enable-user.test.ts`'s identical test: the "other user" test above is
   * denied under both `{ admin: true }` and a naive
   * `{ ownerOf: args.input.userId.id }` scope, so only a non-admin acting on
   * THEMSELVES discriminates the two. Confirmed live: swapping this
   * resolver's `authScopes` to `{ ownerOf: args.input.userId.id }` turns
   * this test red (alice successfully disabling her own — nonexistent —
   * enablement, `expected undefined to be 'FORBIDDEN'`), then reverted.
   */
  it('refuses a non-admin caller attempting to disable themselves', async () => {
    await harness.stores.device.enableUser('dev-1', harness.aliceOwner.userId);

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { deviceId: 'dev-1', userId: harness.aliceGlobalId } },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(await harness.stores.device.isEnabled('dev-1', harness.aliceOwner.userId)).toBe(true);
  });
});
