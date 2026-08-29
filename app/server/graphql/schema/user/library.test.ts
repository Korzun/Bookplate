import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const LIB = 'query ($id: ID!) { user(id: $id) { library { id user { username } } } }';

/**
 * `ExecutionResult['data']` is an index-signature-free `ObjMap<unknown>`, so
 * `result.data?.user` does not type-check once test files are checked at all.
 * One narrowing helper, shared by the assertions below, rather than a cast at
 * each — the queries here all select the same `library { id user { username } }`
 * shape.
 */
type LibraryShape = { id?: string; user?: { username?: string } } | null;
const userLibraryOf = (
  result: Awaited<ReturnType<Harness['execute']>>
): { user?: { library?: LibraryShape }; viewer?: { library?: LibraryShape } } =>
  (result.data ?? {}) as { user?: { library?: LibraryShape }; viewer?: { library?: LibraryShape } };

describe('Library ownership', () => {
  it('an admin can traverse to any user library', async () => {
    const result = await harness.execute(LIB, {
      viewer: harness.adminViewer,
      variables: { id: harness.aliceGlobalId },
    });

    expect(result.errors).toBeUndefined();
    expect(userLibraryOf(result).user?.library?.user?.username).toBe('alice');
  });

  it('viewer.library is the viewer own library', async () => {
    const result = await harness.execute('{ viewer { library { user { username } } } }', {
      viewer: harness.aliceViewer,
    });

    expect(result.errors).toBeUndefined();
    expect(userLibraryOf(result).viewer?.library?.user?.username).toBe('alice');
  });

  it('viewer.library is null for the config admin, which owns no library', async () => {
    const result = await harness.execute('{ viewer { library { id } } }', {
      viewer: harness.adminViewer,
    });

    expect(result.errors).toBeUndefined();
    expect(userLibraryOf(result).viewer?.library ?? null).toBeNull();
  });

  it('a non-admin cannot reach Query.user at all, so cannot traverse to another library', async () => {
    const result = await harness.execute(LIB, {
      viewer: harness.bobViewer,
      variables: { id: harness.aliceGlobalId },
    });

    expect(result.errors?.[0].extensions?.code).toBe('FORBIDDEN');
  });
});
