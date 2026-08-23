import { encodeGlobalID } from '@pothos/plugin-relay';

import { createHarness, type Harness } from '../../../test-util';
import { buildOwner } from './set';

vi.mock('../../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const MUTATION = `
  mutation Set($input: ProgressSetInput!) {
    progressSet(input: $input) {
      __typename
      ... on ProgressSetPayload {
        progress {
          document
          position
          percentage
          device
          deviceId
          currentChapter
        }
        library { user { username } }
      }
      ... on InvalidInputError {
        message
        issues { path message }
      }
    }
  }
`;

const rowFor = (userId: string, document: string) =>
  harness.prisma.progress.findUnique({ where: { userId_document: { userId, document } } });

// Chapters start at spine indices 0, 3, 6 — spine index 3 is chapter 2.
const SPINE_MAP = [0, 3, 6];

const seedBook = (userId: string, id: string, spineMap: number[]) =>
  harness.prisma.book.create({
    data: {
      userId,
      id,
      title: 'Chaptered',
      size: 1,
      mtime: 1,
      addedAt: 1,
      chapterSpineMap: JSON.stringify(spineMap),
    },
  });

describe('Mutation.progressSet', () => {
  it('creates a new progress row for the viewer and returns it, with currentChapter derived', async () => {
    await seedBook(harness.aliceOwner.userId, 'dune.epub', SPINE_MAP);

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          document: 'dune.epub',
          currentChapter: 2,
          percentage: 0.5,
          device: 'Kobo',
          deviceId: 'dev-1',
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.progressSet).toEqual({
      __typename: 'ProgressSetPayload',
      progress: {
        document: 'dune.epub',
        position: 'EPUB_CFI(/6/8!/4/2:0)',
        percentage: 0.5,
        device: 'Kobo',
        deviceId: 'dev-1',
        currentChapter: 2,
      },
      library: { user: { username: 'alice' } },
    });

    const row = await rowFor(harness.aliceOwner.userId, 'dune.epub');
    expect(row?.progress).toBe('EPUB_CFI(/6/8!/4/2:0)');
    expect(row?.percentage).toBe(0.5);
  });

  // I-2 (final whole-branch review): `User.progressCount` must move in the
  // SAME response that creates the row, so the client can normalize it onto
  // the already-cached `User:<id>` entity without a second round trip. Two
  // documents (not one) so this can't pass by coincidence of `progressCount`
  // defaulting to 1 either way.
  it('I-2: exposes the owning User with progressCount reflecting the just-written row', async () => {
    await seedBook(harness.aliceOwner.userId, 'dune.epub', SPINE_MAP);
    await seedBook(harness.aliceOwner.userId, 'foundation.epub', SPINE_MAP);

    const first = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          document: 'dune.epub',
          currentChapter: 1,
          percentage: 0.1,
        },
      },
    });
    expect(first.errors).toBeUndefined();

    const result = await harness.execute(
      `
        mutation Set($input: ProgressSetInput!) {
          progressSet(input: $input) {
            __typename
            ... on ProgressSetPayload {
              user { id progressCount }
            }
          }
        }
      `,
      {
        viewer: harness.aliceViewer,
        variables: {
          input: {
            userId: harness.aliceGlobalId,
            document: 'foundation.epub',
            currentChapter: 1,
            percentage: 0.1,
          },
        },
      }
    );

    expect(result.errors).toBeUndefined();
    expect(result.data?.progressSet).toEqual({
      __typename: 'ProgressSetPayload',
      user: { id: harness.aliceGlobalId, progressCount: 2 },
    });
  });

  it('upserts: a second call for the same document updates the existing row rather than erroring', async () => {
    const first = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          document: 'dune.epub',
          currentChapter: 1,
          percentage: 0.1,
        },
      },
    });
    expect(first.errors).toBeUndefined();

    const second = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          document: 'dune.epub',
          currentChapter: 1,
          percentage: 0.9,
        },
      },
    });

    expect(second.errors).toBeUndefined();
    expect(second.data?.progressSet).toMatchObject({
      __typename: 'ProgressSetPayload',
      progress: { percentage: 0.9 },
    });
    expect(
      await harness.prisma.progress.count({ where: { userId: harness.aliceOwner.userId } })
    ).toBe(1);
  });

  it('does not require the document to name a known book — an unknown document still saves, with an empty CFI', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          document: 'never-seen.epub',
          currentChapter: 4,
          percentage: 0.75,
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.progressSet).toMatchObject({
      __typename: 'ProgressSetPayload',
      progress: { document: 'never-seen.epub', position: '', currentChapter: null },
    });
  });

  /**
   * I-1 (task-5 review): the CFI-synthesis guard
   * (`book && book.chapterSpineMap.length > 0 && currentChapter <= length`)
   * was previously pinned only on its first clause (no book at all). This
   * pins the third clause: a KNOWN book whose spine map is shorter than the
   * requested chapter. REST (`routes/ui.ts:364-371`) leaves `progress` as
   * `''` in that case rather than indexing past the array — mirrored here.
   * Seen-to-fail: collapsing the guard to `if (book)` (the reviewer's
   * experiment) reproducibly turns this red, persisting the literal string
   * `EPUB_CFI(/6/NaN!/4/2:0)` instead — reverted after confirming.
   */
  it('writes an empty CFI when currentChapter is past a known book’s spine map', async () => {
    await seedBook(harness.aliceOwner.userId, 'dune.epub', SPINE_MAP); // length 3

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          document: 'dune.epub',
          currentChapter: 4, // one past SPINE_MAP.length
          percentage: 0.5,
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.progressSet).toMatchObject({
      __typename: 'ProgressSetPayload',
      progress: { document: 'dune.epub', position: '', currentChapter: null },
    });
    const row = await rowFor(harness.aliceOwner.userId, 'dune.epub');
    expect(row?.progress).toBe('');
  });

  /**
   * I-1's second, cheaper-to-add clause: a known book with an empty spine
   * map (`chapterSpineMap: []`) — `book.chapterSpineMap.length > 0` is the
   * guard clause this pins. Same REST fallback (`routes/ui.ts:365`): empty
   * CFI, no indexing attempted at all.
   */
  it('writes an empty CFI when a known book has no chapter spine map at all', async () => {
    await seedBook(harness.aliceOwner.userId, 'no-chapters.epub', []);

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          document: 'no-chapters.epub',
          currentChapter: 1,
          percentage: 0.5,
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.progressSet).toMatchObject({
      __typename: 'ProgressSetPayload',
      progress: { document: 'no-chapters.epub', position: '', currentChapter: null },
    });
  });

  // M-1 (task-5 review): the `device !== ''` half of the fallback was
  // previously untested — dropping that clause left all tests green.
  // REST (`routes/ui.ts:376`) treats an explicit empty string the same as a
  // missing/non-string device: both fall back to 'Web'.
  it('falls back to device "Web" when explicitly sent as an empty string', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          document: 'dune.epub',
          currentChapter: 1,
          percentage: 0.2,
          device: '',
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.progressSet).toMatchObject({
      progress: { device: 'Web' },
    });
  });

  it('falls back to device "Web" and deviceId "" when omitted, matching REST', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          document: 'dune.epub',
          currentChapter: 1,
          percentage: 0.2,
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.progressSet).toMatchObject({
      progress: { device: 'Web', deviceId: '' },
    });
  });

  it('returns InvalidInputError for percentage 0 (REST rejects <= 0) and writes nothing', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          document: 'dune.epub',
          currentChapter: 1,
          percentage: 0,
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.progressSet).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [{ path: ['percentage'], message: 'percentage must be greater than 0' }],
    });
    expect(await rowFor(harness.aliceOwner.userId, 'dune.epub')).toBeNull();
  });

  it('returns InvalidInputError for percentage above 1', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          document: 'dune.epub',
          currentChapter: 1,
          percentage: 1.01,
        },
      },
    });

    expect(result.data?.progressSet).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [{ path: ['percentage'], message: 'percentage must be at most 1' }],
    });
  });

  it('returns InvalidInputError for a non-positive currentChapter', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          document: 'dune.epub',
          currentChapter: 0,
          percentage: 0.5,
        },
      },
    });

    expect(result.data?.progressSet).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [{ path: ['currentChapter'], message: 'currentChapter must be at least 1' }],
    });
  });

  it('returns InvalidInputError for an empty document and writes nothing', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          document: '',
          currentChapter: 1,
          percentage: 0.5,
        },
      },
    });

    expect(result.data?.progressSet).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [{ path: ['document'], message: 'document must not be empty' }],
    });
    expect(
      await harness.prisma.progress.count({ where: { userId: harness.aliceOwner.userId } })
    ).toBe(0);
  });

  it('refuses one user setting another user’s progress, and leaves alice’s row untouched', async () => {
    await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          document: 'dune.epub',
          currentChapter: 1,
          percentage: 0.3,
        },
      },
    });

    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          document: 'dune.epub',
          currentChapter: 1,
          percentage: 0.9,
        },
      },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.progressSet ?? null).toBeNull();
    const row = await rowFor(harness.aliceOwner.userId, 'dune.epub');
    expect(row?.percentage).toBe(0.3);
  });

  /**
   * REST-verified divergence from `progressDelete`: `routes/users.ts` has no
   * `PUT`/`POST` route letting an admin write another user's progress (only
   * `GET .../progress` and `DELETE .../progress/:document`), unlike
   * `progressDelete`'s admin-capable `DELETE /api/users/:username/progress/
   * :document`. So — the viewer-only equivalent, not the CONTENTS assertion
   * `progressDelete`'s admin test makes — and seen-to-fail in both
   * directions: this failed red before the `ownerOf`→self-only scope fix
   * (the naive `ownerOf` scope would have let this through), and the "own
   * row" tests above prove the same mutation succeeds for a matching
   * self/userId pair.
   */
  it('refuses the admin setting a named user’s progress at all (no REST admin-write path exists)', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          document: 'dune.epub',
          currentChapter: 1,
          percentage: 0.5,
        },
      },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.progressSet ?? null).toBeNull();
    expect(await rowFor(harness.aliceOwner.userId, 'dune.epub')).toBeNull();
  });

  it('refuses a User global ID that names no user', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: encodeGlobalID('User', 'no-such-user'),
          document: 'dune.epub',
          currentChapter: 1,
          percentage: 0.5,
        },
      },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });
});

/**
 * M-4 (task-5 review): the resolver's owner construction pairs
 * `args.input.userId.id` with `context.viewer.username`, and — because every
 * `Library` field this payload's `library` reaches keys off `owner.userId`
 * alone (`library/model.ts`: `user`, `subjects`, `authors`, `book` all query
 * by `userId`) — no integration test through `MUTATION` above can catch a
 * wrong/hardcoded `username` half of that pair (verified: hardcoding
 * `username: 'wrong-user'` in the resolver left every test above green).
 * `buildOwner` is pinned directly instead, at the level where the pairing
 * actually happens.
 */
describe('buildOwner', () => {
  it('pairs the given userId with the given viewer’s username', () => {
    expect(buildOwner('user-123', { username: 'alice' })).toEqual({
      userId: 'user-123',
      username: 'alice',
    });
  });

  it('does not fall back to any fixed or default username', () => {
    expect(buildOwner('user-456', { username: 'bob' }).username).toBe('bob');
    expect(buildOwner('user-456', { username: 'bob' }).username).not.toBe('alice');
  });
});
