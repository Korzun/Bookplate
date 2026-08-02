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
  mutation Regen($input: UserRegenerateSyncPasswordInput!) {
    userRegenerateSyncPassword(input: $input) {
      __typename
      ... on UserRegenerateSyncPasswordPayload {
        user { username }
        syncPassword
      }
    }
  }
`;

describe('Mutation.userRegenerateSyncPassword', () => {
  it("regenerates the viewer's own sync password to a new value and persists it", async () => {
    const before = await harness.stores.user.getSyncPassword('alice');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { userId: harness.aliceGlobalId } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.userRegenerateSyncPassword).toMatchObject({ user: { username: 'alice' } });
    const payload = result.data?.userRegenerateSyncPassword as { syncPassword: string };
    const after = payload.syncPassword;
    expect(after).not.toBe(before);
    expect(await harness.stores.user.getSyncPassword('alice')).toBe(after);
  });

  it("refuses one user regenerating another user's sync password, target unchanged", async () => {
    const before = await harness.stores.user.getSyncPassword('alice');

    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: { input: { userId: harness.aliceGlobalId } },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(await harness.stores.user.getSyncPassword('alice')).toBe(before);
  });

  /**
   * Seen-to-fail: swapping the resolver's self-only boolean `authScopes` for
   * the naive `ownerOf` scope reproducibly turns THIS test red — an admin
   * has no `userId` of their own, so `ownerOf`'s admin branch lets it
   * through despite REST's flat 403 for an admin session
   * (`routes/ui.ts:451-454`); the test above (bob acting on alice) is denied
   * either way and so cannot discriminate the two scopes. Confirmed
   * experimentally (`AssertionError: expected undefined to be 'FORBIDDEN'`),
   * then reverted.
   */
  it("refuses the admin regenerating a named user's sync password (no REST admin-write path)", async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { userId: harness.aliceGlobalId } },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });

  it('refuses a mustChangePassword viewer — this mutation is NOT exempted, unlike userChangePassword', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: { ...harness.aliceViewer, mustChangePassword: true },
      variables: { input: { userId: harness.aliceGlobalId } },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });
});
