import { encodeGlobalID } from '@pothos/plugin-relay';

import { BookHashCollisionError } from '../../../../services/book-errors';
import { ADMIN_STAGING_ID, createReplaceStaging } from '../../../../services/replace-staging';
import { saveValidation } from '../../../../services/validation';
import { createHarness, type Harness } from '../../../test-util';
import { stagedUploadNotFoundError } from '../../staged-upload-not-found-error/model';
import { EMPTY_COUNTS, rawBookId, seedEditableBook } from './test-helpers';

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
  // The vi.mock() factory above only sets this default once, at module load;
  // vite.config.ts's `mockReset: true` wipes it before every test, so it
  // must be re-armed here on each run (individual tests still override with
  // mockRejectedValueOnce as before).
  vi.mocked(assertValidEpub).mockResolvedValue({
    valid: true,
    messages: [],
    counts: { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 },
  });
});

afterEach(async () => {
  await harness.cleanup();
  vi.clearAllMocks();
});

const BOOK_ID = 'a'.repeat(32);
const OTHER_BOOK_ID = 'b'.repeat(32);

// The factory, not a hand-typed string literal — so this constant can never
// drift from what the resolver actually returns (matches replace.test.ts's
// identical pattern).
const UNKNOWN_STAGED_UPLOAD_MESSAGE = stagedUploadNotFoundError().message;

const MUTATION = `
  mutation Update($input: BookUpdateMetadataInput!) {
    bookUpdateMetadata(input: $input) {
      __typename
      ... on BookUpdateMetadataPayload {
        book { id title author publishDate }
      }
      ... on InvalidInputError {
        message
        issues { path message }
      }
      ... on BookHashCollisionError {
        message
        collidingBook { id title }
      }
      ... on BookNotValidatedError {
        message
        validation { valid messages(first: 10) { edges { node { code severity message } } } }
      }
      ... on EpubValidationError {
        message
        messages { code severity message }
      }
      ... on StagedUploadNotFoundError { message }
    }
  }
`;

const titleOf = async (userId: string, id: string): Promise<string | null> =>
  (await harness.prisma.book.findUnique({ where: { userId_id: { userId, id } } }))?.title ?? null;

// Computed the same way the resolver decodes it — the independent check that
// the input `id` is a real, dereferenceable `Book` global ID, not a hand-rolled
// string (mirrors `delete.test.ts`'s `bookGlobalId`).
const bookGlobalId = (userId: string, id: string): string =>
  encodeGlobalID('Book', JSON.stringify([userId, id]));

