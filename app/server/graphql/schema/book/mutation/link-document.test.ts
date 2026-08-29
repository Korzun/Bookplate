import { encodeGlobalID } from '@pothos/plugin-relay';

import { getBookLineage } from '../../../../services/book-lineage';
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
const OTHER_BOOK_ID = 'b'.repeat(32);
const DOCUMENT_ID = 'doc-1234567890abcdef';

const MUTATION = `
  mutation LinkDocument($input: BookLinkDocumentInput!) {
    bookLinkDocument(input: $input) {
      __typename
      ... on BookLinkDocumentPayload {
        book { id lineage { oldId newId type } }
      }
      ... on InvalidInputError {
        message
        issues { path message }
      }
      ... on SelfLinkError { message }
      ... on DocumentAlreadyLinkedError { message documentId book { id title } }
      ... on DocumentIsBookError { message book { id title } }
    }
  }
`;

const lineageOf = async (userId: string, id: string) =>
  getBookLineage(harness.prisma, { userId, username: '' }, id);

// Computed the same way the resolver decodes it — the independent check that
// the input `id` is a real, dereferenceable `Book` global ID, not a hand-rolled
// string (mirrors `delete.test.ts`'s `bookGlobalId`).
const bookGlobalId = (userId: string, id: string): string =>
  encodeGlobalID('Book', JSON.stringify([userId, id]));

