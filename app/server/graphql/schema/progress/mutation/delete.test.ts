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
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
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

  // I-2 (final whole-branch review): the ADMIN case is the one that matters
  // — `owner` here is the DECODED owner from the input id, not the caller,
  // so `user` must resolve to alice (whose progressCount just moved), never
  // the admin (who has no `User` row at all — resolving the caller would
  // throw `findUniqueOrThrow`, since a config-based admin has no matching
  // row, giving this a clean failure signal rather than a silently wrong
  // count).
  it('I-2: exposes the deleted row’s owner (not the admin caller) with the decremented progressCount', async () => {
    await seedProgress(harness.aliceOwner.userId, 'dune.epub');
    await seedProgress(harness.aliceOwner.userId, 'foundation.epub');

    const result = await harness.execute(
      `
        mutation Delete($input: ProgressDeleteInput!) {
          progressDelete(input: $input) {
            __typename
            ... on ProgressDeletePayload {
              user { id progressCount }
            }
          }
        }
      `,
      {
        viewer: harness.adminViewer,
        variables: { input: { id: progressId(harness.aliceOwner.userId, 'dune.epub') } },
      }
    );

    expect(result.errors).toBeUndefined();
    expect(result.data?.progressDelete).toEqual({
      __typename: 'ProgressDeletePayload',
      user: { id: harness.aliceGlobalId, progressCount: 1 },
    });
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

  // M-4 (final whole-branch review): the resolver's `owner === null` branch
  // (delete.ts:157-158) was reachable only through a well-formed `Progress`
  // id whose userId component names no real user, sent by an ADMIN —
  // `isOwnerOrAdmin` passes on the userId alone (an admin, unlike alice
  // above), so `authScopes` lets the resolver run, and `loadOwner` then
  // returns null for that made-up userId. The non-admin variant above never
  // reaches this branch at all (it 403s in authScopes first).
  it('resolves to null for an admin-supplied Progress id whose userId component names no user', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: { id: progressId('no-such-user', 'dune.epub') },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.progressDelete).toBeNull();
  });

  // The next three tests pin `decodeProgressId`'s three defensive branches
  // directly — review found all three were dead as far as the suite could
  // tell (deleting the typename check, removing the decodeGlobalID try/catch,
  // or turning the resolver's `parsed === null` guard into a throw each left
  // the file green). Fix-round-1 report has the seen-to-fail output for each.

  it('resolves to null for a well-formed Book global id, rather than mistaking its shape for a Progress id', async () => {
    // Deliberately a `Book`-typed id whose LOCAL part is otherwise a
    // well-formed `Progress` compound id (`[alice.userId, 'dune.epub']`) —
    // same technique `bookValidate.test.ts`'s wrong-type-id test uses for
    // `Series`. If `decodeProgressId`'s `typename !== 'Progress'` check were
    // ever deleted, this id would decode and authorize exactly like a real
    // Progress id, and an admin caller would actually delete alice's row.
    await seedProgress(harness.aliceOwner.userId, 'dune.epub');
    const wrongType = encodeGlobalID(
      'Book',
      JSON.stringify([harness.aliceOwner.userId, 'dune.epub'])
    );

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { id: wrongType } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.progressDelete).toBeNull();
    expect(await documentsOf(harness.aliceOwner.userId)).toEqual(['dune.epub']);
  });

  it('resolves to null for a malformed, non-base64 id from an admin, rather than throwing', async () => {
    // `decodeGlobalID` throws `PothosValidationError` on structurally invalid
    // input; `decodeProgressId`'s try/catch is what turns that into the same
    // "no such row" `null` a genuinely missing row gets. An admin's `ownerOf`
    // check passes regardless of the decoded userId, so this is the path
    // that actually reaches the resolver's own (separate) decode call.
    await seedProgress(harness.aliceOwner.userId, 'dune.epub');

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { id: 'not-a-global-id!!' } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.progressDelete).toBeNull();
    expect(await documentsOf(harness.aliceOwner.userId)).toEqual(['dune.epub']);
  });

  it('refuses a malformed, non-base64 id from a non-admin viewer with a clean FORBIDDEN, not an unhandled error', async () => {
    // Same malformed id as above, but from a non-admin: authScopes itself
    // must call decodeProgressId to compute the ownerOf scope, BEFORE the
    // resolver ever runs. If the try/catch were removed, this is the exact
    // shape of the regression the review flagged: a clean 403 turning into
    // an unhandled PothosValidationError (a 500) for any authenticated,
    // non-admin caller who sends hostile input.
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: 'not-a-global-id!!' } },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });
});

/**
 * M-3 (task-5-review, final whole-branch review): the `Progress` id
 * encode/decode is duplicated across `progress/model.ts` (encode),
 * `progress/mutation/delete.ts` (typename literal + encode/decode), and
 * independent copies of `encodeGlobalID('Progress', ...)` in both test
 * files — each side is pinned only against its OWN copy, so a coordinated
 * refactor of `model.ts` + `model.test.ts` could break `delete.ts` silently.
 * This does not extract a shared helper (deferred) — it pins the contract
 * end to end instead: take an id exactly as the API hands it back
 * (`progressSet`'s payload), never reconstructed with a local
 * `encodeGlobalID` call, and feed that exact string to `progressDelete`.
 */
describe('Progress id round trip: progressSet’s output feeds progressDelete', () => {
  const SET_MUTATION = `
    mutation Set($input: ProgressSetInput!) {
      progressSet(input: $input) {
        __typename
        ... on ProgressSetPayload {
          progress { id }
        }
      }
    }
  `;

  it('deletes by the id progressSet actually returned, and deletedId echoes that same id', async () => {
    const setResult = await harness.execute(SET_MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          document: 'round-trip.epub',
          currentChapter: 1,
          percentage: 0.5,
        },
      },
    });
    expect(setResult.errors).toBeUndefined();
    const setPayload = setResult.data?.progressSet as {
      __typename: string;
      progress: { id: string };
    };
    expect(setPayload.__typename).toBe('ProgressSetPayload');
    const idFromApi = setPayload.progress.id;

    const deleteResult = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { id: idFromApi } },
    });

    expect(deleteResult.errors).toBeUndefined();
    expect(deleteResult.data?.progressDelete).toEqual({
      __typename: 'ProgressDeletePayload',
      deletedId: idFromApi,
      library: { user: { username: 'alice' } },
    });
    expect(await documentsOf(harness.aliceOwner.userId)).toEqual([]);
  });
});
