import { encodeGlobalID } from '@pothos/plugin-relay';

import { createHarness, type Harness } from '../../../test-util';
import { rawBookId, seedEditableBook } from './test-helpers';

vi.mock('../../../../logger');
// See update-metadata.test.ts's identical mock: this test seeds an "edit"
// lineage row via a real `bookUpdateMetadata` edit, which needs
// `assertValidEpub` to pass against the minimal fixture EPUB without real
// epubcheck running.
vi.mock('../../../../services/epub-validator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/epub-validator')>();
  return {
    ...actual,
    assertValidEpub: vi.fn().mockResolvedValue({
      valid: true,
      messages: [],
      counts: { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 },
    }),
  };
});

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
  vi.clearAllMocks();
});

const BOOK_ID = 'a'.repeat(32);
const DOCUMENT_ID = 'doc-1234567890abcdef';

const MUTATION = `
  mutation UnlinkDocument($input: BookUnlinkDocumentInput!) {
    bookUnlinkDocument(input: $input) {
      __typename
      ... on BookUnlinkDocumentPayload {
        book { id lineage { oldId newId type } }
      }
      ... on InvalidInputError {
        message
        issues { path message }
      }
      ... on LineageEntryNotFoundError { message }
      ... on EditLineageEntryError { message }
    }
  }
`;

const lineageOf = async (userId: string, id: string) =>
  harness.stores.book.getBookLineage({ userId, username: '' }, id);

const link = async (owner: Harness['aliceOwner'], bookId: string, documentId: string) => {
  await harness.stores.book.linkDocument(owner, bookId, documentId);
};

// Computed the same way the resolver decodes it — the independent check that
// the input `id` is a real, dereferenceable `Book` global ID, not a hand-rolled
// string (mirrors `delete.test.ts`'s `bookGlobalId`).
const bookGlobalId = (userId: string, id: string): string =>
  encodeGlobalID('Book', JSON.stringify([userId, id]));

describe('Mutation.bookUnlinkDocument', () => {
  it('removes a manually-linked (merge) entry from the viewer’s own book', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Unlink Me');
    await link(harness.aliceOwner, BOOK_ID, DOCUMENT_ID);

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), documentId: DOCUMENT_ID },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookUnlinkDocument as {
      __typename: string;
      book: { lineage: unknown[] };
    };
    expect(data.__typename).toBe('BookUnlinkDocumentPayload');
    expect(data.book.lineage).toEqual([]);
  });

  it('returns LineageEntryNotFoundError when no such lineage entry exists, and leaves lineage unchanged', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Nothing Linked');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), documentId: DOCUMENT_ID },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookUnlinkDocument).toEqual({
      __typename: 'LineageEntryNotFoundError',
      message: 'Lineage entry not found',
    });
    expect((await lineageOf(harness.aliceOwner.userId, BOOK_ID))?.entries).toEqual([]);
  });

  it('returns EditLineageEntryError for an organic edit-history entry, and leaves lineage unchanged (seen-to-fail below)', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Original Title');
    // Force an "edit" (not "merge") lineage row the same way `reimportBook`
    // does — via a real metadata edit through `applyEpubChanges`.
    const UPDATE = `
      mutation Update($input: BookUpdateMetadataInput!) {
        bookUpdateMetadata(input: $input) {
          __typename
          ... on BookUpdateMetadataPayload { book { id } }
        }
      }
    `;
    const edited = await harness.execute(UPDATE, {
      viewer: harness.aliceViewer,
      variables: {
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), title: 'Edited Title' },
      },
    });
    const editedData = edited.data?.bookUpdateMetadata as { book: { id: string } };
    // Decoded via `rawBookId`, not a same-object `bookId` field (removed):
    // the metadata edit re-fingerprints the file.
    const newBookId = rawBookId(editedData.book.id);
    const editEntries = (await lineageOf(harness.aliceOwner.userId, newBookId))?.entries ?? [];
    expect(editEntries).toEqual([
      { oldId: BOOK_ID, newId: newBookId, timestamp: expect.any(Number), type: 'edit' },
    ]);

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { id: bookGlobalId(harness.aliceOwner.userId, newBookId), documentId: BOOK_ID },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookUnlinkDocument).toEqual({
      __typename: 'EditLineageEntryError',
      message: 'Cannot unlink an organic edit entry',
    });
    expect((await lineageOf(harness.aliceOwner.userId, newBookId))?.entries).toEqual(editEntries);
  });

  it('returns InvalidInputError for an empty documentId', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'X');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), documentId: '' },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookUnlinkDocument).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [{ path: ['documentId'], message: 'documentId must not be empty' }],
    });
  });

  it('refuses one user unlinking another user’s book, and leaves lineage unchanged', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Alice’s Book');
    await link(harness.aliceOwner, BOOK_ID, DOCUMENT_ID);

    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: {
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), documentId: DOCUMENT_ID },
      },
    });

    expect((await lineageOf(harness.aliceOwner.userId, BOOK_ID))?.entries).toEqual([
      { oldId: DOCUMENT_ID, newId: BOOK_ID, timestamp: expect.any(Number), type: 'merge' },
    ]);
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.bookUnlinkDocument ?? null).toBeNull();
  });

  it('lets an admin unlink a named user’s book (content assertion, not just no-error)', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Admin Target');
    await link(harness.aliceOwner, BOOK_ID, DOCUMENT_ID);

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), documentId: DOCUMENT_ID },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookUnlinkDocument as { __typename: string };
    expect(data.__typename).toBe('BookUnlinkDocumentPayload');
    // Content assertion of correct owner-scoping: read directly off alice's
    // own userId (never the admin's, which has no library of its own).
    expect((await lineageOf(harness.aliceOwner.userId, BOOK_ID))?.entries).toEqual([]);
  });

  it('resolves to null for an admin when the encoded owner does not exist', async () => {
    // Covers `unlink-document.ts`'s `if (owner === null) return null;` branch
    // — a well-formed Book gid whose decoded userId names no real user. Only
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
    expect(result.data?.bookUnlinkDocument).toBeNull();
  });
});
