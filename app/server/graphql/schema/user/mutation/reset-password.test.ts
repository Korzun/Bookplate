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
  mutation Reset($input: UserResetPasswordInput!) {
    userResetPassword(input: $input) {
      user { username mustChangePassword }
      password
    }
  }
`;

describe('Mutation.userResetPassword', () => {
  it("resets bob's password for an admin, forces a change, and revokes bob's outstanding refresh tokens", async () => {
    const refreshToken = await harness.stores.token.createRefreshToken({
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
    expect(await harness.stores.user.validateUser('bob', password)).toBe(harness.bobOwner.userId);
    expect(await harness.stores.user.validateUser('bob', 'bobpass')).toBe(false);
    expect(await harness.stores.token.consumeRefreshToken(refreshToken)).toBeNull();
  });

  it('resolves to null for a User global ID that names no user', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { userId: encodeGlobalID('User', 'no-such-user') } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.userResetPassword).toBeNull();
  });

  it("refuses a non-admin caller, leaving bob's password unchanged", async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { userId: encodeGlobalID('User', harness.bobOwner.userId) } },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.userResetPassword ?? null).toBeNull();
    expect(await harness.stores.user.validateUser('bob', 'bobpass')).toBe(harness.bobOwner.userId);
  });
});
