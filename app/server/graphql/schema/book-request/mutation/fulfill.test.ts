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
  mutation Fulfill($id: ID!, $bookId: ID!) {
    bookRequestFulfill(id: $id, bookId: $bookId) {
      __typename
      ... on BookRequestFulfillPayload {
        bookRequest { status book { title } }
      }
      ... on InvalidInputError { message }
      ... on BookRequestNotPendingError { message status }
    }
  }
`;

const BOOK_ID = 'a'.repeat(32);

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

const seedBook = async (userId: string, id: string): Promise<string> => {
  await harness.prisma.book.create({
    data: { userId, id, title: 'Dune', size: 1, mtime: 0, addedAt: 0 },
  });
  return encodeGlobalID('Book', JSON.stringify([userId, id]));
};

describe('Mutation.bookRequestFulfill', () => {
  it('closes the request and links the book, for an admin', async () => {
    const alice = harness.aliceOwner.userId;
    const requestGid = await seedRequest(alice);
    const bookGid = await seedBook(alice, BOOK_ID);

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { id: requestGid, bookId: bookGid },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookRequestFulfill).toEqual({
      __typename: 'BookRequestFulfillPayload',
      bookRequest: { status: 'FULFILLED', book: { title: 'Dune' } },
    });
  });

  it('refuses a book from a different library', async () => {
    const alice = harness.aliceOwner.userId;
    const requestGid = await seedRequest(alice);
    const bobBookGid = await seedBook(harness.bobOwner.userId, 'b'.repeat(32));

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { id: requestGid, bookId: bobBookGid },
    });

    expect((result.data?.bookRequestFulfill as { __typename: string }).__typename).toBe(
      'InvalidInputError'
    );
    const row = await harness.prisma.bookRequest.findFirstOrThrow();
    expect(row.status).toBe('pending');
  });

  it('reports an already-resolved request instead of overwriting it', async () => {
    const alice = harness.aliceOwner.userId;
    const requestGid = await seedRequest(alice);
    const bookGid = await seedBook(alice, BOOK_ID);
    await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { id: requestGid, bookId: bookGid },
    });

    const again = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { id: requestGid, bookId: bookGid },
    });

    expect(again.data?.bookRequestFulfill).toEqual({
      __typename: 'BookRequestNotPendingError',
      message: 'This request has already been fulfilled.',
      status: 'FULFILLED',
    });
  });

  it('refuses a non-admin, even the request owner', async () => {
    const alice = harness.aliceOwner.userId;
    const requestGid = await seedRequest(alice);
    const bookGid = await seedBook(alice, BOOK_ID);

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: requestGid, bookId: bookGid },
    });

    expect(result.errors).toBeDefined();
    const row = await harness.prisma.bookRequest.findFirstOrThrow();
    expect(row.status).toBe('pending');
  });

  it('returns null for a request that does not exist', async () => {
    const bookGid = await seedBook(harness.aliceOwner.userId, BOOK_ID);
    const missing = encodeGlobalID(
      'BookRequest',
      JSON.stringify([harness.aliceOwner.userId, 'no-such-request'])
    );

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { id: missing, bookId: bookGid },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookRequestFulfill ?? null).toBeNull();
  });
});
