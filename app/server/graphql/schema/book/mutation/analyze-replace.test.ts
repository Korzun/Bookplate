import { encodeGlobalID } from '@pothos/plugin-relay';
import type { MockedFunction } from 'vitest';

import { getStagingDir } from '../../../../services/book-paths';
import { ADMIN_STAGING_ID, createReplaceStaging } from '../../../../services/replace-staging';
import { createHarness, type Harness } from '../../../test-util';
import { stagedUploadNotFoundError } from '../../staged-upload-not-found-error/model';
import { fixtureEpub, seedEditableBook } from './test-helpers';

// The factory, not a hand-typed string literal — so this constant can never
// drift from what the resolver actually returns.
const UNKNOWN_STAGED_UPLOAD_MESSAGE = stagedUploadNotFoundError().message;

vi.mock('../../../../logger');
// assertValidEpub: pass by default — analyzeEpub's own epubcheck call, not
// under test here. Mirrors update-metadata.test.ts's identical mock.
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
// Wrap (not replace) the real implementation, same as ui.test.ts's mock of
// the same module — individual tests override with mockReturnValueOnce to
// force a specific proposal shape without affecting other tests.
vi.mock('../../../../utils/metadata-issues', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../utils/metadata-issues')>();
  return { ...actual, detectMetadataIssues: vi.fn(actual.detectMetadataIssues) };
});

import { assertValidEpub } from '../../../../services/epub-validator';
import { detectMetadataIssues } from '../../../../utils/metadata-issues';

const mockDetectMetadataIssues = detectMetadataIssues as MockedFunction<
  typeof detectMetadataIssues
>;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
  // The fixture EPUB's title-only metadata legitimately trips some of the
  // real detector's heuristics (e.g. missing author). Default to no
  // proposals/auto-fixes so the "clean analysis" tests aren't coupled to
  // those heuristics; individual tests override this with mockReturnValueOnce.
  mockDetectMetadataIssues.mockReturnValue([]);
  // The vi.mock() factory above only sets this default once, at module load;
  // vite.config.ts's `mockReset: true` wipes it before every test, so it
  // must be re-armed here on each run.
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

