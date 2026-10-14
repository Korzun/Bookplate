import * as fs from 'fs';
import * as path from 'path';

import { validateUser } from '../../../../services/password';
import { createHarness, MAIL_CONFIG, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const MUTATION = `
  mutation Register($input: UserRegisterInput!) {
    userRegister(input: $input) {
      __typename
      ... on UserRegisterPayload {
        user { username mustChangePassword }
        password
        onboardingEmailSent
      }
      ... on InvalidInputError {
        message
        issues { path message }
      }
      ... on UsernameAlreadyExistsError {
        message
        username
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

describe('Mutation.userRegister', () => {
  it('creates a user for an admin, on disk and in the DB, and returns a generated password', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: 'charlie1' } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.userRegister).toMatchObject({
      __typename: 'UserRegisterPayload',
      user: { username: 'charlie1', mustChangePassword: true },
      onboardingEmailSent: false,
    });
    const payload = result.data?.userRegister as { password: string };
    const password = payload.password;
    expect(typeof password).toBe('string');
    expect(password.length).toBeGreaterThan(0);

    const row = await harness.prisma.user.findUnique({ where: { username: 'charlie1' } });
    expect(row).not.toBeNull();
    expect(row?.mustChangePassword).toBe(true);
    expect(await validateUser(harness.prisma, 'charlie1', password)).toBe(row?.id);
    expect(fs.existsSync(path.join(harness.config.booksDir, 'charlie1'))).toBe(true);
  });

  it('trims surrounding whitespace, matching REST', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: '  charlie2  ' } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.userRegister).toMatchObject({
      __typename: 'UserRegisterPayload',
      user: { username: 'charlie2' },
    });
  });

  it('returns InvalidInputError for an invalid-charset username and creates nothing', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: '_charlie' } },
    });

    expect(result.data?.userRegister).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [
        {
          path: ['username'],
          message:
            'Username may only contain letters, numbers, dots, underscores and dashes, and must start with a letter or number',
        },
      ],
    });
    expect(await harness.prisma.user.findUnique({ where: { username: '_charlie' } })).toBeNull();
  });

  it('returns InvalidInputError for an empty username', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: '   ' } },
    });

    expect(result.data?.userRegister).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [{ path: ['username'], message: 'Username is required' }],
    });
  });

  it('returns InvalidInputError for a too-short, otherwise valid, username', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: 'abcde' } }, // 5 chars, valid charset, under MIN_USERNAME_LENGTH (6)
    });

    expect(result.data?.userRegister).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [{ path: ['username'], message: 'Username must be at least 6 characters' }],
    });
    expect(await harness.prisma.user.findUnique({ where: { username: 'abcde' } })).toBeNull();
    expect(fs.existsSync(path.join(harness.config.booksDir, 'abcde'))).toBe(false);
  });

  /**
   * Pins the REST ordering `user/mutation/register.ts`'s doc comment
   * describes: the reserved-name check runs BEFORE the length check, so the
   * default built-in admin name ("admin", 5 chars — under
   * `MIN_USERNAME_LENGTH`) hits `UsernameAlreadyExistsError`, not
   * `InvalidInputError`. Seen-to-fail: swapping the resolver's check order
   * (length before reserved) reproducibly turns this red — it returns
   * `InvalidInputError` with the length message instead — confirmed while
   * writing this test, then reverted.
   */
  it('returns UsernameAlreadyExistsError for the reserved built-in admin name, not a length InvalidInputError', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: harness.config.username } },
    });

    expect(result.data?.userRegister).toEqual({
      __typename: 'UsernameAlreadyExistsError',
      message: 'Username already exists',
      username: harness.config.username,
    });
    expect(
      await harness.prisma.user.findUnique({ where: { username: harness.config.username } })
    ).toBeNull();
  });

  it('returns UsernameAlreadyExistsError for a genuine duplicate username, and does not touch the existing row', async () => {
    const first = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: 'charlie3' } },
    });
    expect(first.errors).toBeUndefined();
    const firstPayload = first.data?.userRegister as { password: string };
    const firstPassword = firstPayload.password;

    const second = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: 'charlie3' } },
    });

    expect(second.data?.userRegister).toEqual({
      __typename: 'UsernameAlreadyExistsError',
      message: 'Username already exists',
      username: 'charlie3',
    });
    expect(await harness.prisma.user.count({ where: { username: 'charlie3' } })).toBe(1);
    expect(await validateUser(harness.prisma, 'charlie3', firstPassword)).not.toBe(false);
  });

  it('refuses a non-admin caller, and creates nothing', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { username: 'charlie4' } },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.userRegister ?? null).toBeNull();
    expect(await harness.prisma.user.findUnique({ where: { username: 'charlie4' } })).toBeNull();
  });

  it('accepts a username of exactly 6 characters, the minimum', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: 'abcdef' } },
    });

    expect(result.errors).toBeUndefined();
    expect((result.data?.userRegister as { __typename: string }).__typename).toBe(
      'UserRegisterPayload'
    );
    expect(await harness.prisma.user.findUnique({ where: { username: 'abcdef' } })).not.toBeNull();
  });

  it('returns InvalidInputError for a username starting with a dot, and creates nothing', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: '.charlie' } },
    });

    expect(result.data?.userRegister).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [
        {
          path: ['username'],
          message:
            'Username may only contain letters, numbers, dots, underscores and dashes, and must start with a letter or number',
        },
      ],
    });
    expect(await harness.prisma.user.findUnique({ where: { username: '.charlie' } })).toBeNull();
  });

  it('accepts a username containing a dot and a dash', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: 'char.lie-1' } },
    });

    expect(result.errors).toBeUndefined();
    expect((result.data?.userRegister as { __typename: string }).__typename).toBe(
      'UserRegisterPayload'
    );
    expect(
      await harness.prisma.user.findUnique({ where: { username: 'char.lie-1' } })
    ).not.toBeNull();
  });
});

describe('Mutation.userRegister — mail not configured', () => {
  it('rejects an email with EmailNotConfiguredError and creates nothing', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: 'charlie1', email: 'c@example.com' } },
    });

    expect(result.data?.userRegister).toMatchObject({ __typename: 'EmailNotConfiguredError' });
    expect(await harness.prisma.user.findUnique({ where: { username: 'charlie1' } })).toBeNull();
  });
});

// Mail works for every other flow here, but the welcome email is link-only, so
// registration keeps the generated-password hand-off.
describe('Mutation.userRegister — mail configured without a public URL', () => {
  beforeEach(async () => {
    await harness.cleanup();
    harness = await createHarness({ mail: MAIL_CONFIG });
  });

  it('registers with a generated password and sends nothing', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: 'charlie1' } },
    });

    expect(result.data?.userRegister).toMatchObject({
      __typename: 'UserRegisterPayload',
      user: { username: 'charlie1', mustChangePassword: true },
      password: expect.any(String),
      onboardingEmailSent: false,
    });
    expect(harness.mailer!.sent).toHaveLength(0);
  });

  it('rejects an email with EmailNotConfiguredError and creates nothing', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: 'charlie1', email: 'c@example.com' } },
    });

    expect(result.data?.userRegister).toMatchObject({ __typename: 'EmailNotConfiguredError' });
    expect(await harness.prisma.user.findUnique({ where: { username: 'charlie1' } })).toBeNull();
  });
});

describe('Mutation.userRegister — mail configured', () => {
  beforeEach(async () => {
    await harness.cleanup();
    harness = await createHarness({ mail: MAIL_CONFIG, publicUrl: 'https://books.example.com' });
  });

  it('requires an email', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: 'charlie1' } },
    });

    expect(result.data?.userRegister).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [{ path: ['email'], message: 'Email is required' }],
    });
    expect(await harness.prisma.user.findUnique({ where: { username: 'charlie1' } })).toBeNull();
  });

  it('rejects an implausible email', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: 'charlie1', email: 'not-an-address' } },
    });

    expect(result.data?.userRegister).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [{ path: ['email'], message: 'Enter a valid email address' }],
    });
  });

  it('still checks the username before the email', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: 'abc', email: 'not-an-address' } },
    });

    expect(result.data?.userRegister).toMatchObject({
      __typename: 'InvalidInputError',
      issues: [{ path: ['username'] }],
    });
  });

  it('creates a password-less account with the address and sends the welcome email', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: 'charlie1', email: ' Charlie@Example.com ' } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.userRegister).toEqual({
      __typename: 'UserRegisterPayload',
      user: { username: 'charlie1', mustChangePassword: false },
      password: null,
      onboardingEmailSent: true,
    });

    const row = await harness.prisma.user.findUniqueOrThrow({ where: { username: 'charlie1' } });
    expect(row.passwordHash).toBeNull();
    expect(row.email).toBe('Charlie@Example.com');
    expect(row.emailKey).toBe('charlie@example.com');
    expect(row.emailVerifiedAt).toBeNull();

    const token = await harness.prisma.emailToken.findUniqueOrThrow({
      where: { userId_purpose: { userId: row.id, purpose: 'onboard' } },
    });
    expect(token.email).toBe('Charlie@Example.com');

    expect(harness.mailer!.sent).toHaveLength(1);
    expect(harness.mailer!.sent[0].to).toBe('Charlie@Example.com');
    expect(harness.mailer!.sent[0].text).toContain('charlie1');
    expect(harness.mailer!.sent[0].text).toContain('https://books.example.com/welcome?code=');
  });

  it('returns EmailInUseError for an address another user holds, differing only by case, and creates nothing', async () => {
    await harness.prisma.user.update({
      where: { id: harness.aliceOwner.userId },
      data: { email: 'taken@example.com', emailKey: 'taken@example.com' },
    });

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: 'charlie1', email: 'TAKEN@example.com' } },
    });

    expect(result.data?.userRegister).toMatchObject({ __typename: 'EmailInUseError' });
    expect(await harness.prisma.user.findUnique({ where: { username: 'charlie1' } })).toBeNull();
    expect(fs.existsSync(path.join(harness.config.booksDir, 'charlie1'))).toBe(false);
    expect(harness.mailer!.sent).toHaveLength(0);
  });

  it('falls back to a generated password when the welcome email fails to send', async () => {
    harness.mailer!.nextResult = { ok: false, reason: 'transient' };

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: 'charlie1', email: 'c@example.com' } },
    });

    expect(result.data?.userRegister).toMatchObject({
      __typename: 'UserRegisterPayload',
      user: { username: 'charlie1', mustChangePassword: true },
      onboardingEmailSent: false,
    });
    const { password } = (result.data as { userRegister: { password: string } }).userRegister;
    expect(typeof password).toBe('string');

    const row = await harness.prisma.user.findUniqueOrThrow({ where: { username: 'charlie1' } });
    expect(await validateUser(harness.prisma, 'charlie1', password)).toBe(row.id);
    expect(row.email).toBe('c@example.com');
    expect(
      await harness.prisma.emailToken.findUnique({
        where: { userId_purpose: { userId: row.id, purpose: 'onboard' } },
      })
    ).toBeNull();
  });
});
