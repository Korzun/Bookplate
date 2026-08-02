import { createHarness, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const MUTATION = `
  mutation Create($input: DeviceCreateInput!) {
    deviceCreate(input: $input) {
      __typename
      ... on DeviceCreatePayload {
        device { name slug coverWidth coverHeight coverFit bwCover simplify }
      }
      ... on DeviceSlugConflictError { message slug }
      ... on InvalidInputError { message issues { path message } }
    }
  }
`;

const validInput = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'Kobo Clara',
  coverWidth: null,
  coverHeight: null,
  coverFit: 'CONTAIN',
  bwCover: false,
  simplify: false,
  ...overrides,
});

describe('Mutation.deviceCreate', () => {
  it('creates a device with the derived slug, for an admin', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: validInput({ coverWidth: 758, coverHeight: 1024, coverFit: 'SMART' }) },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.deviceCreate).toEqual({
      __typename: 'DeviceCreatePayload',
      device: {
        name: 'Kobo Clara',
        slug: 'kobo-clara',
        coverWidth: 758,
        coverHeight: 1024,
        coverFit: 'SMART',
        bwCover: false,
        simplify: false,
      },
    });

    const row = await harness.prisma.device.findUnique({ where: { slug: 'kobo-clara' } });
    expect(row).not.toBeNull();
  });

  it('trims the name before deriving the slug and storing it', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: validInput({ name: '  Kobo Clara  ' }) },
    });

    expect(result.errors).toBeUndefined();
    const created = result.data?.deviceCreate as { device: { name: string; slug: string } };
    expect(created.device).toMatchObject({ name: 'Kobo Clara', slug: 'kobo-clara' });
  });

  it('returns InvalidInputError for a blank name', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: validInput({ name: '   ' }) },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.deviceCreate).toMatchObject({ __typename: 'InvalidInputError' });
  });

  it('returns InvalidInputError for a name over 50 characters', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: validInput({ name: 'x'.repeat(51) }) },
    });

    expect(result.data?.deviceCreate).toMatchObject({ __typename: 'InvalidInputError' });
  });

  it('returns InvalidInputError for a symbol-only name (empty derived slug)', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: validInput({ name: '!!!' }) },
    });

    expect(result.data?.deviceCreate).toMatchObject({ __typename: 'InvalidInputError' });
  });

  it('returns InvalidInputError for a non-positive coverWidth', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: validInput({ coverWidth: 0 }) },
    });

    expect(result.data?.deviceCreate).toMatchObject({ __typename: 'InvalidInputError' });
  });

  it('returns DeviceSlugConflictError when another device already derives the same slug', async () => {
    await harness.prisma.device.create({
      data: { id: 'existing', name: 'Kobo Clara', slug: 'kobo-clara' },
    });

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: validInput() },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.deviceCreate).toEqual({
      __typename: 'DeviceSlugConflictError',
      message: 'A device with this name already exists',
      slug: 'kobo-clara',
    });
    // Nothing extra was created.
    expect(await harness.prisma.device.count()).toBe(1);
  });

  it('refuses a non-admin caller, creating nothing', async () => {
    const before = await harness.prisma.device.count();

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: validInput() },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(await harness.prisma.device.count()).toBe(before);
  });
});
