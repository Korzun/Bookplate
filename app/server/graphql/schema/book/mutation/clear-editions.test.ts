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
  vi.clearAllMocks();
});

const BOOK_ID = 'a'.repeat(32);

const MUTATION = `
  mutation ClearEditions($input: BookClearEditionsInput!) {
    bookClearEditions(input: $input) {
      __typename
      ... on BookClearEditionsPayload {
        clearedCount
        book { id deviceEditionCount }
      }
    }
  }
`;

const seedEdition = async (userId: string, originalBookId: string, deviceId: string) =>
  harness.prisma.deviceEdition.create({
    data: {
      userId,
      originalBookId,
      deviceId,
      editionId: `${originalBookId}-${deviceId}`,
      settingsHash: 'hash',
    },
  });

const editionCountOf = async (userId: string, bookId: string) =>
  harness.prisma.deviceEdition.count({ where: { userId, originalBookId: bookId } });

// Computed the same way the resolver decodes it — the independent check that
// the input `id` is a real, dereferenceable `Book` global ID (mirrors
// `delete.test.ts`'s `bookGlobalId`).
const bookGlobalId = (userId: string, id: string): string =>
  encodeGlobalID('Book', JSON.stringify([userId, id]));

describe('Mutation.bookClearEditions', () => {
  it('clears every cached device edition for the viewer’s own book and returns the count', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Has Editions');
    await seedEdition(harness.aliceOwner.userId, BOOK_ID, 'device-1');
    await seedEdition(harness.aliceOwner.userId, BOOK_ID, 'device-2');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID) } },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookClearEditions as {
      __typename: string;
      clearedCount: number;
      book: { id: string; deviceEditionCount: number };
    };
    expect(data.__typename).toBe('BookClearEditionsPayload');
    expect(data.clearedCount).toBe(2);
    expect(data.book.deviceEditionCount).toBe(0);
    expect(await editionCountOf(harness.aliceOwner.userId, BOOK_ID)).toBe(0);
  });

  it('returns clearedCount 0 for a book with no cached editions, and leaves nothing to clear', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'No Editions');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID) } },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookClearEditions as { clearedCount: number };
    expect(data.clearedCount).toBe(0);
  });

  it('resolves to null when the book does not exist for the resolved owner', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, 'no-such-book') } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookClearEditions).toBeNull();
  });

  it('refuses one user clearing another user’s book editions, and leaves the victim’s editions unchanged', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Alice’s Book');
    await seedEdition(harness.aliceOwner.userId, BOOK_ID, 'device-1');

    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID) } },
    });

    // Victim-row assertion first — see update-metadata.test.ts's identical
    // ordering rationale.
    expect(await editionCountOf(harness.aliceOwner.userId, BOOK_ID)).toBe(1);
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.bookClearEditions ?? null).toBeNull();
  });

  it('lets an admin clear a named user’s book editions (content assertion, not just no-error)', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Admin Target');
    await seedEdition(harness.aliceOwner.userId, BOOK_ID, 'device-1');

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID) } },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookClearEditions as { clearedCount: number };
    expect(data.clearedCount).toBe(1);
    // Content assertion of correct owner-scoping: read directly off alice's
    // own userId (never the admin's, which has no library of its own).
    expect(await editionCountOf(harness.aliceOwner.userId, BOOK_ID)).toBe(0);
  });

  it('resolves to null for an admin when the encoded owner does not exist', async () => {
    // Well-formed Book gid whose decoded userId names no real user, only
    // reachable past `authScopes` for an admin viewer — see `validate.test.
    // ts`'s identical case.
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { id: bookGlobalId('no-such-user', BOOK_ID) } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookClearEditions).toBeNull();
  });
});
