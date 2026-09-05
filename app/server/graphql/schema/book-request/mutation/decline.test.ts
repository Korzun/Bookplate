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

const MUTATION = `
  mutation Decline($id: ID!, $reason: String) {
    bookRequestDecline(id: $id, reason: $reason) {
      __typename
      ... on BookRequestDeclinePayload { bookRequest { status declineReason } }
      ... on BookRequestNotPendingError { message status }
    }
  }
`;

describe('Mutation.bookRequestDecline', () => {
  it('closes the request with the reason, for an admin', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { id: gid, reason: "Couldn't find a copy" },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookRequestDecline).toEqual({
      __typename: 'BookRequestDeclinePayload',
      bookRequest: { status: 'DECLINED', declineReason: "Couldn't find a copy" },
    });
  });

  it('accepts an omitted reason', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { id: gid },
    });
    expect(result.data?.bookRequestDecline).toEqual({
      __typename: 'BookRequestDeclinePayload',
      bookRequest: { status: 'DECLINED', declineReason: '' },
    });
  });

  it('reports an already-resolved request', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    await harness.execute(MUTATION, { viewer: harness.adminViewer, variables: { id: gid } });

    const again = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { id: gid },
    });

    expect(again.data?.bookRequestDecline).toEqual({
      __typename: 'BookRequestNotPendingError',
      message: 'This request has already been declined.',
      status: 'DECLINED',
    });
  });

  it('refuses a non-admin', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: gid },
    });
    expect(result.errors).toBeDefined();
  });
});
