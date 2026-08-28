import * as fs from 'fs';
import * as path from 'path';

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
  mutation Delete($input: UserDeleteInput!) {
    userDelete(input: $input) {
      __typename
      ... on UserDeletePayload { deletedId }
    }
  }
`;

describe('Mutation.userDelete', () => {
  it('deletes the DB row and the on-disk library folder for an admin', async () => {
    const bobDir = path.join(harness.config.booksDir, 'bob');
    expect(fs.existsSync(bobDir)).toBe(true);

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { userId: encodeGlobalID('User', harness.bobOwner.userId) } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.userDelete).toEqual({
      __typename: 'UserDeletePayload',
      deletedId: encodeGlobalID('User', harness.bobOwner.userId),
    });
    expect(
      await harness.prisma.user.findUnique({ where: { id: harness.bobOwner.userId } })
    ).toBeNull();
    expect(fs.existsSync(bobDir)).toBe(false);
  });

  it('resolves to null for a User global ID that names no user', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { userId: encodeGlobalID('User', 'no-such-user') } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.userDelete).toBeNull();
  });

  it('refuses a non-admin caller, leaving the DB row and folder untouched', async () => {
    const bobDir = path.join(harness.config.booksDir, 'bob');

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { userId: encodeGlobalID('User', harness.bobOwner.userId) } },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.userDelete ?? null).toBeNull();
    expect(
      await harness.prisma.user.findUnique({ where: { id: harness.bobOwner.userId } })
    ).not.toBeNull();
    expect(fs.existsSync(bobDir)).toBe(true);
  });

  /**
   * Seen-to-fail: swapping the resolver's `authScopes` from `{ admin: true }`
   * to `{ ownerOf: args.input.userId.id }` (the shape most sibling
   * user-associated mutations use) reproducibly turns THIS test red — a
   * non-admin CAN name and delete their own account under that scope
   * (`isOwnerOrAdmin`'s owner branch), which REST's admin-only route never
   * allows (the test above, a non-admin acting on someone ELSE's account, is
   * denied either way and so cannot discriminate the two scopes). Confirmed
   * experimentally (`AssertionError: expected undefined to be 'FORBIDDEN'`),
   * then reverted.
   */
  it('refuses a non-admin caller attempting to delete their own account', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { userId: harness.aliceGlobalId } },
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(
      await harness.prisma.user.findUnique({ where: { id: harness.aliceOwner.userId } })
    ).not.toBeNull();
  });

  it('cascades to delete the user’s progress rows', async () => {
    await harness.prisma.progress.create({
      data: {
        userId: harness.bobOwner.userId,
        document: 'd'.repeat(32),
        progress: '/p[1]',
        percentage: 0.5,
        device: 'Kobo',
        deviceId: 'dev-1',
        timestamp: 1_700_000_001,
      },
    });

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { userId: encodeGlobalID('User', harness.bobOwner.userId) } },
    });

    expect(result.errors).toBeUndefined();
    expect(
      await harness.prisma.progress.findMany({ where: { userId: harness.bobOwner.userId } })
    ).toEqual([]);
  });
});
