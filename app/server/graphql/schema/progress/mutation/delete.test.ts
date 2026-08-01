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
  mutation Delete($input: ProgressDeleteInput!) {
    progressDelete(input: $input) {
      __typename
      ... on ProgressDeletePayload {
        deletedDocument
        library { user { username } }
      }
      ... on InvalidInputError {
        message
        issues { path message }
      }
    }
  }
`;

const seedProgress = (userId: string, document: string): Promise<unknown> =>
  harness.prisma.progress.create({
    data: {
      userId,
      document,
      progress: 'EPUB_CFI(/6/4!/4/2:0)',
      percentage: 0.5,
      device: 'Web',
      deviceId: 'dev-1',
      timestamp: 1_700_000_000,
    },
  });

const documentsOf = async (userId: string): Promise<string[]> =>
  (await harness.prisma.progress.findMany({ where: { userId }, orderBy: { document: 'asc' } })).map(
    (row) => row.document
  );

describe('Mutation.progressDelete', () => {
  it('deletes the viewer’s own progress row and returns the deleted document', async () => {
    await seedProgress(harness.aliceOwner.userId, 'dune.epub');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { userId: harness.aliceGlobalId, document: 'dune.epub' } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.progressDelete).toEqual({
      __typename: 'ProgressDeletePayload',
      deletedDocument: 'dune.epub',
      library: { user: { username: 'alice' } },
    });
    expect(await documentsOf(harness.aliceOwner.userId)).toEqual([]);
  });

  it('resolves to null when no such progress row exists, mirroring REST’s 404', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { userId: harness.aliceGlobalId, document: 'never-read.epub' } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.progressDelete).toBeNull();
  });

  it('returns InvalidInputError for an empty document and deletes nothing', async () => {
    await seedProgress(harness.aliceOwner.userId, 'dune.epub');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { userId: harness.aliceGlobalId, document: '' } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.progressDelete).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [{ path: ['document'], message: 'document must not be empty' }],
    });
    expect(await documentsOf(harness.aliceOwner.userId)).toEqual(['dune.epub']);
  });

  it('refuses one user deleting another user’s progress, and leaves the row in place', async () => {
    await seedProgress(harness.aliceOwner.userId, 'dune.epub');

    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: { input: { userId: harness.aliceGlobalId, document: 'dune.epub' } },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.progressDelete ?? null).toBeNull();
    // Both halves matter: a mutation that 403s the caller but has already
    // written is still a breach.
    expect(await documentsOf(harness.aliceOwner.userId)).toEqual(['dune.epub']);
  });

  it('lets an admin delete a named user’s row without touching an identically-named row of another user', async () => {
    // REST parity: `DELETE /api/users/:username/progress/:document` is
    // admin-only and clears any user's progress. The two users share a
    // document id on purpose — document ids are book content hashes, so two
    // users routinely hold the same one, and an owner-derivation bug shows up
    // as the wrong user's row disappearing rather than as a count changing.
    await seedProgress(harness.aliceOwner.userId, 'shared.epub');
    await seedProgress(harness.bobOwner.userId, 'shared.epub');

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { userId: harness.aliceGlobalId, document: 'shared.epub' } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.progressDelete).toEqual({
      __typename: 'ProgressDeletePayload',
      deletedDocument: 'shared.epub',
      library: { user: { username: 'alice' } },
    });
    expect(await documentsOf(harness.aliceOwner.userId)).toEqual([]);
    expect(await documentsOf(harness.bobOwner.userId)).toEqual(['shared.epub']);
  });

  it('refuses a User global ID that names no user', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { userId: encodeGlobalID('User', 'no-such-user'), document: 'dune.epub' },
      },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });
});