const MUTATION = `
  mutation AnalyzeReplace($input: BookAnalyzeReplaceInput!) {
    bookAnalyzeReplace(input: $input) {
      __typename
      ... on BookAnalyzeReplacePayload {
        valid
        messages { code severity message }
        autoFixes { field kind from to }
        proposals { field kind from to }
      }
      ... on StagedUploadNotFoundError { message }
      ... on InvalidInputError { message issues { path message } }
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

describe('Mutation.bookAnalyzeReplace', () => {
  it('analyzes a staged candidate for the viewer’s own book without consuming it or changing the book', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
    const stagedId = harness.replaceStaging.stage(
      fixtureEpub('New Candidate'),
      harness.aliceOwner.userId,
      'candidate.epub'
    );

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), stagedUploadId: stagedId },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookAnalyzeReplace as {
      __typename: string;
      valid: boolean;
      messages: unknown[];
      autoFixes: unknown[];
      proposals: unknown[];
    };
    expect(data.__typename).toBe('BookAnalyzeReplacePayload');
    expect(data.valid).toBe(true);
    expect(data.messages).toEqual([]);
    expect(data.autoFixes).toEqual([]);
    expect(data.proposals).toEqual([]);
    // Not consumed — the same id is still resolvable afterward.
    expect(harness.replaceStaging.resolve(stagedId, harness.aliceOwner.userId)).not.toBeNull();
    // Read-only — the target book's own row is untouched.
    expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Old Title');
  });

  it('surfaces a non-empty proposals array without modifying the book', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
    const stagedId = harness.replaceStaging.stage(
      fixtureEpub('New Candidate'),
      harness.aliceOwner.userId,
      'candidate.epub'
    );
    mockDetectMetadataIssues.mockReturnValueOnce([
      {
        field: 'subjects',
        kind: 'subjects-split',
        from: 'A & B',
        to: null,
        changes: {},
        autoEligible: false,
      },
    ]);

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), stagedUploadId: stagedId },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookAnalyzeReplace as {
      proposals: { kind: string }[];
    };
    expect(data.proposals).toHaveLength(1);
    expect(data.proposals[0]?.kind).toBe('subjects-split');
    expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Old Title');
  });

  it('resolves to null when the book does not exist for the resolved owner', async () => {
    const stagedId = harness.replaceStaging.stage(
      fixtureEpub('New Candidate'),
      harness.aliceOwner.userId,
      'candidate.epub'
    );

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          id: bookGlobalId(harness.aliceOwner.userId, 'no-such-book'),
          stagedUploadId: stagedId,
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookAnalyzeReplace).toBeNull();
  });

  it('returns StagedUploadNotFoundError for an unknown stagedUploadId', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
          stagedUploadId: 'no-such-id',
        },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookAnalyzeReplace as { __typename: string; message: string };
    expect(data.__typename).toBe('StagedUploadNotFoundError');
    expect(data.message).toBe(UNKNOWN_STAGED_UPLOAD_MESSAGE);
  });

  it('returns StagedUploadNotFoundError for an EXPIRED stagedUploadId, with the identical message unknown/foreign get', async () => {
    // Review finding I-1: TTL was previously enforced only inside sweep(),
    // which only runs from stage() — an expired id kept resolving. This test
    // is the GraphQL-level regression the reviewer flagged as missing (M-5),
    // now that replace-staging.ts's findOwned() is age-aware.
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
    let now = 0;
    const shortLivedStaging = createReplaceStaging({
      stagingDir: getStagingDir(harness.config.booksDir),
      ttlMs: 1000,
      now: () => now,
    });
    harness.replaceStaging = shortLivedStaging;
    const stagedId = shortLivedStaging.stage(
      fixtureEpub('Expired Candidate'),
      harness.aliceOwner.userId,
      'candidate.epub'
    );
    now = 999_999_999; // far past the TTL

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), stagedUploadId: stagedId },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookAnalyzeReplace as { __typename: string; message: string };
    expect(data.__typename).toBe('StagedUploadNotFoundError');
    // Same fixed, zero-argument message as the unknown-id case — the type
    // carries no other fields, so there is nothing else that could leak
    // "expired" specifically to the caller.
    expect(data.message).toBe(UNKNOWN_STAGED_UPLOAD_MESSAGE);
  });

  it('returns StagedUploadNotFoundError when the stagedUploadId belongs to a different user, and leaves it usable by its real owner', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
    const bobsStagedId = harness.replaceStaging.stage(
      fixtureEpub('Bobs Candidate'),
      harness.bobOwner.userId,
      'bob-candidate.epub'
    );

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
          stagedUploadId: bobsStagedId,
        },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookAnalyzeReplace as { __typename: string; message: string };
    expect(data.__typename).toBe('StagedUploadNotFoundError');
    expect(data.message).toBe(UNKNOWN_STAGED_UPLOAD_MESSAGE);
    // Bob's own stage was not disturbed by alice's denied attempt.
    expect(harness.replaceStaging.resolve(bobsStagedId, harness.bobOwner.userId)).not.toBeNull();
  });

  it('returns InvalidInputError for an empty stagedUploadId', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), stagedUploadId: '' },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookAnalyzeReplace).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [{ path: ['stagedUploadId'], message: 'stagedUploadId must not be empty' }],
    });
  });

  it('refuses one user analyzing against another user’s book, and leaves the row unchanged', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Alice’s Title');
    const bobsStagedId = harness.replaceStaging.stage(
      fixtureEpub('Bobs Candidate'),
      harness.bobOwner.userId,
      'candidate.epub'
    );

    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: {
        input: {
          id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
          stagedUploadId: bobsStagedId,
        },
      },
    });

    expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Alice’s Title');
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.bookAnalyzeReplace ?? null).toBeNull();
  });

  it('denies an admin session even when it correctly names the staging user’s own book — admin has its own staging bucket, not a bypass onto alice’s (Task 4)', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
    // A real, valid, alice-owned staged upload — proving the denial is about
    // WHO is asking (the admin session's own ADMIN_STAGING_ID identity,
    // distinct from alice's userId — see `stagingIdentityOf`), not about the
    // stagedUploadId being bogus.
    const aliceStagedId = harness.replaceStaging.stage(
      fixtureEpub('New Candidate'),
      harness.aliceOwner.userId,
      'candidate.epub'
    );

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: {
          id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
          stagedUploadId: aliceStagedId,
        },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookAnalyzeReplace as { __typename: string };
    expect(data.__typename).toBe('StagedUploadNotFoundError');
    // Alice's own staged upload is untouched by the admin's denied attempt.
    expect(harness.replaceStaging.resolve(aliceStagedId, harness.aliceOwner.userId)).not.toBeNull();
  });

  it('admin CAN analyze against its own admin-staged upload, targeting any user’s book (Task 4)', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
    const adminStagedId = harness.replaceStaging.stage(
      fixtureEpub('Admin Candidate', 'Admin Author'),
      ADMIN_STAGING_ID,
      'admin-candidate.epub'
    );

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: {
          id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
          stagedUploadId: adminStagedId,
        },
      },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookAnalyzeReplace as { __typename: string; valid: boolean };
    expect(data.__typename).toBe('BookAnalyzeReplacePayload');
    expect(data.valid).toBe(true);
    // Read-only (resolve, not consume) — still resolvable afterward.
    expect(harness.replaceStaging.resolve(adminStagedId, ADMIN_STAGING_ID)).not.toBeNull();
  });

  it('resolves to null for an admin when the encoded owner does not exist', async () => {
    // Covers `analyze-replace.ts`'s `if (owner === null) return null;` branch
    // — a well-formed Book gid whose decoded userId names no real user. Only
    // reachable past `authScopes` for an admin viewer — see `validate.test.
    // ts`'s identical case. Also restores, in the new input's terms, the
    // assertion the old separate-`userId`-field shape's "refuses a User
    // global ID that names no user" test used to carry.
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: { id: bookGlobalId('no-such-user', BOOK_ID), stagedUploadId: 'whatever' },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookAnalyzeReplace).toBeNull();
  });
});
