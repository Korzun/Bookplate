import { setUserEmail } from '../../../../services/email';
import { issueEmailToken, type IssueResult } from '../../../../services/email-token';
import { createHarness, MAIL_CONFIG, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

let harness: Harness;

afterEach(async () => {
  await harness.cleanup();
});

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

const setup = async (): Promise<{ harness: Harness; code: string }> => {
  const built = await createHarness({ mail: MAIL_CONFIG });
  await setUserEmail(built.prisma, built.aliceOwner.userId, 'ann@example.com');
  const issued = await issueEmailToken(built.prisma, {
    userId: built.aliceOwner.userId,
    purpose: 'verify',
    email: 'ann@example.com',
  });
  return { harness: built, code: (issued as IssueResult & { ok: true }).code };
};

describe('viewerConfirmEmail', () => {
  it('marks the address verified', async () => {
    const { harness: h, code } = await setup();
    harness = h;

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

  it('rejects a wrong code', async () => {
    const { harness: h } = await setup();
    harness = h;

    const result = await harness.execute(CONFIRM_EMAIL, {
      viewer: harness.aliceViewer,
      variables: { input: { code: 'WRONGONE' } },
    });

    expect(result.data?.viewerConfirmEmail).toMatchObject({ __typename: 'InvalidInputError' });
  });

  it('rejects a code once used', async () => {
    const { harness: h, code } = await setup();
    harness = h;

    await harness.execute(CONFIRM_EMAIL, {
      viewer: harness.aliceViewer,
      variables: { input: { code } },
    });
    const second = await harness.execute(CONFIRM_EMAIL, {
      viewer: harness.aliceViewer,
      variables: { input: { code } },
    });

    expect(second.data?.viewerConfirmEmail).toMatchObject({ __typename: 'InvalidInputError' });
  });

  it('rejects a code issued for an address the account no longer has', async () => {
    const { harness: h, code } = await setup();
    harness = h;
    await harness.prisma.user.update({
      where: { id: harness.aliceOwner.userId },
      data: { email: 'moved@example.com', emailKey: 'moved@example.com' },
    });

    const result = await harness.execute(CONFIRM_EMAIL, {
      viewer: harness.aliceViewer,
      variables: { input: { code } },
    });

    expect(result.data?.viewerConfirmEmail).toMatchObject({ __typename: 'InvalidInputError' });
  });

  it('works even when mail is not configured, since the code was already delivered', async () => {
    harness = await createHarness({ mail: null });
    await setUserEmail(harness.prisma, harness.aliceOwner.userId, 'ann@example.com');
    const issued = await issueEmailToken(harness.prisma, {
      userId: harness.aliceOwner.userId,
      purpose: 'verify',
      email: 'ann@example.com',
    });
    const code = (issued as IssueResult & { ok: true }).code;

    const result = await harness.execute(CONFIRM_EMAIL, {
      viewer: harness.aliceViewer,
      variables: { input: { code } },
    });

    expect(result.data?.viewerConfirmEmail).toMatchObject({
      __typename: 'ViewerConfirmEmailPayload',
    });
  });
});
