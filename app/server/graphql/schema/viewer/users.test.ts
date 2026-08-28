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

  // REST's `routes/users.ts` (removed in Phase 0) applied `router.use(adminAuth)`
  // to the whole router, so `GET /api/users` was admin-only. This must match
  // it exactly — the plan asserted the opposite of REST for `Viewer.devices`
  // once already.
  //
  // `users` is nullable (pre-client hardening spec, §4 "Nullability
  // ruling"): a denial nulls JUST this field, not the whole operation — the
  // operation stays alive with `viewer` populated, `users: null`, and the
  // FORBIDDEN error still present in `errors`. Seen-to-fail: reverting
  // `Viewer.users`'s `nullable: true` (viewer/model.ts) turns this red —
  // `viewer` itself becomes null instead (a non-null field forced null by a
  // non-null child's denial propagates to the nearest nullable ancestor,
  // which is `Query.viewer`'s own root data, not `Viewer.users`).
  //
  // Task-3 review, M-2: a SIBLING field alongside `users` — asserting only
  // `{ viewer: { users: null } }` proves the operation didn't die, but not
  // that anything else actually still resolves; `username`/`isAdmin` here
  // are what makes "the operation stays alive" mean something concrete
  // (`device/enabled-users.test.ts` already does this — `name` survives
  // next to `enabledUsers: null`).
  it('refuses a non-admin — nulls only `users`, siblings still resolve', async () => {
    const result = await harness.execute('{ viewer { username isAdmin users { username } } }', {
      viewer: harness.aliceViewer,
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data).toEqual({ viewer: { username: 'alice', isAdmin: false, users: null } });
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