describe('Mutation.bookLinkDocument', () => {
  it('merges a document id into the viewer’s own book’s lineage', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Merge Target');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), documentId: DOCUMENT_ID },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookLinkDocument as {
      __typename: string;
      book: { id: string; lineage: { oldId: string; newId: string; type: string }[] };
    };
    expect(data.__typename).toBe('BookLinkDocumentPayload');
    expect(data.book.id).toBe(bookGlobalId(harness.aliceOwner.userId, BOOK_ID));
    expect(data.book.lineage).toEqual([{ oldId: DOCUMENT_ID, newId: BOOK_ID, type: 'MERGE' }]);
  });

  it('trims documentId before linking, matching REST’s documentId.trim()', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Trim Me');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
          documentId: `  ${DOCUMENT_ID}  `,
        },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookLinkDocument as {
      book: { lineage: { oldId: string }[] };
    };
    expect(data.book.lineage).toEqual([{ oldId: DOCUMENT_ID, newId: BOOK_ID, type: 'MERGE' }]);
  });

  it('resolves to null when the book does not exist for the resolved owner', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          id: bookGlobalId(harness.aliceOwner.userId, 'no-such-book'),
          documentId: DOCUMENT_ID,
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookLinkDocument).toBeNull();
  });

  it('returns InvalidInputError for a blank (whitespace-only) documentId, matching REST’s "documentId is required"', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Untouched');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), documentId: '   ' },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookLinkDocument).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [{ path: ['documentId'], message: 'documentId must not be empty' }],
    });
    expect((await lineageOf(harness.aliceOwner.userId, BOOK_ID))?.entries).toEqual([]);
  });

  it('returns SelfLinkError when documentId equals bookId, and leaves lineage unchanged', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'No Self Link');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), documentId: BOOK_ID },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookLinkDocument).toEqual({
      __typename: 'SelfLinkError',
      message: expect.any(String),
    });
    expect((await lineageOf(harness.aliceOwner.userId, BOOK_ID))?.entries).toEqual([]);
  });

  it('returns DocumentAlreadyLinkedError, resolving `book` to the book it is already linked to, and leaves lineage unchanged', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'First Owner');
    await seedEditableBook(harness, harness.aliceOwner, OTHER_BOOK_ID, 'Second Owner');
    const first = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), documentId: DOCUMENT_ID },
      },
    });
    expect(first.errors).toBeUndefined();

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          id: bookGlobalId(harness.aliceOwner.userId, OTHER_BOOK_ID),
          documentId: DOCUMENT_ID,
        },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookLinkDocument as {
      __typename: string;
      documentId: string;
      book: { id: string; title: string };
    };
    expect(data.__typename).toBe('DocumentAlreadyLinkedError');
    expect(data.documentId).toBe(DOCUMENT_ID);
    expect(data.book).toEqual({
      id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
      title: 'First Owner',
    });
    expect((await lineageOf(harness.aliceOwner.userId, OTHER_BOOK_ID))?.entries).toEqual([]);
  });

  it('returns DocumentIsBookError when documentId names an existing book, resolving `book` to it, and leaves lineage unchanged', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Target');
    await seedEditableBook(harness, harness.aliceOwner, OTHER_BOOK_ID, 'The Document Itself');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
          documentId: OTHER_BOOK_ID,
        },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookLinkDocument as {
      __typename: string;
      book: { id: string; title: string };
    };
    expect(data.__typename).toBe('DocumentIsBookError');
    expect(data.book).toEqual({
      id: bookGlobalId(harness.aliceOwner.userId, OTHER_BOOK_ID),
      title: 'The Document Itself',
    });
    expect((await lineageOf(harness.aliceOwner.userId, BOOK_ID))?.entries).toEqual([]);
  });

  it('refuses one user linking a document into another user’s book, and leaves lineage unchanged', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Alice’s Book');

    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: {
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), documentId: DOCUMENT_ID },
      },
    });

    // Victim-row assertion first — see update-metadata.test.ts's identical
    // ordering rationale.
    expect((await lineageOf(harness.aliceOwner.userId, BOOK_ID))?.entries).toEqual([]);
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.bookLinkDocument ?? null).toBeNull();
  });

  // Review M-6: the reverse direction — bob names ALICE's book id as the
  // `documentId` to merge into HIS OWN book. Adjudicated safe by
  // construction (`linkDocument`'s `book_id_history` writes and progress
  // migration are both `user_id`-scoped, `book-store.ts:560-614`), but
  // previously untested. Succeeds for bob (writing only into his own
  // namespace) and leaves alice's book row and progress untouched.
  it('lets bob merge a documentId that names alice’s own book into HIS OWN book, leaving alice’s book and progress untouched', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Alice’s Book');
    await harness.prisma.progress.create({
      data: {
        userId: harness.aliceOwner.userId,
        document: BOOK_ID,
        progress: 'epubcfi(/6/2!)',
        percentage: 0.5,
        device: 'Alice’s Device',
        deviceId: 'alice-device',
        timestamp: 1_700_000_000,
      },
    });
    await seedEditableBook(harness, harness.bobOwner, OTHER_BOOK_ID, 'Bob’s Book');

    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: {
        input: {
          id: bookGlobalId(harness.bobOwner.userId, OTHER_BOOK_ID),
          documentId: BOOK_ID,
        },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookLinkDocument as { __typename: string };
    expect(data.__typename).toBe('BookLinkDocumentPayload');
    // Bob's own lineage gained the entry, scoped to his namespace only.
    expect((await lineageOf(harness.bobOwner.userId, OTHER_BOOK_ID))?.entries).toEqual([
      { oldId: BOOK_ID, newId: OTHER_BOOK_ID, timestamp: expect.any(Number), type: 'merge' },
    ]);
    // Alice's own book/lineage/progress are all untouched.
    expect((await lineageOf(harness.aliceOwner.userId, BOOK_ID))?.entries).toEqual([]);
    const aliceProgress = await harness.prisma.progress.findUnique({
      where: { userId_document: { userId: harness.aliceOwner.userId, document: BOOK_ID } },
    });
    expect(aliceProgress?.percentage).toBe(0.5);
  });

  it('lets an admin link a document into a named user’s book (content assertion, not just no-error)', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Admin Target');

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), documentId: DOCUMENT_ID },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookLinkDocument as { book: { id: string } };
    expect(data.book.id).toBe(bookGlobalId(harness.aliceOwner.userId, BOOK_ID));
    // Content assertion of correct owner-scoping: read directly off alice's
    // own userId (never the admin's, which has no library of its own).
    expect((await lineageOf(harness.aliceOwner.userId, BOOK_ID))?.entries).toEqual([
      { oldId: DOCUMENT_ID, newId: BOOK_ID, timestamp: expect.any(Number), type: 'merge' },
    ]);
  });

  it('resolves to null for an admin when the encoded owner does not exist', async () => {
    // Covers `link-document.ts`'s `if (owner === null) return null;` branch —
    // a well-formed Book gid whose decoded userId names no real user. Only
    // reachable past `authScopes` for an admin viewer — see `validate.test.
    // ts`'s identical case. Also restores, in the new input's terms, the
    // assertion the old separate-`userId`-field shape's "refuses a User
    // global ID that names no user" test used to carry.
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: { id: bookGlobalId('no-such-user', BOOK_ID), documentId: DOCUMENT_ID },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookLinkDocument).toBeNull();
  });
});
