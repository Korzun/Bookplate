import { encodeGlobalID } from '@pothos/plugin-relay';
import type { MockedFunction } from 'vitest';

import { BookHashCollisionError } from '../../../../services/book-store';
import * as epubWriterModule from '../../../../services/epub-writer';
import { createHarness, type Harness } from '../../../test-util';
import { EMPTY_COUNTS, fixtureEpub, seedEditableBook } from './test-helpers';

vi.mock('../../../../logger');
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
vi.mock('../../../../utils/metadata-issues', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../utils/metadata-issues')>();
  return { ...actual, detectMetadataIssues: vi.fn(actual.detectMetadataIssues) };
});

import { assertValidEpub, EpubValidationError } from '../../../../services/epub-validator';
import { detectMetadataIssues } from '../../../../utils/metadata-issues';

const mockDetectMetadataIssues = detectMetadataIssues as MockedFunction<
  typeof detectMetadataIssues
>;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
  mockDetectMetadataIssues.mockReturnValue([]);
});

afterEach(async () => {
  await harness.cleanup();
  vi.clearAllMocks();
});

const BOOK_ID = 'a'.repeat(32);
const OTHER_BOOK_ID = 'b'.repeat(32);

const MUTATION = `
  mutation Replace($input: BookReplaceInput!) {
    bookReplace(input: $input) {
      __typename
      ... on BookReplacePayload {
        book { bookId title titleSort authorSort }
      }
      ... on EpubValidationError {
        message
        messages { code severity message }
      }
      ... on BookHashCollisionError {
        message
        collidingBook { bookId title }
      }
      ... on StagedUploadNotFoundError { message }
      ... on InvalidInputError { message issues { path message } }
    }
  }
`;

const titleOf = async (userId: string, id: string): Promise<string | null> =>
  (await harness.prisma.book.findUnique({ where: { userId_id: { userId, id } } }))?.title ?? null;

const stageFor = (owner: Harness['aliceOwner'], title: string): string =>
  harness.stores.replaceStaging.stage(fixtureEpub(title), owner.userId, `${title}.epub`);

