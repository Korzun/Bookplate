import * as fs from 'fs';

import { encodeGlobalID } from '@pothos/plugin-relay';

import { createHarness, type Harness } from '../../../test-util';
import { seedEditableBook } from './test-helpers';

vi.mock('../../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const BOOK_ID = 'a'.repeat(32);

const MUTATION = `
  mutation Delete($input: BookDeleteInput!) {
    bookDelete(input: $input) {
      __typename
      ... on BookDeletePayload {
        deletedBookId
        library { user { username } }
      }
      ... on InvalidInputError {
        message
        issues { path message }
      }
    }
  }
`;

const bookExists = async (userId: string, id: string): Promise<boolean> =>
  (await harness.prisma.book.findUnique({ where: { userId_id: { userId, id } } })) !== null;

describe('Mutation.bookDelete', () => {
  it('deletes the viewer’s own book — DB row and file both — and returns the deleted id', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Gone Soon');
    const book = (await harness.stores.book.getBookById(harness.aliceOwner, BOOK_ID))!;
    expect(fs.existsSync(book.path)).toBe(true);

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { userId: harness.aliceGlobalId, bookId: BOOK_ID } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookDelete).toEqual({
      __typename: 'BookDeletePayload',
      deletedBookId: BOOK_ID,
      library: { user: { username: 'alice' } },
    });
    expect(await bookExists(harness.aliceOwner.userId, BOOK_ID)).toBe(false);
    expect(fs.existsSync(book.path)).toBe(false);
  });

  it('resolves to null when no such book exists, mirroring REST’s 404', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { userId: harness.aliceGlobalId, bookId: 'no-such-book' } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookDelete).toBeNull();
  });

  it('returns InvalidInputError for an empty bookId and deletes nothing', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Untouched');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { userId: harness.aliceGlobalId, bookId: '' } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookDelete).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [{ path: ['bookId'], message: 'bookId must not be empty' }],
    });
    expect(await bookExists(harness.aliceOwner.userId, BOOK_ID)).toBe(true);
  });

  it('refuses one user deleting another user’s book, and leaves the row in place', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Alice’s Book');

    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: { input: { userId: harness.aliceGlobalId, bookId: BOOK_ID } },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.bookDelete ?? null).toBeNull();
    // Both halves matter: a mutation that 403s the caller but has already
    // written is still a breach.
    expect(await bookExists(harness.aliceOwner.userId, BOOK_ID)).toBe(true);
  });

  it('lets an admin delete a named user’s book without touching an identically-id’d book of another user', async () => {
    // Book ids are content hashes, so two users routinely hold the same one —
    // an owner-derivation bug shows up as the wrong user's book disappearing,
    // not as a count changing.
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Alice’s Copy');
    await seedEditableBook(harness, harness.bobOwner, BOOK_ID, 'Bob’s Copy');

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { userId: harness.aliceGlobalId, bookId: BOOK_ID } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookDelete).toEqual({
      __typename: 'BookDeletePayload',
      deletedBookId: BOOK_ID,
      library: { user: { username: 'alice' } },
    });
    expect(await bookExists(harness.aliceOwner.userId, BOOK_ID)).toBe(false);
    expect(await bookExists(harness.bobOwner.userId, BOOK_ID)).toBe(true);
  });

  it('refuses a User global ID that names no user', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { userId: encodeGlobalID('User', 'no-such-user'), bookId: BOOK_ID },
      },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });
});
