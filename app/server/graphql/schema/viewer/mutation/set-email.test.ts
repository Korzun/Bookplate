import { ensureAdminUser } from '../../../../services/admin-account';
import { setUserEmail } from '../../../../services/email';
import { issueEmailToken } from '../../../../services/email-token';
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
    const adminId = await ensureAdminUser(harness.prisma, 'admin');

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
});
