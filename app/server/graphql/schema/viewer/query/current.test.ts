import { ForbiddenError } from '@pothos/plugin-scope-auth';

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

    // Pin the rejection to scope-auth's own ForbiddenError, not just any
    // thrown error: `requireViewer` inside the resolver would also throw on
    // a null viewer, so asserting on mere error presence would pass even if
    // the builder-level `authenticated` scope were misconfigured or removed
    // — the resolver's redundant null-check would mask the regression.
    const originalError = result.errors?.[0]?.originalError;
    expect(originalError).toBeInstanceOf(ForbiddenError);
    expect((originalError as ForbiddenError | undefined)?.code).toBe('FORBIDDEN');
  });
});
