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
});

afterEach(async () => {
  await harness.cleanup();
});

const MUTATION = `
  mutation Delete($input: DeviceDeleteInput!) {
    deviceDelete(input: $input) {
      __typename
      ... on DeviceDeletePayload { deletedDeviceId }
      ... on InvalidInputError { message }
    }
  }
`;

describe('Mutation.deviceDelete', () => {
  it('deletes the device row for an admin', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { deviceId: 'dev-1' } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.deviceDelete).toEqual({
      __typename: 'DeviceDeletePayload',
      deletedDeviceId: 'dev-1',
    });
    expect(await harness.prisma.device.findUnique({ where: { id: 'dev-1' } })).toBeNull();
  });

  it('cascade-deletes DeviceUser enablement rows for the device', async () => {
    await harness.prisma.deviceUser.create({
      data: { deviceId: 'dev-1', userId: harness.aliceOwner.userId },
    });

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { deviceId: 'dev-1' } },
    });

    expect(result.errors).toBeUndefined();
    expect(await harness.prisma.deviceUser.findMany({ where: { deviceId: 'dev-1' } })).toEqual([]);
  });

  it('purges the edition cache for the device on success', async () => {
    await harness.prisma.deviceEdition.create({
      data: {
        deviceId: 'dev-1',
        userId: harness.aliceOwner.userId,
        originalBookId: 'b'.repeat(32),
        editionId: 'e'.repeat(32),
        settingsHash: 'h',
      },
    });

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { deviceId: 'dev-1' } },
    });

    expect(result.errors).toBeUndefined();
    expect(await harness.prisma.deviceEdition.count()).toBe(0);
  });

  it('still succeeds when the edition-cache purge fails, and logs a warning', async () => {
    vi.spyOn(harness.stores.edition, 'purgeForDevice').mockRejectedValueOnce(
      new Error('disk full')
    );

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { deviceId: 'dev-1' } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.deviceDelete).toEqual({
      __typename: 'DeviceDeletePayload',
      deletedDeviceId: 'dev-1',
    });
    expect(logger('graphql-device-mutation').warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'deviceDelete — edition-cache purge failed for device "dev-1" — disk full'
      )
    );
  });

  it('resolves to null for an unknown deviceId', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { deviceId: 'no-such-device' } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.deviceDelete).toBeNull();
  });

  it('returns InvalidInputError for a blank deviceId', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { deviceId: '' } },
    });

    expect(result.data?.deviceDelete).toMatchObject({ __typename: 'InvalidInputError' });
  });

  it('refuses a non-admin caller, leaving the row untouched', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { deviceId: 'dev-1' } },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(await harness.prisma.device.findUnique({ where: { id: 'dev-1' } })).not.toBeNull();
  });
});
