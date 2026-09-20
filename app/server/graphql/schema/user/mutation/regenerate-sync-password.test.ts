import { encodeGlobalID } from '@pothos/plugin-relay';

import { ensureAdminUser } from '../../../../services/admin-account';
import { getSyncPassword } from '../../../../services/password';
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
    const before = await getSyncPassword(harness.prisma, 'alice');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { userId: harness.aliceGlobalId } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.userRegenerateSyncPassword).toMatchObject({ user: { username: 'alice' } });
    const payload = result.data?.userRegenerateSyncPassword as { syncPassword: string };
    const after = payload.syncPassword;
    expect(after).not.toBe(before);
    expect(await getSyncPassword(harness.prisma, 'alice')).toBe(after);
  });

  it("refuses one user regenerating another user's sync password, target unchanged", async () => {
    const before = await getSyncPassword(harness.prisma, 'alice');

    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: { input: { userId: harness.aliceGlobalId } },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(await getSyncPassword(harness.prisma, 'alice')).toBe(before);
  });

  /**
   * Seen-to-fail: swapping the resolver's self-only boolean `authScopes` for
   * the naive `ownerOf` scope reproducibly turns THIS test red — an admin
   * has no `userId` of their own, so `ownerOf`'s admin branch lets it
   * through despite REST's flat 403 for an admin session
   * (`POST /api/my/sync-password/regenerate` in `routes/ui.ts`, removed in
   * `e67b4ad9`); the test above (bob acting on alice) is denied either way and
   * so cannot discriminate the two scopes. Confirmed
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

  /**
   * G3, literal acceptance case: the admin (its real, production shape —
   * `userId: null`) targeting its own now-existing row (task 7's
   * `ensureAdminUser`). This already comes back FORBIDDEN with no code
   * change in this task, because the self-only `authScopes` above can never
   * match a null `viewer.userId` against a real decoded id — so it does not
   * by itself discriminate the new resolver-level guard from that
   * pre-existing scope. It is still the exact scenario the spec's G3
   * requires ("`viewerRegenerateSyncPassword` must refuse the admin"), so it
   * is pinned here. The NEXT test is the one that isolates the new guard.
   */
  it('refuses the admin regenerating its own now-existing row (no sync credentials)', async () => {
    const adminId = await ensureAdminUser(harness.prisma, 'admin');

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { userId: encodeGlobalID('User', adminId) } },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(
      (await harness.prisma.user.findUniqueOrThrow({ where: { id: adminId } })).syncPassword
    ).toBeNull();
  });

  /**
   * Isolates the new resolver-level guard from the pre-existing `authScopes`
   * check. In a real request `context.viewer.userId` is always `null` for the
   * admin (its token deliberately carries no `sub`), so the scope's
   * `context.viewer.userId === args.input.userId.id` can never match and the
   * resolver body above is unreachable by the admin today — confirmed
   * experimentally with the admin's real viewer shape. This test fabricates
   * the ONE way past that scope — a viewer whose `userId` already equals its
   * own row, as if that invariant ever broke — to prove the resolver's own
   * `isAdmin` check is load-bearing on its own, not merely redundant with the
   * scope: the same "guard explicitly, don't rely on a structural
   * coincidence" rule G2 restores for `userDelete`/`userResetPassword`.
   *
   * Seen-to-fail: deleting the resolver's `if (context.viewer!.isAdmin) return
   * ...` branch turns THIS test red (`syncPassword` gets written, and the
   * result is the payload, not `InvalidInputError`) while leaving the test
   * above unaffected either way.
   */
  it('refuses the admin even with a viewer whose userId matches its own row (defense in depth for G3)', async () => {
    const adminId = await ensureAdminUser(harness.prisma, 'admin');
    const brokenInvariantAdminViewer: Viewer = { ...harness.adminViewer, userId: adminId };

    const result = await harness.execute(MUTATION, {
      viewer: brokenInvariantAdminViewer,
      variables: { input: { userId: encodeGlobalID('User', adminId) } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.userRegenerateSyncPassword).toMatchObject({
      __typename: 'InvalidInputError',
    });
    expect(
      (await harness.prisma.user.findUniqueOrThrow({ where: { id: adminId } })).syncPassword
    ).toBeNull();
  });
});
