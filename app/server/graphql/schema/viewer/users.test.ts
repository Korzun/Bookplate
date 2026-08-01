import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
  // Two progress rows for alice, one for bob — distinct counts, so a
  // `progressCount` that ignored the row it hangs off (e.g. counting every
  // progress row in the table) would report 3 for both.
  for (const document of ['a'.repeat(32), 'b'.repeat(32)]) {
    await harness.prisma.progress.create({
      data: {
        userId: harness.aliceOwner.userId,
        document,
        progress: '/x',
        percentage: 0.5,
        device: 'Kobo',
        deviceId: 'dev-1',
        timestamp: 1_700_000_000,
      },
    });
  }
  await harness.prisma.progress.create({
    data: {
      userId: harness.bobOwner.userId,
      document: 'c'.repeat(32),
      progress: '/x',
      percentage: 0.5,
      device: 'Kobo',
      deviceId: 'dev-1',
      timestamp: 1_700_000_000,
    },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

const USERS = '{ viewer { users { username progressCount } } }';

type UsersData = { viewer: { users: { username: string; progressCount: number }[] } };

describe('Viewer.users', () => {
  it('lists every user with their progress count, ordered by username', async () => {
    const result = await harness.execute(USERS, { viewer: harness.adminViewer });

    expect(result.errors).toBeUndefined();
    expect((result.data as UsersData).viewer.users).toEqual([
      { username: 'alice', progressCount: 2 },
      { username: 'bob', progressCount: 1 },
    ]);
  });

  // `routes/users.ts` applies `router.use(adminAuth)` to the whole router, so
  // `GET /api/users` is admin-only. This must match it exactly — the plan
  // asserted the opposite of REST for `Viewer.devices` once already.
  it('refuses a non-admin', async () => {
    const result = await harness.execute(USERS, { viewer: harness.aliceViewer });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.viewer ?? null).toBeNull();
  });

  it('exposes each user as a real node whose library is reachable by an admin', async () => {
    const result = await harness.execute(
      '{ viewer { users { id username library { user { username } } } } }',
      { viewer: harness.adminViewer }
    );

    expect(result.errors).toBeUndefined();
    const users = (
      result.data as {
        viewer: {
          users: { id: string; username: string; library: { user: { username: string } } }[];
        };
      }
    ).viewer.users;
    expect(users.map((u) => u.library.user.username)).toEqual(['alice', 'bob']);
    // A real global ID, not a bare row id: it must round-trip through node().
    const roundTrip = await harness.execute(
      'query ($id: ID!) { node(id: $id) { __typename ... on User { username } } }',
      { viewer: harness.adminViewer, variables: { id: users[0].id } }
    );
    expect(
      (roundTrip.data as { node: { __typename: string; username: string } | null }).node
    ).toEqual({ __typename: 'User', username: 'alice' });
  });
});
