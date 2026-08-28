import { consumeRefreshToken, createRefreshToken } from '../../../../services/token';
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
    userRegenerateSyncPassword(input: $input) {
      __typename
      ... on UserRegenerateSyncPasswordPayload { syncPassword }
    }
  }
`;

describe('Mutation.userChangePassword', () => {
  it("changes the viewer's own password given the correct current password", async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
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
    const refreshToken = await createRefreshToken(harness.prisma, {
      username: 'alice',
      userId: harness.aliceOwner.userId,
    });

    await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
          currentPassword: 'alicepass',
          newPassword: 'newpass123',
        },
      },
    });

    expect(await consumeRefreshToken(harness.prisma, refreshToken)).toBeNull();
  });

  it("returns IncorrectPasswordError for a wrong current password, and leaves alice's password unchanged", async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: {
        input: {
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
        input: { currentPassword: 'alicepass', newPassword: '' },
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
        input: { currentPassword: '', newPassword: 'newpass123' },
      },
    });

    expect(result.data?.userChangePassword).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [{ path: ['currentPassword'], message: 'Current and new password are required' }],
    });
  });

  /**
   * The input no longer carries a `userId`, so "bob names alice" is not merely
   * refused, it is unrepresentable. What remains worth pinning is the property
   * that replaced it: the mutation always acts on the CALLER. Bob supplying
   * alice's current password must not touch alice — it must be evaluated
   * against bob's own account and fail there.
   *
   * Seen-to-fail: hard-coding the resolver's `username` to a fixed 'alice'
   * turns this red on the first assertion (bob's call would succeed) and on
   * the third (alice's password would change).
   */
  it('acts on the caller, never on the owner of the supplied password', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: {
        input: {
          currentPassword: 'alicepass',
          newPassword: 'newpass123',
        },
      },
    });

    // Alice's password is not bob's, so against bob's account it is simply wrong.
    expect(result.data?.userChangePassword).toMatchObject({
      __typename: 'IncorrectPasswordError',
    });
    expect(await harness.stores.user.validateUser('bob', 'newpass123')).toBe(false);
    expect(await harness.stores.user.validateUser('alice', 'alicepass')).toBe(
      harness.aliceOwner.userId
    );
  });

  /**
   * The payload's `user` field is the one line in this resolver that no other
   * test reaches with a non-alice caller: every success-path assertion here
   * uses alice, and bob only ever exercises the IncorrectPasswordError branch.
   * A whole-branch review proved the gap by hardcoding the lookup to alice and
   * watching all 1942 server tests still pass.
   *
   * This pins BOTH halves at once: the write lands on bob, and the payload
   * reports bob.
   */
  it('reports the caller in its payload, and writes to the caller, for a non-default user', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: { input: { currentPassword: 'bobpass', newPassword: 'bobnewpass' } },
    });

    expect(result.data?.userChangePassword).toEqual({
      __typename: 'UserChangePasswordPayload',
      user: { username: 'bob', mustChangePassword: false },
    });
    expect(await harness.stores.user.validateUser('bob', 'bobnewpass')).toBe(
      harness.bobOwner.userId
    );
    expect(await harness.stores.user.validateUser('alice', 'alicepass')).toBe(
      harness.aliceOwner.userId
    );
  });

  /**
   * The config admin owns no user row (`viewer.userId` is always null), so it
   * has no password of its own to change and REST 403s it outright
   * (`routes/ui.ts:387-390`). Previously that fell out of the id comparison;
   * now it is the explicit `viewer.userId !== null` half of `authScopes`, and
   * this test is what pins it.
   *
   * Seen-to-fail: dropping `&& context.viewer.userId !== null` from
   * `authScopes` turns this red — the admin then passes the scope and reaches
   * the resolver, which looks up its non-existent account and answers
   * `IncorrectPasswordError` instead of FORBIDDEN. A weaker assertion (merely
   * "alice is unchanged") would pass in BOTH cases and prove nothing, which is
   * why this asserts the error code.
   */
  it('refuses the config admin, which owns no account of its own', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: {
        input: {
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

  it('refuses an unauthenticated caller through the declared passwordChangeAllowed scope', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: null,
      variables: {
        input: {
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
   *
   * **This test is also the regression guard for the input's missing `userId`
   * (2026-08-04).** The exemption above made the mutation *reachable* by a
   * forced-change viewer, but while `UserChangePasswordInput` required a User
   * global ID that viewer could not actually CALL it: every `Query` field is
   * gated on `authenticated`, which is false for them, so
   * `query { viewer { user { id } } }` answers FORBIDDEN and there is no other
   * way to obtain the id. Note this test supplies no id at all — that is the
   * point. Re-adding a `userId` argument would restore the deadlock while
   * leaving every existing assertion here green, so if a future change wants
   * one back, it needs a way for this viewer to learn its own global ID first.
   */
  it('lets a mustChangePassword viewer change their own password', async () => {
    const forcedViewer: Viewer = { ...harness.aliceViewer, mustChangePassword: true };

    const result = await harness.execute(MUTATION, {
      viewer: forcedViewer,
      variables: {
        input: {
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