describe('Mutation.bookUpdateMetadata', () => {
  it('updates the viewer’s own book and returns the updated Book', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), title: 'New Title' },
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
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), author: 'New Author' },
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
        input: { id: bookGlobalId(harness.aliceOwner.userId, 'no-such-book'), title: 'X' },
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
        input: {
          id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
          publishDate: 'not-a-date',
        },
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
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), publishDate: '  ' },
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
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), title: 'Hijacked' },
      },
    });

    // Victim-row assertion first (review Minor-9): a probe that merely
    // weakens the auth guard stops at the first failing assertion, so this
    // must run before the error-code check or the "byte-unchanged" half of
    // this test's name would never actually execute under that probe.
    expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Alice’s Title');
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.bookUpdateMetadata ?? null).toBeNull();
  });

  it('lets an admin edit a named user’s book (content assertion, not just no-error)', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Before Admin Edit');

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: {
          id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
          title: 'After Admin Edit',
        },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookUpdateMetadata as { book: { id: string; title: string } };
    expect(data.book.title).toBe('After Admin Edit');
    // Content assertion of correct owner-scoping, not just "no error": the
    // rewritten EPUB's content hash changes with its content, so the edited
    // row now lives under a new id — re-read it under ALICE's userId
    // specifically (never the admin's, which has no library/userId at all)
    // to prove the write landed in her library, not lost or misfiled. Decoded
    // via `rawBookId`, not a same-object `bookId` field (removed): the
    // response's own id is what identifies the post-edit row.
    expect(await titleOf(harness.aliceOwner.userId, rawBookId(data.book.id))).toBe(
      'After Admin Edit'
    );
  });

  it('returns BookNotValidatedError with a null validation and changes nothing when the book was never validated', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Never Validated', {
      valid: null,
    });

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
          title: 'Should Not Land',
        },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookUpdateMetadata as {
      __typename: string;
      validation: unknown;
    };
    // Distinguishes "never validated" from "failed validation" (review
    // Important-2): a null `validation` says truthfully that no validation
    // has ever run — not a fabricated "failed" outcome with no findings.
    expect(data.__typename).toBe('BookNotValidatedError');
    expect(data.validation).toBeNull();
    expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Never Validated');
  });

  it('returns BookNotValidatedError populated with the stored failure when the book already failed validation', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Failed Validation', {
      valid: false,
    });
    await saveValidation(harness.prisma, harness.aliceOwner, BOOK_ID, {
      valid: false,
      threshold: 'ERROR',
      messages: [{ id: 'RSC-005', severity: 'ERROR', message: 'broken reference' }],
      counts: { ...EMPTY_COUNTS, ERROR: 1 },
    });

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
          title: 'Should Not Land',
        },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookUpdateMetadata as {
      __typename: string;
      validation: { valid: boolean; messages: { edges: { node: { code: string } }[] } };
    };
    expect(data.__typename).toBe('BookNotValidatedError');
    expect(data.validation.valid).toBe(false);
    expect(data.validation.messages.edges).toEqual([
      { node: { code: 'RSC-005', severity: 'ERROR', message: 'broken reference' } },
    ]);
    expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Failed Validation');
  });

  it('BookNotValidatedError and post-edit EpubValidationError are distinct typenames (REST’s 409 vs 422)', async () => {
    // Same mutation, same title, two different pre-conditions — proves the
    // union does not collapse REST's two distinct failure responses into one
    // indistinguishable member (review Important-2's core complaint about the
    // original `EpubValidationError` reuse).
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Never Validated', {
      valid: null,
    });
    await seedEditableBook(harness, harness.aliceOwner, OTHER_BOOK_ID, 'Post-Edit Failure');
    (assertValidEpub as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new EpubValidationError(
        [{ id: 'RSC-005', severity: 'FATAL', message: 'unparseable' }],
        { ...EMPTY_COUNTS, FATAL: 1 },
        'ERROR'
      )
    );

    const preEdit = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), title: 'X' },
      },
    });
    const postEdit = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { id: bookGlobalId(harness.aliceOwner.userId, OTHER_BOOK_ID), title: 'Y' },
      },
    });

    expect((preEdit.data?.bookUpdateMetadata as { __typename: string } | null)?.__typename).toBe(
      'BookNotValidatedError'
    );
    expect((postEdit.data?.bookUpdateMetadata as { __typename: string } | null)?.__typename).toBe(
      'EpubValidationError'
    );
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
        input: {
          id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
          title: 'Trigger Collision',
        },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookUpdateMetadata as {
      __typename: string;
      collidingBook: { id: string; title: string };
    };
    expect(data.__typename).toBe('BookHashCollisionError');
    // The colliding book is an existing, untouched row, so its id is exactly
    // the raw `OTHER_BOOK_ID` it was seeded under.
    expect(data.collidingBook).toEqual({
      id: bookGlobalId(harness.aliceOwner.userId, OTHER_BOOK_ID),
      title: 'Alice Book B',
    });
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
        input: {
          id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
          title: 'Should Not Land',
        },
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

  it('resolves to null for an admin when the encoded owner does not exist', async () => {
    // Covers `update-metadata.ts`'s `if (owner === null) return null;` branch
    // — a well-formed Book gid whose decoded userId names no real user. Only
    // reachable past `authScopes` for an admin viewer (a non-admin fails
    // `ownerOf` first) — see `validate.test.ts`'s identical case. Also
    // restores, in the new input's terms, the assertion the old separate-
    // `userId`-field shape's "refuses a User global ID that names no user"
    // test used to carry.
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: { id: bookGlobalId('no-such-user', BOOK_ID), title: 'X' },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookUpdateMetadata).toBeNull();
  });

  describe('stagedCoverId (Task 3b)', () => {
    const stageCover = (
      owner: Harness['aliceOwner'],
      bytes: Buffer,
      name = 'cover.png',
      mime = 'image/png'
    ): string => harness.stores.replaceStaging.stage(bytes, owner.userId, name, 'cover', mime);

    it('applies the staged cover: the stored cover BYTES actually change, and metadata lands in the same call', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
      const coverBytes = Buffer.from('brand-new-cover-bytes');
      const stagedCoverId = stageCover(harness.aliceOwner, coverBytes);

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: {
            id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
            title: 'New Title',
            stagedCoverId,
          },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookUpdateMetadata as {
        __typename: string;
        book: { id: string; title: string };
      };
      expect(data.__typename).toBe('BookUpdateMetadataPayload');
      expect(data.book.title).toBe('New Title');
      const cover = await harness.stores.book.getCover(
        harness.aliceOwner.userId,
        rawBookId(data.book.id)
      );
      expect(cover).not.toBeNull();
      expect(Buffer.from(cover!.data)).toEqual(coverBytes);
      expect(cover!.mime).toBe('image/png');
      // Consumed on success — no longer resolvable.
      expect(
        harness.stores.replaceStaging.resolve(stagedCoverId, harness.aliceOwner.userId, 'cover')
      ).toBeNull();
    });

    it('applies a staged cover with no metadata fields at all (cover-only edit)', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Kept Title');
      const coverBytes = Buffer.from('cover-only-bytes');
      const stagedCoverId = stageCover(harness.aliceOwner, coverBytes);

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), stagedCoverId },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookUpdateMetadata as {
        __typename: string;
        book: { id: string; title: string };
      };
      expect(data.__typename).toBe('BookUpdateMetadataPayload');
      expect(data.book.title).toBe('Kept Title');
      const cover = await harness.stores.book.getCover(
        harness.aliceOwner.userId,
        rawBookId(data.book.id)
      );
      expect(Buffer.from(cover!.data)).toEqual(coverBytes);
    });

    it('returns StagedUploadNotFoundError for an unknown stagedCoverId, and applies NEITHER the metadata NOR any cover (REST’s atomic single-write semantics)', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Untouched Title');

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: {
            id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
            title: 'Should Not Land',
            stagedCoverId: 'no-such-id',
          },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookUpdateMetadata as { __typename: string; message: string };
      expect(data.__typename).toBe('StagedUploadNotFoundError');
      expect(data.message).toBe(UNKNOWN_STAGED_UPLOAD_MESSAGE);
      // Neither the title NOR a cover landed — applyEpubChanges never ran.
      expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Untouched Title');
      expect(await harness.stores.book.getCover(harness.aliceOwner.userId, BOOK_ID)).toBeNull();
    });

    it('returns StagedUploadNotFoundError for an EXPIRED stagedCoverId, with the identical message unknown/foreign get, and applies nothing', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Untouched Title');
      let now = 0;
      const shortLivedStaging = createReplaceStaging({
        stagingDir: harness.stores.book.getStagingDir(),
        ttlMs: 1000,
        now: () => now,
      });
      harness.stores.replaceStaging = shortLivedStaging;
      const stagedCoverId = shortLivedStaging.stage(
        Buffer.from('expired-cover'),
        harness.aliceOwner.userId,
        'cover.png',
        'cover',
        'image/png'
      );
      now = 999_999_999; // far past the TTL

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: {
            id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
            title: 'Should Not Land',
            stagedCoverId,
          },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookUpdateMetadata as { __typename: string; message: string };
      expect(data.__typename).toBe('StagedUploadNotFoundError');
      expect(data.message).toBe(UNKNOWN_STAGED_UPLOAD_MESSAGE);
      expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Untouched Title');
    });

    it('cross-tenant: bob’s staged cover used against alice’s own book is denied, and alice’s book/cover are unchanged', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Alice’s Title');
      const bobsStagedCoverId = stageCover(harness.bobOwner, Buffer.from('bobs-cover'));

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: {
            id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
            title: 'Hijacked Via Cover',
            stagedCoverId: bobsStagedCoverId,
          },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookUpdateMetadata as { __typename: string; message: string };
      expect(data.__typename).toBe('StagedUploadNotFoundError');
      expect(data.message).toBe(UNKNOWN_STAGED_UPLOAD_MESSAGE);
      expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Alice’s Title');
      expect(await harness.stores.book.getCover(harness.aliceOwner.userId, BOOK_ID)).toBeNull();
      // Bob's own stage was never even reached — untouched.
      expect(
        harness.stores.replaceStaging.resolve(bobsStagedCoverId, harness.bobOwner.userId, 'cover')
      ).not.toBeNull();
    });

    it('kind-mismatch: a stagedUploadId staged as an EPUB (bookReplace’s flow) is rejected as stagedCoverId, indistinguishably from unknown', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Untouched Title');
      // Staged via the EPUB path (default kind), NOT the cover path.
      const epubStagedId = harness.stores.replaceStaging.stage(
        Buffer.from('not-a-cover-its-an-epub'),
        harness.aliceOwner.userId,
        'candidate.epub'
      );

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: {
            id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
            title: 'Should Not Land',
            stagedCoverId: epubStagedId,
          },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookUpdateMetadata as { __typename: string; message: string };
      expect(data.__typename).toBe('StagedUploadNotFoundError');
      expect(data.message).toBe(UNKNOWN_STAGED_UPLOAD_MESSAGE);
      expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Untouched Title');
      // The EPUB-kind entry itself is untouched — still resolvable under its
      // real kind, proving the denial was about kind, not that the id burned.
      expect(
        harness.stores.replaceStaging.resolve(epubStagedId, harness.aliceOwner.userId, 'epub')
      ).not.toBeNull();
    });

    it('does NOT consume the staged cover when the write fails post-edit validation (retryable without re-uploading)', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
      const stagedCoverId = stageCover(harness.aliceOwner, Buffer.from('cover-bytes'));
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
            id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
            title: 'Should Not Land',
            stagedCoverId,
          },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookUpdateMetadata as { __typename: string };
      expect(data.__typename).toBe('EpubValidationError');
      // Neither metadata nor cover landed — same single atomic write REST uses.
      expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Old Title');
      expect(await harness.stores.book.getCover(harness.aliceOwner.userId, BOOK_ID)).toBeNull();
      // NOT consumed — retryable without re-uploading the image.
      expect(
        harness.stores.replaceStaging.resolve(stagedCoverId, harness.aliceOwner.userId, 'cover')
      ).not.toBeNull();
    });

    it('metadata-only calls (no stagedCoverId) are unaffected — regression check', async () => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');

      const result = await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: {
          input: {
            id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
            title: 'New Title Only',
          },
        },
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookUpdateMetadata as {
        __typename: string;
        book: { id: string; title: string };
      };
      expect(data.__typename).toBe('BookUpdateMetadataPayload');
      expect(data.book.title).toBe('New Title Only');
      expect(
        await harness.stores.book.getCover(harness.aliceOwner.userId, rawBookId(data.book.id))
      ).toBeNull();
    });

    // Review I-1: REST pins this side effect both ways (`ui.test.ts:2858`
    // "does not enqueue thumbnails when no cover is uploaded", `:2868`
    // "enqueues thumbnails when a new cover is uploaded") — this mutation's
    // own thumbnail-enqueue call (`update-metadata.ts`, cover-success branch)
    // had zero coverage before this fix. `harness.stores.thumbnail` is a
    // real, never-started `ThumbnailQueue` (`test-util.ts`'s doc comment),
    // so `enqueue` is inert and safe to spy on directly.
    describe('thumbnail enqueue on cover success (review I-1)', () => {
      it('enqueues thumbnail regeneration with (owner.userId, the NEW post-edit book id) — REST parity for ui.test.ts:2868', async () => {
        await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
        const stagedCoverId = stageCover(harness.aliceOwner, Buffer.from('cover-bytes'));
        const enqueueSpy = vi.spyOn(harness.stores.thumbnail, 'enqueue');

        const result = await harness.execute(MUTATION, {
          viewer: harness.aliceViewer,
          variables: {
            input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), stagedCoverId },
          },
        });

        expect(result.errors).toBeUndefined();
        const data = result.data?.bookUpdateMetadata as { book: { id: string } };
        expect(enqueueSpy).toHaveBeenCalledTimes(1);
        expect(enqueueSpy).toHaveBeenCalledWith(harness.aliceOwner.userId, rawBookId(data.book.id));
      });

      it('does NOT enqueue on a metadata-only edit (no stagedCoverId) — REST parity for ui.test.ts:2858', async () => {
        await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
        const enqueueSpy = vi.spyOn(harness.stores.thumbnail, 'enqueue');

        const result = await harness.execute(MUTATION, {
          viewer: harness.aliceViewer,
          variables: {
            input: {
              id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
              title: 'New Title',
            },
          },
        });

        expect(result.errors).toBeUndefined();
        expect(enqueueSpy).not.toHaveBeenCalled();
      });

      it('does NOT enqueue when the staged-cover write fails post-edit validation (nothing was actually applied)', async () => {
        await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
        const stagedCoverId = stageCover(harness.aliceOwner, Buffer.from('cover-bytes'));
        const enqueueSpy = vi.spyOn(harness.stores.thumbnail, 'enqueue');
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
            input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), stagedCoverId },
          },
        });

        expect(result.errors).toBeUndefined();
        const data = result.data?.bookUpdateMetadata as { __typename: string };
        expect(data.__typename).toBe('EpubValidationError');
        expect(enqueueSpy).not.toHaveBeenCalled();
      });

      it('does NOT enqueue when stagedCoverId is unknown (rejected before any write)', async () => {
        await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
        const enqueueSpy = vi.spyOn(harness.stores.thumbnail, 'enqueue');

        const result = await harness.execute(MUTATION, {
          viewer: harness.aliceViewer,
          variables: {
            input: {
              id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
              stagedCoverId: 'no-such-id',
            },
          },
        });

        expect(result.errors).toBeUndefined();
        const data = result.data?.bookUpdateMetadata as { __typename: string };
        expect(data.__typename).toBe('StagedUploadNotFoundError');
        expect(enqueueSpy).not.toHaveBeenCalled();
      });
    });

    describe('admin staging identity (Task 4)', () => {
      const stageCoverAs = (identity: string, bytes: Buffer, mime = 'image/png'): string =>
        harness.stores.replaceStaging.stage(bytes, identity, 'cover.png', 'cover', mime);

      // The end-to-end that was impossible before Task 4: a config admin
      // (no library/userId of its own) stages a cover, then applies it to a
      // NAMED user's book via `id` — proving the cover's BYTES actually
      // change on ALICE's row, not merely that the mutation returned
      // success. Seen-to-fail: reverting `stagingIdentityOf`'s admin branch
      // to `context.viewer.userId` (always null for admin) turns this red —
      // `StagedUploadNotFoundError`, no bytes touched — the exact gap spec
      // 1's admin-replace decision gate recorded as open.
      it('admin stages a cover, then applies it to ALICE’s book via bookUpdateMetadata — alice’s cover bytes change', async () => {
        await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Alice’s Title');
        const coverBytes = Buffer.from('admin-supplied-cover-bytes');
        const stagedCoverId = stageCoverAs(ADMIN_STAGING_ID, coverBytes);

        const result = await harness.execute(MUTATION, {
          viewer: harness.adminViewer,
          variables: {
            input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), stagedCoverId },
          },
        });

        expect(result.errors).toBeUndefined();
        const data = result.data?.bookUpdateMetadata as {
          __typename: string;
          book: { id: string; title: string };
        };
        expect(data.__typename).toBe('BookUpdateMetadataPayload');
        expect(data.book.title).toBe('Alice’s Title'); // unchanged — cover-only edit
        const cover = await harness.stores.book.getCover(
          harness.aliceOwner.userId,
          rawBookId(data.book.id)
        );
        expect(cover).not.toBeNull();
        expect(Buffer.from(cover!.data)).toEqual(coverBytes);
        // Consumed on success, same as any other caller's staged cover.
        expect(
          harness.stores.replaceStaging.resolve(stagedCoverId, ADMIN_STAGING_ID, 'cover')
        ).toBeNull();
      });

      it('alice cannot consume an admin-staged cover, even against her own book', async () => {
        await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Alice’s Title');
        const adminStagedCoverId = stageCoverAs(ADMIN_STAGING_ID, Buffer.from('admins-cover'));

        const result = await harness.execute(MUTATION, {
          viewer: harness.aliceViewer,
          variables: {
            input: {
              id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
              stagedCoverId: adminStagedCoverId,
            },
          },
        });

        expect(result.errors).toBeUndefined();
        const data = result.data?.bookUpdateMetadata as { __typename: string; message: string };
        expect(data.__typename).toBe('StagedUploadNotFoundError');
        expect(data.message).toBe(UNKNOWN_STAGED_UPLOAD_MESSAGE);
        expect(await harness.stores.book.getCover(harness.aliceOwner.userId, BOOK_ID)).toBeNull();
        // The admin's own stage was never even reached — untouched.
        expect(
          harness.stores.replaceStaging.resolve(adminStagedCoverId, ADMIN_STAGING_ID, 'cover')
        ).not.toBeNull();
      });
    });
  });
});
