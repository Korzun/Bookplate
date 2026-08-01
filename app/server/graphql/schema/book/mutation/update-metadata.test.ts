import { encodeGlobalID } from '@pothos/plugin-relay';

import { BookHashCollisionError } from '../../../../services/book-store';
import { createHarness, type Harness } from '../../../test-util';
import { EMPTY_COUNTS, seedEditableBook } from './test-helpers';

vi.mock('../../../../logger');
// assertValidEpub: pass by default, so the happy-path edits don't need real
// epubcheck to run against the minimal fixture EPUB. Individual tests override
// with `mockRejectedValueOnce` to exercise the EpubValidationError branch.
// `toValidationReport`/`EpubValidationError` stay real: the resolver's
// `instanceof EpubValidationError` check depends on the real class.
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

import { assertValidEpub, EpubValidationError } from '../../../../services/epub-validator';

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

const MUTATION = `
  mutation Update($input: BookUpdateMetadataInput!) {
    bookUpdateMetadata(input: $input) {
      __typename
      ... on BookUpdateMetadataPayload {
        book { bookId title author publishDate }
      }
      ... on InvalidInputError {
        message
        issues { path message }
      }
      ... on BookHashCollisionError {
        message
        collidingBook { bookId title }
      }
      ... on EpubValidationError {
        message
        messages { code severity message }
      }
    }
  }
`;

const titleOf = async (userId: string, id: string): Promise<string | null> =>
  (await harness.prisma.book.findUnique({ where: { userId_id: { userId, id } } }))?.title ?? null;

