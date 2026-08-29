import { encodeGlobalID } from '@pothos/plugin-relay';

import { getBookLineage, linkDocument } from '../../../../services/book-lineage';
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
const OLD_ID = 'b'.repeat(32);
const DOCUMENT_ID = 'doc-1234567890abcdef';

const MUTATION = `
  mutation ClearEditLineage($input: BookClearEditLineageInput!) {
    bookClearEditLineage(input: $input) {
      __typename
      ... on BookClearEditLineagePayload {
        clearedCount
        book { id }
      }
    }
  }
`;

// Computed the same way the resolver decodes it — the independent check that
// the input `id` is a real, dereferenceable `Book` global ID (mirrors
// `clear-editions.test.ts`'s `bookGlobalId`).
const bookGlobalId = (userId: string, id: string): string =>
  encodeGlobalID('Book', JSON.stringify([userId, id]));

const seedEditRow = async (userId: string, oldId: string, currentId: string) =>
  harness.prisma.bookIdHistory.create({
    data: {
      userId,
      oldId,
      currentId,
      timestamp: 1_700_000_000_000,
      type: 'edit',
    },
  });

const lineageOf = async (userId: string, id: string) =>
  getBookLineage(harness.prisma, { userId, username: '' }, id);

describe('Mutation.bookClearEditLineage', () => {
  it('clears the viewer’s own book’s edit-lineage rows and returns the count', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Edited Book');
    await seedEditRow(harness.aliceOwner.userId, OLD_ID, BOOK_ID);

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID) } },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookClearEditLineage as {
      __typename: string;
      clearedCount: number;
      book: { id: string };
    };
    expect(data.__typename).toBe('BookClearEditLineagePayload');
    expect(data.clearedCount).toBe(1);
    expect(data.book.id).toBe(bookGlobalId(harness.aliceOwner.userId, BOOK_ID));
    expect((await lineageOf(harness.aliceOwner.userId, BOOK_ID))?.entries).toEqual([]);
  });

  // THE LOAD-BEARING TEST: proves the mutation's name honest. `type = 'edit'`
  // and `type = 'merge'` rows are disjoint (`clearEditLineage`'s `type = 'edit'`
  // filter, `services/book-lineage.ts`) — clearing
  // edit lineage must NOT touch a merge row written by `linkDocument`. Without
  // this test, "bookClearEditLineage" would be an unverified claim and could
  // silently regress into behaving like a bulk `bookUnlinkDocument`.
  it('clears only edit-lineage rows; a merge row from bookLinkDocument survives', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Merged And Edited');
    await seedEditRow(harness.aliceOwner.userId, OLD_ID, BOOK_ID);
    const linked = await linkDocument(harness.prisma, harness.aliceOwner, BOOK_ID, DOCUMENT_ID);
    expect(linked).toBe(true);

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID) } },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookClearEditLineage as { clearedCount: number };
    // Only the one edit row counted — the merge row is not part of the count.
    expect(data.clearedCount).toBe(1);

    const lineage = await lineageOf(harness.aliceOwner.userId, BOOK_ID);
    expect(lineage?.entries).toEqual([
      { oldId: DOCUMENT_ID, newId: BOOK_ID, timestamp: expect.any(Number), type: 'merge' },
    ]);
  });

  it('returns clearedCount 0 for a book that exists but has no edit-lineage rows (distinct from not-found)', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'No Edit Lineage');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID) } },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookClearEditLineage as { __typename: string; clearedCount: number };
    expect(data.__typename).toBe('BookClearEditLineagePayload');
    expect(data.clearedCount).toBe(0);
  });

  it('resolves to null when the book does not exist for the resolved owner (distinct from clearedCount 0)', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, 'no-such-book') } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookClearEditLineage).toBeNull();
  });

  it('refuses one user clearing another user’s book’s edit lineage, and leaves the victim’s rows unchanged', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Alice’s Book');
    await seedEditRow(harness.aliceOwner.userId, OLD_ID, BOOK_ID);

    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID) } },
    });

    // Victim-row assertion first — see update-metadata.test.ts's identical
    // ordering rationale.
    expect((await lineageOf(harness.aliceOwner.userId, BOOK_ID))?.entries).toEqual([
      { oldId: OLD_ID, newId: BOOK_ID, timestamp: expect.any(Number), type: 'edit' },
    ]);
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.bookClearEditLineage ?? null).toBeNull();
  });

  it('lets an admin clear a named user’s book edit lineage (content assertion, not just no-error), leaving a merge row intact', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Admin Target');
    await seedEditRow(harness.aliceOwner.userId, OLD_ID, BOOK_ID);
    await linkDocument(harness.prisma, harness.aliceOwner, BOOK_ID, DOCUMENT_ID);

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID) } },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookClearEditLineage as { clearedCount: number };
    expect(data.clearedCount).toBe(1);
    // Content assertion of correct owner-scoping: read directly off alice's
    // own userId (never the admin's, which has no library of its own).
    const lineage = await lineageOf(harness.aliceOwner.userId, BOOK_ID);
    expect(lineage?.entries).toEqual([
      { oldId: DOCUMENT_ID, newId: BOOK_ID, timestamp: expect.any(Number), type: 'merge' },
    ]);
  });

  it('resolves to null for an admin when the encoded owner does not exist', async () => {
    // Well-formed Book gid whose decoded userId names no real user, only
    // reachable past `authScopes` for an admin viewer — see `clear-editions.
    // test.ts`'s identical case.
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { id: bookGlobalId('no-such-user', BOOK_ID) } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookClearEditLineage).toBeNull();
  });
});
