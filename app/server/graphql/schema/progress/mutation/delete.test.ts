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
        deletedId
        library { user { username } }
      }
    }
  }
`;

const progressId = (userId: string, document: string): string =>
  encodeGlobalID('Progress', JSON.stringify([userId, document]));

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
  it('deletes the viewer’s own progress row and returns the deleted id', async () => {
    await seedProgress(harness.aliceOwner.userId, 'dune.epub');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: progressId(harness.aliceOwner.userId, 'dune.epub') } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.progressDelete).toEqual({
      __typename: 'ProgressDeletePayload',
      deletedId: progressId(harness.aliceOwner.userId, 'dune.epub'),
      library: { user: { username: 'alice' } },
    });
    expect(await documentsOf(harness.aliceOwner.userId)).toEqual([]);
  });

  it('resolves to null when no such progress row exists, mirroring REST’s 404', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: progressId(harness.aliceOwner.userId, 'never-read.epub') } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.progressDelete).toBeNull();
  });

  it('resolves to null for a well-formed id whose document component is empty, mirroring REST’s structural 404', async () => {
    // `document` is no longer a separate, directly-validated argument — it
    // rides inside the opaque id, so there is no `InvalidInputError` member
    // left to reach (traced-union-drop rule, same as `bookResolvePendingFix`
    // when its own last zod-validated field disappeared into a global ID).
    // An empty document component simply matches no row, exactly like REST's
    // `DELETE /api/my/progress/:document` can never structurally receive one
    // and mismatched documents already 404 the same way.
    await seedProgress(harness.aliceOwner.userId, 'dune.epub');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: progressId(harness.aliceOwner.userId, '') } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.progressDelete).toBeNull();
    expect(await documentsOf(harness.aliceOwner.userId)).toEqual(['dune.epub']);
  });

  it('refuses one user deleting another user’s progress, and leaves the row in place', async () => {
    await seedProgress(harness.aliceOwner.userId, 'dune.epub');

    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: { input: { id: progressId(harness.aliceOwner.userId, 'dune.epub') } },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.progressDelete ?? null).toBeNull();
    // Both halves matter: a mutation that 403s the caller but has already
    // written is still a breach.
    expect(await documentsOf(harness.aliceOwner.userId)).toEqual(['dune.epub']);
  });

  it('refuses a Progress id belonging to another tenant, indistinguishably from a missing row', async () => {
    await seedProgress(harness.bobOwner.userId, 'doc-1');
    const foreign = progressId(harness.bobOwner.userId, 'doc-1');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: foreign } },
    });

    // Same answer a nonexistent row gives — a probe must not learn that bob has this document.
    expect(result.data?.progressDelete ?? null).toBeNull();
    // Bob's row survives. There is no progress store — read Prisma directly,
    // as this test file already does for its other assertions.
    expect(
      await harness.prisma.progress.findFirst({
        where: { userId: harness.bobOwner.userId, document: 'doc-1' },
      })
    ).not.toBeNull();
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
      variables: { input: { id: progressId(harness.aliceOwner.userId, 'shared.epub') } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.progressDelete).toEqual({
      __typename: 'ProgressDeletePayload',
      deletedId: progressId(harness.aliceOwner.userId, 'shared.epub'),
      library: { user: { username: 'alice' } },
    });
    expect(await documentsOf(harness.aliceOwner.userId)).toEqual([]);
    expect(await documentsOf(harness.bobOwner.userId)).toEqual(['shared.epub']);
  });

  it('refuses a Progress id whose userId component names no user', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { id: progressId('no-such-user', 'dune.epub') },
      },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });
});
