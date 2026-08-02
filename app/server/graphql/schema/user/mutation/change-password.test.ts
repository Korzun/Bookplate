import type { Viewer } from '../../../context';
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
  mutation ChangePassword($input: UserChangePasswordInput!) {
    userChangePassword(input: $input) {
      __typename
      ... on UserChangePasswordPayload {
        user { username mustChangePassword }
      }
      ... on InvalidInputError {
        message
        issues { path message }
      }
      ... on IncorrectPasswordError {
        message
      }
    }
  }
`;

const REGEN_SYNC_MUTATION = `
  mutation Regen($input: UserRegenerateSyncPasswordInput!) {
    userRegenerateSyncPassword(input: $input) { syncPassword }
  }
`;

describe('Mutation.userChangePassword', () => {
  it("changes the viewer's own password given the correct current password", async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          currentPassword: 'alicepass',
          newPassword: 'newpass123',
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.userChangePassword).toEqual({
      __typename: 'UserChangePasswordPayload',
      user: { username: 'alice', mustChangePassword: false },
    });
    expect(await harness.stores.user.validateUser('alice', 'newpass123')).toBe(
      harness.aliceOwner.userId
    );
    expect(await harness.stores.user.validateUser('alice', 'alicepass')).toBe(false);
  });

  it('revokes outstanding refresh tokens on a successful change', async () => {
    const refreshToken = await harness.stores.token.createRefreshToken({
      username: 'alice',
      userId: harness.aliceOwner.userId,
    });

    await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          currentPassword: 'alicepass',
          newPassword: 'newpass123',
        },
      },
    });

    expect(await harness.stores.token.consumeRefreshToken(refreshToken)).toBeNull();
  });

  it("returns IncorrectPasswordError for a wrong current password, and leaves alice's password unchanged", async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          currentPassword: 'wrong-password',
          newPassword: 'newpass123',
        },
      },
    });

    expect(result.data?.userChangePassword).toEqual({
      __typename: 'IncorrectPasswordError',
      message: 'Current password is incorrect',
    });
    expect(await harness.stores.user.validateUser('alice', 'alicepass')).toBe(
      harness.aliceOwner.userId
    );
  });

  it('returns InvalidInputError for an empty newPassword and leaves the password unchanged', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { userId: harness.aliceGlobalId, currentPassword: 'alicepass', newPassword: '' },
      },
    });

    expect(result.data?.userChangePassword).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [{ path: ['newPassword'], message: 'Current and new password are required' }],
    });
    expect(await harness.stores.user.validateUser('alice', 'alicepass')).toBe(
      harness.aliceOwner.userId
    );
  });

  it('returns InvalidInputError for an empty currentPassword', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: { userId: harness.aliceGlobalId, currentPassword: '', newPassword: 'newpass123' },
      },
    });

    expect(result.data?.userChangePassword).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [{ path: ['currentPassword'], message: 'Current and new password are required' }],
    });
  });

  it("refuses one user changing another user's password, target unchanged", async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          currentPassword: 'alicepass',
          newPassword: 'newpass123',
        },
      },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(await harness.stores.user.validateUser('alice', 'alicepass')).toBe(
      harness.aliceOwner.userId
    );
  });

  /**
   * Seen-to-fail: swapping the resolver's `authScopes` from the self-only
   * boolean check to the naive `ownerOf` scope (the shape most sibling
   * user-associated mutations use) reproducibly turns THIS test red — an
   * admin has no `userId` of their own, so `ownerOf`'s `isOwnerOrAdmin`
   * admin branch lets it through, letting it change a NAMED user's password
   * despite REST's flat 403; the test above (bob acting on alice) is denied
   * either way and so cannot discriminate the two scopes. Confirmed
   * experimentally (`AssertionError: expected undefined to be 'FORBIDDEN'`),
   * then reverted.
   */
  it("refuses the admin changing a named user's password (no REST admin-write path for a known current password)", async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          currentPassword: 'alicepass',
          newPassword: 'newpass123',
        },
      },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(await harness.stores.user.validateUser('alice', 'alicepass')).toBe(
      harness.aliceOwner.userId
    );
  });

  it('refuses an unauthenticated caller (passwordChangeAllowed still requires a non-null viewer)', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: null,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          currentPassword: 'alicepass',
          newPassword: 'newpass123',
        },
      },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });

  /**
   * THE critical case `skipTypeScopes: true` + `passwordChangeAllowed` exists
   * for: `builder.mutationType`'s type-level `authenticated` scope is FALSE
   * for a `mustChangePassword` viewer (`schema/builder.ts`), and Pothos ANDs
   * type-level with field-level scopes by default — so without the
   * exemption this mutation would 403 exactly the users it is for. Seen-to-
   * fail: removing `skipTypeScopes: true` from the resolver reproducibly
   * turns this red (`FORBIDDEN`) — confirmed while writing this test, then
   * reverted.
   */
  it('lets a mustChangePassword viewer change their own password', async () => {
    const forcedViewer: Viewer = { ...harness.aliceViewer, mustChangePassword: true };

    const result = await harness.execute(MUTATION, {
      viewer: forcedViewer,
      variables: {
        input: {
          userId: harness.aliceGlobalId,
          currentPassword: 'alicepass',
          newPassword: 'newpass123',
        },
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.userChangePassword).toEqual({
      __typename: 'UserChangePasswordPayload',
      user: { username: 'alice', mustChangePassword: false },
    });
    expect(await harness.stores.user.validateUser('alice', 'newpass123')).toBe(
      harness.aliceOwner.userId
    );
  });

  /**
   * The contrast case: a `mustChangePassword` viewer stays blocked from an
   * ORDINARY `authenticated`-scoped mutation. `root-auth.test.ts`'s generic
   * walk only proves every field is gated against a NULL viewer — it has a
   * documented blind spot for a field-level scope masking the type-level one
   * for a non-null-but-forced viewer (ledger, task 1, §5) — so this is
   * pinned explicitly here, on a sibling self-only mutation that does NOT
   * carry the exemption.
   */
  it('still refuses a mustChangePassword viewer on an ordinary authenticated-scoped mutation', async () => {
    const forcedViewer: Viewer = { ...harness.aliceViewer, mustChangePassword: true };

    const result = await harness.execute(REGEN_SYNC_MUTATION, {
      viewer: forcedViewer,
      variables: { input: { userId: harness.aliceGlobalId } },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });
});
