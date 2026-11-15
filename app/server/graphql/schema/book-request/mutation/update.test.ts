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
  mutation Update($id: ID!, $input: BookRequestUpdateInput!) {
    bookRequestUpdate(id: $id, input: $input) {
      __typename
      ... on BookRequestUpdatePayload { bookRequest { title author note status } }
      ... on InvalidInputError { message issues { path message } }
      ... on DuplicateBookRequestError { message existingRequestId }
      ... on BookRequestNotPendingError { message status }
    }
  }
`;

const seedRequest = async (userId: string): Promise<string> => {
  await harness.prisma.bookRequest.create({
    data: {
      userId,
      id: 'req-1',
      title: 'Dune',
      author: 'Frank Hebert',
      dedupeKey: 'dune\0frank hebert',
      createdAt: 1_000,
    },
  });
  return encodeGlobalID('BookRequest', JSON.stringify([userId, 'req-1']));
};

describe('Mutation.bookRequestUpdate', () => {
  it('lets the owner correct the author and leaves the other fields alone', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: gid, input: { author: 'Frank Herbert' } },
    });
    expect(result.errors).toBeUndefined();
    expect(result.data?.bookRequestUpdate).toEqual({
      __typename: 'BookRequestUpdatePayload',
      bookRequest: { title: 'Dune', author: 'Frank Herbert', note: '', status: 'PENDING' },
    });
  });

  it('lets an admin edit a request', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { id: gid, input: { note: 'hardcover please' } },
    });
    expect(result.data?.bookRequestUpdate).toMatchObject({
      __typename: 'BookRequestUpdatePayload',
    });
  });

  it('refuses another reader with null, leaving the row untouched', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: { id: gid, input: { author: 'Bob' } },
    });
    expect(result.data?.bookRequestUpdate ?? null).toBeNull();
    const row = await harness.prisma.bookRequest.findFirstOrThrow();
    expect(row.author).toBe('Frank Hebert');
  });

  it('returns null for a request that is not there', async () => {
    const missing = encodeGlobalID(
      'BookRequest',
      JSON.stringify([harness.aliceOwner.userId, 'gone'])
    );
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: missing, input: { title: 'x' } },
    });
    expect(result.data?.bookRequestUpdate ?? null).toBeNull();
  });

  it('reports an already-resolved request', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    await harness.prisma.bookRequest.updateMany({ data: { status: 'declined' } });
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: gid, input: { title: 'x' } },
    });
    expect(result.data?.bookRequestUpdate).toEqual({
      __typename: 'BookRequestNotPendingError',
      message: 'This request has already been declined.',
      status: 'DECLINED',
    });
  });

  it('reports a duplicate of another open request', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    await harness.prisma.bookRequest.create({
      data: {
        userId: harness.aliceOwner.userId,
        id: 'req-2',
        title: 'Dune Messiah',
        author: 'Frank Herbert',
        dedupeKey: 'dune messiah\0frank herbert',
        createdAt: 2_000,
      },
    });
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: gid, input: { title: 'dune messiah', author: 'frank herbert' } },
    });
    expect(result.data?.bookRequestUpdate).toEqual({
      __typename: 'DuplicateBookRequestError',
      message: 'You have already requested this book.',
      existingRequestId: 'req-2',
    });
  });

  it('refuses an empty author', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: gid, input: { author: '   ' } },
    });
    const payload = result.data?.bookRequestUpdate as {
      __typename: string;
      issues: { path: string[] }[];
    };
    expect(payload.__typename).toBe('InvalidInputError');
    expect(payload.issues.map((i) => i.path)).toContainEqual(['author']);
  });

  it('refuses a title over 500 characters', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: gid, input: { title: 'x'.repeat(501) } },
    });
    expect(result.data?.bookRequestUpdate).toMatchObject({ __typename: 'InvalidInputError' });
  });

  it('treats a null field as unchanged', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: gid, input: { title: null, author: 'Frank Herbert' } },
    });
    expect(result.data?.bookRequestUpdate).toMatchObject({
      bookRequest: { title: 'Dune', author: 'Frank Herbert' },
    });
  });

  it('accepts an empty input as a no-op', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: gid, input: {} },
    });
    expect(result.data?.bookRequestUpdate).toMatchObject({
      __typename: 'BookRequestUpdatePayload',
      bookRequest: { title: 'Dune', author: 'Frank Hebert' },
    });
  });

  it('refuses an unauthenticated caller', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    const result = await harness.execute(MUTATION, {
      viewer: null,
      variables: { id: gid, input: { title: 'x' } },
    });
    expect(result.errors).toBeDefined();
  });
});
