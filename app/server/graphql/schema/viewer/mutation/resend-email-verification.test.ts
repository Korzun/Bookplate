import { markEmailVerified, setUserEmail } from '../../../../services/email';
import { createHarness, MAIL_CONFIG, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

let harness: Harness;

afterEach(async () => {
  await harness.cleanup();
});

const RESEND = `
  mutation Resend {
    viewerResendEmailVerification {
      __typename
      ... on ViewerResendEmailVerificationPayload {
        delivered
      }
      ... on InvalidInputError {
        message
      }
      ... on EmailNotConfiguredError {
        message
      }
    }
  }
`;

describe('viewerResendEmailVerification', () => {
  it('sends a fresh code', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });
    await setUserEmail(harness.prisma, harness.aliceOwner.userId, 'ann@example.com');

    const result = await harness.execute(RESEND, { viewer: harness.aliceViewer });

    expect(result.data?.viewerResendEmailVerification).toMatchObject({
      __typename: 'ViewerResendEmailVerificationPayload',
    });
    expect(harness.mailer!.sent).toHaveLength(1);
  });

  it('reports the cooldown rather than sending twice', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });
    await setUserEmail(harness.prisma, harness.aliceOwner.userId, 'ann@example.com');
    await harness.execute(RESEND, { viewer: harness.aliceViewer });

    const second = await harness.execute(RESEND, { viewer: harness.aliceViewer });

    expect(second.data?.viewerResendEmailVerification).toMatchObject({
      __typename: 'InvalidInputError',
    });
    expect(harness.mailer!.sent).toHaveLength(1);
  });

  it('refuses when the account has no address to send to', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });

    const result = await harness.execute(RESEND, { viewer: harness.aliceViewer });

    expect(result.data?.viewerResendEmailVerification).toMatchObject({
      __typename: 'InvalidInputError',
    });
  });

  it('refuses for an already-verified address', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });
    await setUserEmail(harness.prisma, harness.aliceOwner.userId, 'ann@example.com');
    await markEmailVerified(harness.prisma, harness.aliceOwner.userId);

    const result = await harness.execute(RESEND, { viewer: harness.aliceViewer });

    expect(result.data?.viewerResendEmailVerification).toMatchObject({
      __typename: 'InvalidInputError',
    });
    expect(harness.mailer!.sent).toHaveLength(0);
  });

  it('returns EmailNotConfiguredError when the install cannot send', async () => {
    harness = await createHarness({ mail: null });
    await setUserEmail(harness.prisma, harness.aliceOwner.userId, 'ann@example.com');

    const result = await harness.execute(RESEND, { viewer: harness.aliceViewer });

    expect(result.data?.viewerResendEmailVerification).toMatchObject({
      __typename: 'EmailNotConfiguredError',
    });
  });
});
