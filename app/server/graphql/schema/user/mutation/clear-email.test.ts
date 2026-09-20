import { encodeGlobalID } from '@pothos/plugin-relay';

import { computeMustSetEmail } from '../../../../routes/ui';
import { ensureAdminUser, isConfigAdminRow } from '../../../../services/admin-account';
import { markEmailVerified, setUserEmail } from '../../../../services/email';
import { issueEmailToken } from '../../../../services/email-token';
import { createHarness, MAIL_CONFIG, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

let harness: Harness;

afterEach(async () => {
  await harness.cleanup();
});

const CLEAR = `
  mutation Clear($input: UserClearEmailInput!) {
    userClearEmail(input: $input) {
      __typename
      ... on UserClearEmailPayload {
        user { id email emailVerifiedAt }
      }
    }
  }
`;

// Selects ONLY `__typename` — no nested `user { email }`. `User.email` and
// `User.emailVerifiedAt` carry their own `ownerOf` field scope (Task 1), so
// a query selecting them denies a non-owner caller regardless of whether
// THIS mutation's own `{ admin: true }` scope is enforced — asserted and
// seen to fail: with `CLEAR` (which selects those fields) and the mutation's
// own scope loosened to `{ authenticated: true }`, this test still reported
// "Not authorized" errors, but ones rooted at `userClearEmail.user.email` /
// `.emailVerifiedAt`, not at `userClearEmail` itself — a pass for the wrong
// reason. `CLEAR_TYPENAME_ONLY` has no such field to trip over.
const CLEAR_TYPENAME_ONLY = `
  mutation Clear($input: UserClearEmailInput!) {
    userClearEmail(input: $input) {
      __typename
    }
  }
`;

describe('Mutation.userClearEmail', () => {
  it('clears the address, the key and the confirmed state', async () => {
    harness = await createHarness();
    const id = harness.aliceOwner.userId;
    await setUserEmail(harness.prisma, id, 'ann@example.com');
    await markEmailVerified(harness.prisma, id);

    const result = await harness.execute(CLEAR, {
      viewer: harness.adminViewer,
      variables: { input: { userId: encodeGlobalID('User', id) } },
    });

    expect(result.errors).toBeUndefined();
    const row = await harness.prisma.user.findUniqueOrThrow({ where: { id } });
    expect(row.email).toBeNull();
    expect(row.emailKey).toBeNull();
    expect(row.emailVerifiedAt).toBeNull();
  });

  it('invalidates outstanding email tokens of both purposes', async () => {
    harness = await createHarness();
    const id = harness.aliceOwner.userId;
    await setUserEmail(harness.prisma, id, 'ann@example.com');
    await issueEmailToken(harness.prisma, {
      userId: id,
      purpose: 'verify',
      email: 'ann@example.com',
    });
    await issueEmailToken(harness.prisma, {
      userId: id,
      purpose: 'reset',
      email: 'ann@example.com',
    });

    await harness.execute(CLEAR, {
      viewer: harness.adminViewer,
      variables: { input: { userId: encodeGlobalID('User', id) } },
    });

    expect(await harness.prisma.emailToken.count({ where: { userId: id } })).toBe(0);
  });

  it('frees the address for another account', async () => {
    harness = await createHarness();
    const annId = harness.aliceOwner.userId;
    const bobId = harness.bobOwner.userId;
    await setUserEmail(harness.prisma, annId, 'shared@example.com');
    expect(await setUserEmail(harness.prisma, bobId, 'shared@example.com')).toEqual({
      ok: false,
      reason: 'in_use',
    });

    await harness.execute(CLEAR, {
      viewer: harness.adminViewer,
      variables: { input: { userId: encodeGlobalID('User', annId) } },
    });

    expect(await setUserEmail(harness.prisma, bobId, 'shared@example.com')).toEqual({ ok: true });
  });

  /**
   * THE LOAD-BEARING ASSERTION: a guard that returned null while still
   * writing would satisfy the first assertion alone and leave the defect
   * intact — same reasoning as `userResetPassword`'s guard test asserting
   * `passwordHash` is still null.
   */
  it('refuses the config admin row, and writes nothing to it', async () => {
    harness = await createHarness();
    const adminId = (await ensureAdminUser(harness.prisma, 'admin'))!;
    await setUserEmail(harness.prisma, adminId, 'boss@example.com');
    expect(await isConfigAdminRow(harness.prisma, adminId)).toBe(true);

    const result = await harness.execute(CLEAR, {
      viewer: harness.adminViewer,
      variables: { input: { userId: encodeGlobalID('User', adminId) } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.userClearEmail).toBeNull();
    const row = await harness.prisma.user.findUniqueOrThrow({ where: { id: adminId } });
    expect(row.email).toBe('boss@example.com');
  });

  it('returns null for a user that does not exist', async () => {
    harness = await createHarness();
    const result = await harness.execute(CLEAR, {
      viewer: harness.adminViewer,
      variables: { input: { userId: encodeGlobalID('User', 'no-such-user') } },
    });
    expect(result.errors).toBeUndefined();
    expect(result.data?.userClearEmail).toBeNull();
  });

  /**
   * `mustSetEmail` is derived (`email == null && mailConfigured`), so
   * clearing an address puts the user back on the set-email screen at their
   * next token refresh. This is the consequence the admin-facing copy warns
   * about, and it is the one behaviour of this mutation a user actually
   * notices.
   */
  it('re-gates the cleared user when mail is configured', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });
    const id = harness.aliceOwner.userId;
    await setUserEmail(harness.prisma, id, 'ann@example.com');
    expect(await computeMustSetEmail(harness.prisma, harness.config, { username: 'alice' })).toBe(
      false
    );

    await harness.execute(CLEAR, {
      viewer: harness.adminViewer,
      variables: { input: { userId: encodeGlobalID('User', id) } },
    });

    expect(await computeMustSetEmail(harness.prisma, harness.config, { username: 'alice' })).toBe(
      true
    );
  });

  it('is refused for a non-admin viewer, and writes nothing to the target row', async () => {
    harness = await createHarness();
    const id = harness.bobOwner.userId;
    await setUserEmail(harness.prisma, id, 'bob@example.com');

    const result = await harness.execute(CLEAR_TYPENAME_ONLY, {
      viewer: harness.aliceViewer,
      variables: { input: { userId: encodeGlobalID('User', id) } },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    const row = await harness.prisma.user.findUniqueOrThrow({ where: { id } });
    expect(row.email).toBe('bob@example.com');
  });
});
