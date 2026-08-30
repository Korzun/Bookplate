import { encodeGlobalID } from '@pothos/plugin-relay';

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
  mutation Delete($id: ID!) {
    bookRequestDelete(id: $id) { deletedId }
  }
`;

const seedRequest = async (userId: string): Promise<string> => {
  await harness.prisma.bookRequest.create({
    data: {
      userId,
      id: 'req-1',
      title: 'Dune',
      author: 'Frank Herbert',
      dedupeKey: 'dune\0frank herbert',
      createdAt: 1_000,
    },
  });
  return encodeGlobalID('BookRequest', JSON.stringify([userId, 'req-1']));
};

describe('Mutation.bookRequestDelete', () => {
  it('lets the owner withdraw their own request', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: gid },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookRequestDelete).toEqual({ deletedId: gid });
    expect(await harness.prisma.bookRequest.count()).toBe(0);
  });

  it('lets an admin clear a request', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { id: gid },
    });
    expect(result.data?.bookRequestDelete).toEqual({ deletedId: gid });
    expect(await harness.prisma.bookRequest.count()).toBe(0);
  });

  it('refuses another reader', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);

    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: { id: gid },
    });

    expect(result.data?.bookRequestDelete ?? null).toBeNull();
    expect(await harness.prisma.bookRequest.count()).toBe(1);
  });

  it('returns null for a request that is not there', async () => {
    const missing = encodeGlobalID(
      'BookRequest',
      JSON.stringify([harness.aliceOwner.userId, 'gone'])
    );
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: missing },
    });
    expect(result.data?.bookRequestDelete ?? null).toBeNull();
  });

  it('deletes a resolved request too', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    await harness.prisma.bookRequest.updateMany({ data: { status: 'declined' } });

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: gid },
    });
    expect(result.data?.bookRequestDelete).toEqual({ deletedId: gid });
  });
});
