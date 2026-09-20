import { ensureAdminUser } from '../../../../services/admin-account';
import { markEmailVerified, setUserEmail } from '../../../../services/email';
import { issueEmailToken } from '../../../../services/email-token';
import { hashLoginPassword } from '../../../../services/password';
import { createUser } from '../../../../services/user';
import type { Viewer } from '../../../context';
import { createHarness, MAIL_CONFIG, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

let harness: Harness;

afterEach(async () => {
  await harness.cleanup();
});

const SET_EMAIL = `
  mutation SetEmail($input: ViewerSetEmailInput!) {
    viewerSetEmail(input: $input) {
      __typename
      ... on ViewerSetEmailPayload {
        email
        delivered
      }
      ... on InvalidInputError {
        message
        issues { path message }
      }
      ... on EmailInUseError {
        message
      }
      ... on EmailNotConfiguredError {
        message
      }
    }
  }
`;

const CONFIRM_EMAIL = `
  mutation ConfirmEmail($input: ViewerConfirmEmailInput!) {
    viewerConfirmEmail(input: $input) {
      __typename
      ... on ViewerConfirmEmailPayload {
        email
      }
      ... on InvalidInputError {
        message
      }
    }
  }
`;

describe('viewerSetEmail', () => {
  it('stores the address, leaves it unverified, and sends a code', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });

    const result = await harness.execute(SET_EMAIL, {
      viewer: harness.aliceViewer,
      variables: { input: { email: 'Ann@Example.com' } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.viewerSetEmail).toMatchObject({
      __typename: 'ViewerSetEmailPayload',
      email: 'Ann@Example.com',
      delivered: true,
    });
    const row = await harness.prisma.user.findUniqueOrThrow({
      where: { id: harness.aliceOwner.userId },
    });
    expect(row.email).toBe('Ann@Example.com');
    expect(row.emailVerifiedAt).toBeNull();
    expect(harness.mailer!.sent).toHaveLength(1);
    expect(harness.mailer!.sent[0].to).toBe('Ann@Example.com');
    expect(harness.mailer!.sent[0].subject).toContain('Confirm');
  });

  it('sends a code that confirmEmail accepts', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });
    await harness.execute(SET_EMAIL, {
      viewer: harness.aliceViewer,
      variables: { input: { email: 'ann@example.com' } },
    });

    const code = /\b[0-9A-HJKMNP-TV-Z]{8}\b/.exec(harness.mailer!.sent[0].text)![0];
    const result = await harness.execute(CONFIRM_EMAIL, {
      viewer: harness.aliceViewer,
      variables: { input: { code } },
    });

    expect(result.data?.viewerConfirmEmail).toMatchObject({
      __typename: 'ViewerConfirmEmailPayload',
    });
    const row = await harness.prisma.user.findUniqueOrThrow({
      where: { id: harness.aliceOwner.userId },
    });
    expect(row.emailVerifiedAt).not.toBeNull();
  });

  it('returns EmailInUseError when another account holds the address', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });
    await setUserEmail(harness.prisma, harness.bobOwner.userId, 'shared@example.com');

    const result = await harness.execute(SET_EMAIL, {
      viewer: harness.aliceViewer,
      variables: { input: { email: 'SHARED@example.com' } },
    });

    expect(result.data?.viewerSetEmail).toMatchObject({ __typename: 'EmailInUseError' });
  });

  it('returns InvalidInputError for a malformed address', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });

    const result = await harness.execute(SET_EMAIL, {
      viewer: harness.aliceViewer,
      variables: { input: { email: 'nope' } },
    });

    expect(result.data?.viewerSetEmail).toMatchObject({ __typename: 'InvalidInputError' });
  });

  it('returns EmailNotConfiguredError when the install cannot send', async () => {
    harness = await createHarness({ mail: null });

    const result = await harness.execute(SET_EMAIL, {
      viewer: harness.aliceViewer,
      variables: { input: { email: 'ann@example.com' } },
    });

    expect(result.data?.viewerSetEmail).toMatchObject({ __typename: 'EmailNotConfiguredError' });
  });

  it('succeeds even when the send fails, so the address is not lost', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });
    harness.mailer!.nextResult = { ok: false, reason: 'transient' };

    const result = await harness.execute(SET_EMAIL, {
      viewer: harness.aliceViewer,
      variables: { input: { email: 'ann@example.com' } },
    });

    expect(result.data?.viewerSetEmail).toMatchObject({
      __typename: 'ViewerSetEmailPayload',
      delivered: false,
    });
    const row = await harness.prisma.user.findUniqueOrThrow({
      where: { id: harness.aliceOwner.userId },
    });
    expect(row.email).toBe('ann@example.com');
  });

  it('works for the config admin, whose viewer has no userId', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });
    const adminId = (await ensureAdminUser(harness.prisma, 'admin'))!;

    const result = await harness.execute(SET_EMAIL, {
      viewer: harness.adminViewer,
      variables: { input: { email: 'boss@example.com' } },
    });

    expect(result.data?.viewerSetEmail).toMatchObject({ __typename: 'ViewerSetEmailPayload' });
    const row = await harness.prisma.user.findUniqueOrThrow({ where: { id: adminId } });
    expect(row.email).toBe('boss@example.com');
  });

  it('is reachable by a viewer who is gated on setting an address', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });
    const gatedViewer: Viewer = { ...harness.aliceViewer, mustSetEmail: true };

    const result = await harness.execute(SET_EMAIL, {
      viewer: gatedViewer,
      variables: { input: { email: 'ann@example.com' } },
    });

    expect(result.errors).toBeUndefined();
  });

  it('is NOT reachable by a viewer who owes a password change', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });
    const forcedViewer: Viewer = { ...harness.aliceViewer, mustChangePassword: true };

    const result = await harness.execute(SET_EMAIL, {
      viewer: forcedViewer,
      variables: { input: { email: 'ann@example.com' } },
    });

    expect(result.errors?.[0]?.message).toMatch(/not authorized/i);
  });

  it('invalidates an outstanding reset token when the address changes', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });
    const userId = harness.aliceOwner.userId;
    await setUserEmail(harness.prisma, userId, 'old@example.com');
    await issueEmailToken(harness.prisma, { userId, purpose: 'reset', email: 'old@example.com' });

    await harness.execute(SET_EMAIL, {
      viewer: harness.aliceViewer,
      variables: { input: { email: 'new@example.com' } },
    });

    expect(await harness.prisma.emailToken.count({ where: { userId, purpose: 'reset' } })).toBe(0);
  });

  // I1 (important, whole-branch review): `viewerSetEmail` used to call
  // `invalidateEmailTokens(prisma, userId)` with NO purpose, deleting the
  // `verify` row outright — which is where `sentAt`/`sendCount` live. The next
  // `issueEmailToken` then started a fresh row with `sendCount: 1`, so calling
  // `viewerSetEmail` again bypassed BOTH the 60s cooldown and the
  // 5-per-rolling-hour cap, unboundedly (no rate limiter sits on `/graphql`).
  // An authenticated reader could point the operator's verified sending
  // domain at any third party's inbox. The fix narrows the call to
  // `purpose: 'reset'` only, so the outstanding `verify` row (and its
  // `sentAt`/`sendCount`) survives an address change.
  it('is throttled by the resend cooldown across an address change, and the old code stops working', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });
    const userId = harness.aliceOwner.userId;

    const first = await harness.execute(SET_EMAIL, {
      viewer: harness.aliceViewer,
      variables: { input: { email: 'first@example.com' } },
    });
    expect(first.data?.viewerSetEmail).toMatchObject({ delivered: true });
    expect(harness.mailer!.sent).toHaveLength(1);
    const oldCode = /\b[0-9A-HJKMNP-TV-Z]{8}\b/.exec(harness.mailer!.sent[0].text)![0];

    // Immediately calling it again with a DIFFERENT address must not reset the
    // send budget — falsifiable: with the old, unscoped
    // `invalidateEmailTokens(prisma, userId)` call, this second send goes
    // through (`delivered: true`, two messages sent) instead of being
    // throttled.
    const second = await harness.execute(SET_EMAIL, {
      viewer: harness.aliceViewer,
      variables: { input: { email: 'second@example.com' } },
    });
    expect(second.data?.viewerSetEmail).toMatchObject({
      __typename: 'ViewerSetEmailPayload',
      email: 'second@example.com',
      delivered: false,
    });
    expect(harness.mailer!.sent).toHaveLength(1);

    // The address DID change (that write is unconditional), so the code from
    // the first send must not confirm it — it was issued for the old address.
    const confirmResult = await harness.execute(CONFIRM_EMAIL, {
      viewer: harness.aliceViewer,
      variables: { input: { code: oldCode } },
    });
    expect(confirmResult.data?.viewerConfirmEmail).toMatchObject({
      __typename: 'InvalidInputError',
    });
    const row = await harness.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.email).toBe('second@example.com');
    expect(row.emailVerifiedAt).toBeNull();
  });

  // I3 (important, whole-branch review): if `ensureAdminUser`'s rename is ever
  // blocked by a username collision (case 2 — still possible after this
  // wave's C1 fix, which only closed case 3's adoption path), the marked
  // admin row keeps its OLD username while `config.username` now names a
  // READER's row. The admin's `viewer.username` is always `config.username`
  // (set at login from the value it matched, not from the DB row), so a
  // username-keyed lookup would resolve the admin's session to that reader's
  // row — writing the admin's new address onto it. Resolving by the
  // `isConfigAdmin` flag instead must not make that mistake.
  it('resolves the admin row by the isConfigAdmin flag, not by username, after a blocked rename', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });
    const adminId = (await ensureAdminUser(harness.prisma, 'admin'))!;
    // Simulate case 2's blocked rename: the admin row kept its OLD username...
    await harness.prisma.user.update({ where: { id: adminId }, data: { username: 'old-admin' } });
    // ...while a reader now occupies `config.username` ("admin", the value
    // `harness.adminViewer.username` carries).
    const readerId = 'reader-1';
    await harness.prisma.user.create({
      data: {
        id: readerId,
        username: 'admin',
        email: 'reader@example.com',
        emailKey: 'reader@example.com',
      },
    });

    const emailResult = await harness.execute('{ viewer { email } }', {
      viewer: harness.adminViewer,
    });
    expect(emailResult.errors).toBeUndefined();
    // Falsifiable: a username-keyed lookup would return the reader's address
    // here instead of null.
    expect((emailResult.data as { viewer: { email: string | null } }).viewer.email).toBeNull();

    const setResult = await harness.execute(SET_EMAIL, {
      viewer: harness.adminViewer,
      variables: { input: { email: 'boss@example.com' } },
    });
    expect(setResult.data?.viewerSetEmail).toMatchObject({ __typename: 'ViewerSetEmailPayload' });

    const adminRow = await harness.prisma.user.findUniqueOrThrow({ where: { id: adminId } });
    expect(adminRow.email).toBe('boss@example.com');
    // Falsifiable: a username-keyed write would land here instead, silently
    // taking over a reader's account.
    const readerRow = await harness.prisma.user.findUniqueOrThrow({ where: { id: readerId } });
    expect(readerRow.email).toBe('reader@example.com');
  });

  /**
   * A security property, not a copy preference: `EmailInUseError.message` is
   * returned to whoever probed the address, so it must never reveal whether
   * the address it collided with belongs to a confirmed account or an
   * unconfirmed one — either leak would tell a prober something about a
   * different account. MUST be configured with mail — `viewerSetEmail`'s
   * first statement returns `EmailNotConfiguredError` when it is not, which
   * would make both messages trivially equal and this test vacuous. No
   * cooldown applies to either call and carl needs no reset between them:
   * `setUserEmail` runs before any token work, and an `in_use` outcome
   * returns `emailInUseError()` immediately — `invalidateEmailTokens` and
   * `issueEmailToken` sit below that return and are never reached on a
   * collision.
   */
  it('says the same thing whether the holder has confirmed the address or not', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });
    await setUserEmail(harness.prisma, harness.aliceOwner.userId, 'unconfirmed@example.com');
    await setUserEmail(harness.prisma, harness.bobOwner.userId, 'confirmed@example.com');
    await markEmailVerified(harness.prisma, harness.bobOwner.userId);

    await createUser(harness.prisma, 'carl', await hashLoginPassword('carlpass'));
    const carlId = (await harness.prisma.user.findUniqueOrThrow({ where: { username: 'carl' } }))
      .id;
    const carlViewer: Viewer = {
      userId: carlId,
      username: 'carl',
      isAdmin: false,
      mustChangePassword: false,
      mustSetEmail: false,
    };

    const against = async (address: string) => {
      const result = await harness.execute(SET_EMAIL, {
        viewer: carlViewer,
        variables: { input: { email: address } },
      });
      return result.data?.viewerSetEmail as { __typename: string; message?: string } | undefined;
    };

    const unconfirmed = await against('unconfirmed@example.com');
    const confirmed = await against('confirmed@example.com');

    // Prove the precondition BEFORE comparing: `against(...)?.message` alone
    // is vacuous-safe — if a regression stopped `setUserEmail` from
    // reporting `in_use` at all, both calls would return
    // `ViewerSetEmailPayload` (no `message` field), both `.message` reads
    // would be `undefined`, and `undefined === undefined` would pass this
    // test while proving nothing about the uniformity property it exists to
    // guard. Asserting the shape first closes that: only two genuine
    // `EmailInUseError` results may reach the equality below.
    expect(unconfirmed?.__typename).toBe('EmailInUseError');
    expect(confirmed?.__typename).toBe('EmailInUseError');

    // Identical strings: a different message for a confirmed holder would
    // tell whoever probed the address something about another account.
    expect(unconfirmed?.message).toBe(confirmed?.message);
  });
});
