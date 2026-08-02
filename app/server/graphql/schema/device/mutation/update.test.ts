import { logger } from '../../../../logger';
import { createHarness, type Harness } from '../../../test-util';

// A bare `vi.mock('../../../../logger')` auto-mock hands back a FRESH mocked
// object on every `logger(namespace)` call, so a test could never get a
// handle on the exact object `purge-quietly.ts`'s module-scope `const log =
// logger('graphql-device-mutation')` captured once at import time. This
// factory memoizes one mock object per namespace instead — see
// `book/mutation/replace.test.ts`'s identical comment for the full
// explanation.
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
  mutation Update($input: DeviceUpdateInput!) {
    deviceUpdate(input: $input) {
      __typename
      ... on DeviceUpdatePayload {
        device { name slug coverWidth coverHeight coverFit bwCover simplify }
      }
      ... on DeviceSlugConflictError { message slug }
      ... on InvalidInputError { message }
    }
  }
`;

const validInput = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  deviceId: 'dev-1',
  name: 'Kobo Clara',
  coverWidth: null,
  coverHeight: null,
  coverFit: 'CONTAIN',
  bwCover: false,
  simplify: false,
  ...overrides,
});

describe('Mutation.deviceUpdate', () => {
  it('replaces every field, regenerating the slug from the new name, for an admin', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: validInput({ name: 'Kobo Libra', coverFit: 'SMART', bwCover: true, simplify: true }),
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.deviceUpdate).toEqual({
      __typename: 'DeviceUpdatePayload',
      device: {
        name: 'Kobo Libra',
        slug: 'kobo-libra',
        coverWidth: null,
        coverHeight: null,
        coverFit: 'SMART',
        bwCover: true,
        simplify: true,
      },
    });
  });

  it('does not conflict with itself when the name (and so slug) is unchanged', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: validInput({ bwCover: true }) },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.deviceUpdate).toMatchObject({
      __typename: 'DeviceUpdatePayload',
      device: { slug: 'kobo-clara', bwCover: true },
    });
  });

  it('returns DeviceSlugConflictError when renaming to another device’s slug', async () => {
    await harness.prisma.device.create({
      data: { id: 'dev-2', name: 'Kobo Libra', slug: 'kobo-libra' },
    });

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: validInput({ name: 'Kobo Libra' }) },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.deviceUpdate).toEqual({
      __typename: 'DeviceSlugConflictError',
      message: 'A device with this name already exists',
      slug: 'kobo-libra',
    });
    // Untouched.
    const row = await harness.prisma.device.findUnique({ where: { id: 'dev-1' } });
    expect(row?.name).toBe('Kobo Clara');
  });

  it('resolves to null for an unknown deviceId', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: validInput({ deviceId: 'no-such-device' }) },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.deviceUpdate).toBeNull();
  });

  it('returns InvalidInputError for a blank deviceId', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: validInput({ deviceId: '' }) },
    });

    expect(result.data?.deviceUpdate).toMatchObject({ __typename: 'InvalidInputError' });
  });

  /**
   * Mirror of `create.test.ts`'s 4 `name`/dimension validation tests
   * (review, task 7, I-1): before the extraction, `update.ts` carried its
   * own verbatim copy of this zod block with zero test coverage of its own —
   * REST cannot drift the two (`PATCH`/`POST` share one `parseBody`), but two
   * independent GraphQL copies could have. These pin the SHARED
   * `deviceFieldsSchema` fragment from the update side too, so a future
   * change to it is caught from both call sites, not just `create.test.ts`.
   */
  describe('shared name/dimension validation (mirrors create.test.ts)', () => {
    it('returns InvalidInputError for a blank name', async () => {
      const result = await harness.execute(MUTATION, {
        viewer: harness.adminViewer,
        variables: { input: validInput({ name: '   ' }) },
      });

      expect(result.data?.deviceUpdate).toMatchObject({ __typename: 'InvalidInputError' });
    });

    it('returns InvalidInputError for a name over 50 characters', async () => {
      const result = await harness.execute(MUTATION, {
        viewer: harness.adminViewer,
        variables: { input: validInput({ name: 'x'.repeat(51) }) },
      });

      expect(result.data?.deviceUpdate).toMatchObject({ __typename: 'InvalidInputError' });
    });

    it('returns InvalidInputError for a symbol-only name (empty derived slug)', async () => {
      const result = await harness.execute(MUTATION, {
        viewer: harness.adminViewer,
        variables: { input: validInput({ name: '!!!' }) },
      });

      expect(result.data?.deviceUpdate).toMatchObject({ __typename: 'InvalidInputError' });
    });

    it('returns InvalidInputError for a non-positive coverWidth', async () => {
      const result = await harness.execute(MUTATION, {
        viewer: harness.adminViewer,
        variables: { input: validInput({ coverWidth: 0 }) },
      });

      expect(result.data?.deviceUpdate).toMatchObject({ __typename: 'InvalidInputError' });
    });
  });

  /**
   * Review, task 7, M-2: REST's `PATCH /:id` checks existence (`getById` →
   * 404) BEFORE parsing the body (`parseBody` → 400) — `routes/devices.ts:
   * 111-119`. For an input that fails both (an unknown `deviceId` AND a
   * blank `name`), REST answers 404, never 400. This resolver reorders to
   * match: `deviceId` is validated and looked up first, and the
   * `name`/dimension fields are only parsed once the device is confirmed to
   * exist — so this must resolve to `null` (REST's 404-equivalent), not
   * `InvalidInputError`, even though the name is also invalid.
   */
  it('resolves to null (not InvalidInputError) for an unknown device with an invalid body', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: validInput({ deviceId: 'no-such-device', name: '   ' }) },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.deviceUpdate).toBeNull();
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
      variables: { input: validInput({ bwCover: true }) },
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
      variables: { input: validInput({ bwCover: true }) },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.deviceUpdate).toMatchObject({ __typename: 'DeviceUpdatePayload' });
    expect(logger('graphql-device-mutation').warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'deviceUpdate — edition-cache purge failed for device "dev-1" — disk full'
      )
    );
  });

  it('refuses a non-admin caller, leaving the row untouched', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: validInput({ name: 'Hacked' }) },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    const row = await harness.prisma.device.findUnique({ where: { id: 'dev-1' } });
    expect(row?.name).toBe('Kobo Clara');
  });
});
