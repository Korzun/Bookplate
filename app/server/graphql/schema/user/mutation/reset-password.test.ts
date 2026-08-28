import { encodeGlobalID } from '@pothos/plugin-relay';

import { validateUser } from '../../../../services/password';
import { consumeRefreshToken, createRefreshToken } from '../../../../services/token';
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
  mutation Reset($input: UserResetPasswordInput!) {
    userResetPassword(input: $input) {
      __typename
      ... on UserResetPasswordPayload {
        user { username mustChangePassword }
        password
      }
    }
  }
`;

describe('Mutation.userResetPassword', () => {
  it("resets bob's password for an admin, forces a change, and revokes bob's outstanding refresh tokens", async () => {
    const refreshToken = await createRefreshToken(harness.prisma, {
      username: 'bob',
      userId: harness.bobOwner.userId,
    });

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { userId: encodeGlobalID('User', harness.bobOwner.userId) } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.userResetPassword).toMatchObject({
      user: { username: 'bob', mustChangePassword: true },
    });
    const payload = result.data?.userResetPassword as { password: string };
    const password = payload.password;
    expect(await validateUser(harness.prisma, 'bob', password)).toBe(harness.bobOwner.userId);
    expect(await validateUser(harness.prisma, 'bob', 'bobpass')).toBe(false);
    expect(await consumeRefreshToken(harness.prisma, refreshToken)).toBeNull();
  });

  it('resolves to null for a User global ID that names no user', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { userId: encodeGlobalID('User', 'no-such-user') } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.userResetPassword).toBeNull();
  });

  it("refuses a non-admin caller acting on another user, leaving bob's password unchanged", async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { userId: encodeGlobalID('User', harness.bobOwner.userId) } },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.userResetPassword ?? null).toBeNull();
    expect(await validateUser(harness.prisma, 'bob', 'bobpass')).toBe(harness.bobOwner.userId);
  });

  /**
   * I-1 (task-6 review): the test above (alice acting on bob) is denied
   * under BOTH `{ admin: true }` and the naive `{ ownerOf: args.input.userId
   * .id }` (alice owns neither), so it cannot discriminate the two scopes —
   * this was the one admin-only mutation in the plan left without a test
   * that actually distinguishes admin-only from owner-or-admin. This one
   * does: a non-admin acting on THEIR OWN account is denied under
   * `{ admin: true }` but would be ALLOWED under `ownerOf`'s owner branch,
   * letting any user reset their own login password to a random string they
   * never see and force `mustChangePassword: true` on themselves — a
   * self-lockout REST's admin-only route never permits. Seen-to-fail
   * confirmed experimentally: swapping the resolver's `authScopes` to
   * `{ ownerOf: String(args.input.userId.id) }` left the entire suite green
   * before this test existed, and turns exactly this test red afterward
   * (`AssertionError: expected undefined to be 'FORBIDDEN'`), then reverted.
   */
  it('refuses a non-admin caller resetting their own password, leaving it unchanged', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { userId: harness.aliceGlobalId } },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.userResetPassword ?? null).toBeNull();
    expect(await validateUser(harness.prisma, 'alice', 'alicepass')).toBe(
      harness.aliceOwner.userId
    );
  });
});
