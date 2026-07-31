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
  });
});
