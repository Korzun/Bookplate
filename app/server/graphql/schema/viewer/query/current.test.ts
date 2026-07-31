import { createHarness, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

describe('Query.viewer', () => {
  it('returns the authenticated user', async () => {
    const result = await harness.execute('{ viewer { username isAdmin mustChangePassword } }');

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      viewer: { username: 'alice', isAdmin: false, mustChangePassword: false },
    });
  });

  it('returns the config admin, which has no user row', async () => {
    const result = await harness.execute('{ viewer { username isAdmin } }', {
      viewer: harness.adminViewer,
    });

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ viewer: { username: 'admin', isAdmin: true } });
  });

  it('refuses an unauthenticated request', async () => {
    const result = await harness.execute('{ viewer { username } }', { viewer: null });

    expect(result.errors).toBeDefined();
    expect(result.data?.viewer ?? null).toBeNull();

    // Pin the rejection to the builder's own auth code, not just any thrown
    // error: `requireViewer` inside the resolver would also throw on a null
    // viewer, so asserting on mere error presence would pass even if the
    // builder-level `authenticated` scope were misconfigured or removed — the
    // resolver's redundant null-check would mask the regression. The code (not
    // the prose message, which is Pothos's and can be reworded by a minor
    // bump) is what phase 2's client will branch on.
    expect(result.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });

  it('refuses a viewer with a pending forced password change', async () => {
    const result = await harness.execute('{ viewer { username } }', {
      viewer: { ...harness.aliceViewer, mustChangePassword: true },
    });

    expect(result.data?.viewer ?? null).toBeNull();
    // A signed-in-but-blocked viewer is FORBIDDEN, not UNAUTHENTICATED: the
    // token is valid, the account just may not do anything until the password
    // is changed. Mirrors REST's 403 from `passwordChangeGate`.
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });
});
