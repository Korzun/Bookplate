import { createHarness, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const LIB = 'query ($id: ID!) { user(id: $id) { library { id user { username } } } }';

describe('Library ownership', () => {
  it('an admin can traverse to any user library', async () => {
    const result = await harness.execute(LIB, {
      viewer: harness.adminViewer,
      variables: { id: harness.aliceGlobalId },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.user?.library?.user?.username).toBe('alice');
  });

  it('viewer.library is the viewer own library', async () => {
    const result = await harness.execute('{ viewer { library { user { username } } } }', {
      viewer: harness.aliceViewer,
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.viewer?.library?.user?.username).toBe('alice');
  });

  it('viewer.library is null for the config admin, which owns no library', async () => {
    const result = await harness.execute('{ viewer { library { id } } }', {
      viewer: harness.adminViewer,
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.viewer?.library ?? null).toBeNull();
  });

  it('a non-admin cannot reach Query.user at all, so cannot traverse to another library', async () => {
    const result = await harness.execute(LIB, {
      viewer: harness.bobViewer,
      variables: { id: harness.aliceGlobalId },
    });

    expect(result.errors?.[0].extensions?.code).toBe('FORBIDDEN');
  });
});
