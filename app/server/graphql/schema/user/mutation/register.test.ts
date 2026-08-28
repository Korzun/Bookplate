import * as fs from 'fs';
import * as path from 'path';

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
  mutation Register($input: UserRegisterInput!) {
    userRegister(input: $input) {
      __typename
      ... on UserRegisterPayload {
        user { username mustChangePassword }
        password
      }
      ... on InvalidInputError {
        message
        issues { path message }
      }
      ... on UsernameAlreadyExistsError {
        message
        username
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
    });
    const payload = result.data?.userRegister as { password: string };
    const password = payload.password;
    expect(typeof password).toBe('string');
    expect(password.length).toBeGreaterThan(0);

    const row = await harness.prisma.user.findUnique({ where: { username: 'charlie1' } });
    expect(row).not.toBeNull();
    expect(row?.mustChangePassword).toBe(true);
    expect(await harness.stores.user.validateUser('charlie1', password)).toBe(row?.id);
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
    expect(await harness.stores.user.validateUser('charlie3', firstPassword)).not.toBe(false);
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