describe('Mutation.bookUpdateMetadata', () => {
  it('updates the viewer’s own book and returns the updated Book', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { userId: harness.aliceGlobalId, bookId: BOOK_ID, title: 'New Title' },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookUpdateMetadata as { __typename: string; book: { title: string } };
    expect(data.__typename).toBe('BookUpdateMetadataPayload');
    expect(data.book.title).toBe('New Title');
  });

  it('leaves an unsent field untouched (only the sent field changes)', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Kept Title');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { userId: harness.aliceGlobalId, bookId: BOOK_ID, author: 'New Author' },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookUpdateMetadata as {
      book: { title: string; author: string };
    };
    expect(data.book.title).toBe('Kept Title');
    expect(data.book.author).toBe('New Author');
  });

  it('resolves to null when the book does not exist for the resolved owner', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { userId: harness.aliceGlobalId, bookId: 'no-such-book', title: 'X' },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookUpdateMetadata).toBeNull();
  });

  it('returns InvalidInputError for a malformed publishDate and changes nothing', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Untouched');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { userId: harness.aliceGlobalId, bookId: BOOK_ID, publishDate: 'not-a-date' },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookUpdateMetadata).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [
        { path: ['publishDate'], message: 'publishDate must be a valid ISO 8601 date string' },
      ],
    });
    expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Untouched');
  });

  it('accepts an empty publishDate (REST parity: blank clears the field, not rejected)', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'T');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { userId: harness.aliceGlobalId, bookId: BOOK_ID, publishDate: '  ' },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookUpdateMetadata as { __typename: string };
    expect(data.__typename).toBe('BookUpdateMetadataPayload');
  });

  it('refuses one user editing another user’s book, and leaves the row byte-unchanged', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Alice’s Title');

    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: {
        input: { userId: harness.aliceGlobalId, bookId: BOOK_ID, title: 'Hijacked' },
      },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.bookUpdateMetadata ?? null).toBeNull();
    expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Alice’s Title');
  });

  it('lets an admin edit a named user’s book (content assertion, not just no-error)', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Before Admin Edit');

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: { userId: harness.aliceGlobalId, bookId: BOOK_ID, title: 'After Admin Edit' },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookUpdateMetadata as { book: { bookId: string; title: string } };
    expect(data.book.title).toBe('After Admin Edit');
    // Content assertion of correct owner-scoping, not just "no error": the
    // rewritten EPUB's content hash changes with its content, so the edited
    // row now lives under a new id — re-read it under ALICE's userId
    // specifically (never the admin's, which has no library/userId at all)
    // to prove the write landed in her library, not lost or misfiled.
    expect(await titleOf(harness.aliceOwner.userId, data.book.bookId)).toBe('After Admin Edit');
  });

  it('returns EpubValidationError (with the book’s stored messages) and changes nothing when the book was never validated', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Never Validated', {
      valid: null,
    });

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { userId: harness.aliceGlobalId, bookId: BOOK_ID, title: 'Should Not Land' },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookUpdateMetadata as {
      __typename: string;
      messages: unknown[];
    };
    expect(data.__typename).toBe('EpubValidationError');
    expect(data.messages).toEqual([]);
    expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Never Validated');
  });

  it('returns EpubValidationError populated from the stored failure when the book already failed validation', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Failed Validation', {
      valid: false,
    });
    await harness.stores.validation.saveValidation(harness.aliceOwner, BOOK_ID, {
      valid: false,
      threshold: 'ERROR',
      messages: [{ id: 'RSC-005', severity: 'ERROR', message: 'broken reference' }],
      counts: { ...EMPTY_COUNTS, ERROR: 1 },
    });

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { userId: harness.aliceGlobalId, bookId: BOOK_ID, title: 'Should Not Land' },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookUpdateMetadata as {
      __typename: string;
      messages: { code: string }[];
    };
    expect(data.__typename).toBe('EpubValidationError');
    expect(data.messages).toEqual([
      { code: 'RSC-005', severity: 'ERROR', message: 'broken reference' },
    ]);
    expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Failed Validation');
  });

  it('returns BookHashCollisionError, owner-scoped to the target user, when the edited book’s new fingerprint collides', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Alice Book A');
    await seedEditableBook(harness, harness.aliceOwner, OTHER_BOOK_ID, 'Alice Book B');

    vi.spyOn(harness.stores.book, 'reimportBook').mockRejectedValueOnce(
      new BookHashCollisionError(OTHER_BOOK_ID)
    );

    // Admin-driven, deliberately: this is the exact shape of bug task 1's
    // ledger warns about (`BookHashCollisionError`'s owner re-derived from the
    // viewer instead of carried from the mutation) — an admin viewer has no
    // library of its own, so if the resolver ever re-derived owner from the
    // viewer instead of passing the real target owner through, resolving
    // `collidingBook` here would fail outright instead of quietly resolving
    // the wrong user's book.
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: { userId: harness.aliceGlobalId, bookId: BOOK_ID, title: 'Trigger Collision' },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookUpdateMetadata as {
      __typename: string;
      collidingBook: { bookId: string; title: string };
    };
    expect(data.__typename).toBe('BookHashCollisionError');
    expect(data.collidingBook).toEqual({ bookId: OTHER_BOOK_ID, title: 'Alice Book B' });
    expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Alice Book A');
  });

  it('returns EpubValidationError when the rewritten EPUB fails post-edit validation, leaving the book unchanged', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Still Valid Pre-Edit');
    (assertValidEpub as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new EpubValidationError(
        [{ id: 'RSC-005', severity: 'FATAL', message: 'unparseable' }],
        { ...EMPTY_COUNTS, FATAL: 1 },
        'ERROR'
      )
    );

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { userId: harness.aliceGlobalId, bookId: BOOK_ID, title: 'Should Not Land' },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookUpdateMetadata as {
      __typename: string;
      messages: { code: string }[];
    };
    expect(data.__typename).toBe('EpubValidationError');
    expect(data.messages).toEqual([{ code: 'RSC-005', severity: 'FATAL', message: 'unparseable' }]);
    expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Still Valid Pre-Edit');
  });

  it('refuses a User global ID that names no user', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: encodeGlobalID('User', 'no-such-user'),
          bookId: BOOK_ID,
          title: 'X',
        },
      },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });
});
