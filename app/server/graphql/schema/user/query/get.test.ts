import { createHarness, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const USER_QUERY = 'query ($id: ID!) { user(id: $id) { id username mustChangePassword } }';

describe('Query.user', () => {
  it('returns a user for an admin', async () => {
    const result = await harness.execute(USER_QUERY, {
      viewer: harness.adminViewer,
      variables: { id: harness.aliceGlobalId },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.user).toMatchObject({ username: 'alice', mustChangePassword: false });
  });

  it('refuses a non-admin', async () => {
    const result = await harness.execute(USER_QUERY, {
      viewer: harness.aliceViewer,
      variables: { id: harness.aliceGlobalId },
    });

    expect(result.errors?.[0].extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.user ?? null).toBeNull();
  });

  it('refuses an unauthenticated caller', async () => {
    const result = await harness.execute(USER_QUERY, {
      viewer: null,
      variables: { id: harness.aliceGlobalId },
    });

    expect(result.errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');
  });
});