describe('Mutation.bookReplace', () => {
  it('replaces the book with the staged upload, changes its id, and consumes the staged upload', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
    const stagedId = stageFor(harness.aliceOwner, 'New Title');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          bookId: BOOK_ID,
          stagedUploadId: stagedId,
          acceptedFixKeys: [],
        },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookReplace as {
      __typename: string;
      book: { bookId: string; title: string };
    };
    expect(data.__typename).toBe('BookReplacePayload');
    expect(data.book.title).toBe('New Title');
    expect(data.book.bookId).not.toBe(BOOK_ID);
    // Old id gone, new id present, under alice specifically.
    expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBeNull();
    expect(await titleOf(harness.aliceOwner.userId, data.book.bookId)).toBe('New Title');
    // Consumed — no longer resolvable.
    expect(harness.stores.replaceStaging.resolve(stagedId, harness.aliceOwner.userId)).toBeNull();
  });

  it('defaults to the viewer’s own library when userId is omitted', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
    const stagedId = stageFor(harness.aliceOwner, 'New Title');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { bookId: BOOK_ID, stagedUploadId: stagedId, acceptedFixKeys: [] },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookReplace as { __typename: string };
    expect(data.__typename).toBe('BookReplacePayload');
  });

  it('resolves to null when the book does not exist for the resolved owner', async () => {
    const stagedId = stageFor(harness.aliceOwner, 'New Title');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          bookId: 'no-such-book',
          stagedUploadId: stagedId,
          acceptedFixKeys: [],
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookReplace).toBeNull();
  });

  it('returns StagedUploadNotFoundError for an unknown stagedUploadId, and does not touch the book', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          bookId: BOOK_ID,
          stagedUploadId: 'no-such-id',
          acceptedFixKeys: [],
        },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookReplace as { __typename: string };
    expect(data.__typename).toBe('StagedUploadNotFoundError');
    expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Old Title');
  });

  it('returns InvalidInputError for an empty bookId', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          bookId: '',
          stagedUploadId: 'x',
          acceptedFixKeys: [],
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookReplace).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [{ path: ['bookId'], message: 'bookId must not be empty' }],
    });
  });

  it('returns InvalidInputError when an admin session omits userId', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: { bookId: BOOK_ID, stagedUploadId: 'whatever', acceptedFixKeys: [] },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookReplace).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [{ path: ['userId'], message: 'userId is required for admin sessions' }],
    });
  });

  it('applies auto-fixes and accepted proposals, and consumes the staged upload', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
    // With an author (unlike `stageFor`'s plain fixture): the author-sort fix
    // under test attaches `opf:file-as` to the `dc:creator` element itself
    // (`epub-writer.ts`'s `writeSortedField`), so an author-less candidate
    // would leave the write with no element to attach the sort key to.
    const stagedId = harness.stores.replaceStaging.stage(
      fixtureEpub('New Title', 'New Author'),
      harness.aliceOwner.userId,
      'candidate.epub'
    );
    mockDetectMetadataIssues.mockReturnValueOnce([
      {
        field: 'titleSort',
        kind: 'title-sort-missing',
        from: '',
        to: 'Test Title, The',
        changes: { titleSort: 'Test Title, The' },
        autoEligible: true,
      },
      {
        field: 'authorSort',
        kind: 'author-sort-missing',
        from: '',
        to: 'Guin, Ursula K. Le',
        changes: { authorSort: 'Guin, Ursula K. Le' },
        autoEligible: false,
      },
    ]);
    const acceptedKey = 'authorSort:author-sort-missing:';

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          bookId: BOOK_ID,
          stagedUploadId: stagedId,
          acceptedFixKeys: [acceptedKey],
        },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookReplace as {
      book: { titleSort: string; authorSort: string };
    };
    expect(data.book.titleSort).toBe('Test Title, The');
    expect(data.book.authorSort).toBe('Guin, Ursula K. Le');
  });

  it('leaves a proposal unapplied when its key is not in acceptedFixKeys', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
    const stagedId = stageFor(harness.aliceOwner, 'New Title');
    mockDetectMetadataIssues.mockReturnValueOnce([
      {
        field: 'authorSort',
        kind: 'author-sort-missing',
        from: '',
        to: 'Guin, Ursula K. Le',
        changes: { authorSort: 'Guin, Ursula K. Le' },
        autoEligible: false,
      },
    ]);

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          bookId: BOOK_ID,
          stagedUploadId: stagedId,
          acceptedFixKeys: [],
        },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookReplace as { book: { authorSort: string } };
    expect(data.book.authorSort).not.toBe('Guin, Ursula K. Le');
  });

  it('returns EpubValidationError, leaves the book unchanged, and does NOT consume the staged upload', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
    const stagedId = stageFor(harness.aliceOwner, 'Bad Candidate');
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
        input: {
          userId: harness.aliceGlobalId,
          bookId: BOOK_ID,
          stagedUploadId: stagedId,
          acceptedFixKeys: [],
        },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookReplace as { __typename: string; messages: { code: string }[] };
    expect(data.__typename).toBe('EpubValidationError');
    expect(data.messages).toEqual([{ code: 'RSC-005', severity: 'FATAL', message: 'unparseable' }]);
    expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Old Title');
    // NOT consumed — retryable without re-uploading.
    expect(
      harness.stores.replaceStaging.resolve(stagedId, harness.aliceOwner.userId)
    ).not.toBeNull();
  });

  it('returns BookHashCollisionError, leaves the book unchanged, and does NOT consume the staged upload', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Alice Book A');
    await seedEditableBook(harness, harness.aliceOwner, OTHER_BOOK_ID, 'Alice Book B');
    const stagedId = stageFor(harness.aliceOwner, 'Trigger Collision');
    vi.spyOn(harness.stores.book, 'reimportBook').mockRejectedValueOnce(
      new BookHashCollisionError(OTHER_BOOK_ID)
    );

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          bookId: BOOK_ID,
          stagedUploadId: stagedId,
          acceptedFixKeys: [],
        },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookReplace as {
      __typename: string;
      collidingBook: { bookId: string; title: string };
    };
    expect(data.__typename).toBe('BookHashCollisionError');
    expect(data.collidingBook).toEqual({ bookId: OTHER_BOOK_ID, title: 'Alice Book B' });
    expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Alice Book A');
    expect(
      harness.stores.replaceStaging.resolve(stagedId, harness.aliceOwner.userId)
    ).not.toBeNull();
  });

  it('falls through to the original staged bytes (no 500) when structural repair throws', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
    const stagedId = stageFor(harness.aliceOwner, 'Fixed Title');
    const repairSpy = vi
      .spyOn(epubWriterModule, 'repairPackageDocument')
      .mockImplementationOnce(() => {
        throw new Error('bad opf');
      });

    try {
      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: {
            userId: harness.aliceGlobalId,
            bookId: BOOK_ID,
            stagedUploadId: stagedId,
            acceptedFixKeys: [],
          },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookReplace as { __typename: string; book: { title: string } };
      expect(data.__typename).toBe('BookReplacePayload');
      expect(data.book.title).toBe('Fixed Title');
    } finally {
      repairSpy.mockRestore();
    }
  });

  it('refuses one user replacing another user’s book, and leaves both the row and staged upload unchanged', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Alice’s Title');
    const bobsStagedId = stageFor(harness.bobOwner, 'Bobs Candidate');

    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          bookId: BOOK_ID,
          stagedUploadId: bobsStagedId,
          acceptedFixKeys: [],
        },
      },
    });

    expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Alice’s Title');
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.bookReplace ?? null).toBeNull();
    // Bob's own stage was never even reached — untouched.
    expect(
      harness.stores.replaceStaging.resolve(bobsStagedId, harness.bobOwner.userId)
    ).not.toBeNull();
  });

  it('denies an admin session even when it correctly names the staging user’s own book — admin gets no staging bypass', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
    const aliceStagedId = stageFor(harness.aliceOwner, 'New Title');

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          bookId: BOOK_ID,
          stagedUploadId: aliceStagedId,
          acceptedFixKeys: [],
        },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookReplace as { __typename: string };
    expect(data.__typename).toBe('StagedUploadNotFoundError');
    expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Old Title');
    expect(
      harness.stores.replaceStaging.resolve(aliceStagedId, harness.aliceOwner.userId)
    ).not.toBeNull();
  });

  it('refuses a User global ID that names no user', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: encodeGlobalID('User', 'no-such-user'),
          bookId: BOOK_ID,
          stagedUploadId: 'whatever',
          acceptedFixKeys: [],
        },
      },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });
});
