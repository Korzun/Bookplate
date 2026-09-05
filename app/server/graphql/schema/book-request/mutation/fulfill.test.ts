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

  // Finding 6 of the final review: a malformed `id` used to answer
  // `InvalidInputError`, contradicting this mutation's own doc comment ("A
  // NULL RESULT MEANS 'no such request', and says nothing more") and its
  // sibling `decline.ts`, which returns `null` for the identical input. Both
  // mutations are admin-only, so there is no leak either way — `null` is the
  // one that matches the doc comment and the sibling.
  it('returns null, not InvalidInputError, for a malformed request id', async () => {
    const bookGid = await seedBook(harness.aliceOwner.userId, BOOK_ID);

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { id: 'not-a-valid-global-id', bookId: bookGid },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookRequestFulfill ?? null).toBeNull();
  });

  // The `bookId` argument is a genuinely different case from `id` above — an
  // admin who gets it wrong should learn "that book is not in this reader
  // library", not silently no-op — so a malformed `bookId` keeps
  // `InvalidInputError`, matching the `noSuchBook` outcome it is a sibling of.
  it('still returns InvalidInputError for a malformed bookId', async () => {
    const requestGid = await seedRequest(harness.aliceOwner.userId);

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { id: requestGid, bookId: 'not-a-valid-global-id' },
    });

    expect((result.data?.bookRequestFulfill as { __typename: string }).__typename).toBe(
      'InvalidInputError'
    );
  });
});
