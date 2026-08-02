import { encodeGlobalID } from '@pothos/plugin-relay';

import { createHarness, type Harness } from '../../../test-util';

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
