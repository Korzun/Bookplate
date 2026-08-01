import { createHarness, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const CONFIG = '{ config { libraryName maxConcurrentUploads } }';

describe('Query.config', () => {
  it('returns the same two values GET /api/config returns', async () => {
    const result = await harness.execute(CONFIG, { viewer: harness.aliceViewer });

    expect(result.errors).toBeUndefined();
    expect(result.data?.config).toEqual({
      libraryName: harness.config.libraryName,
      maxConcurrentUploads: harness.config.maxConcurrentUploads,
    });
  });

  // `GET /api/config` carries `requireAuth` and no admin gate, so an admin
  // session gets the same payload as any other user. Asserted rather than
  // assumed: the sibling `Viewer.users` is admin-only and `Viewer.devices` is
  // not, and this plan has guessed wrong about which is which before.
  it('answers identically for an admin', async () => {
    const asAdmin = await harness.execute(CONFIG, { viewer: harness.adminViewer });
    const asUser = await harness.execute(CONFIG, { viewer: harness.aliceViewer });

    expect(asAdmin.errors).toBeUndefined();
    expect(asAdmin.data?.config).toEqual(asUser.data?.config);
  });

  it('refuses an unauthenticated caller', async () => {
    const result = await harness.execute(CONFIG, { viewer: null });

    expect(result.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });

  // AppConfig also holds the admin `password`, `booksDir` and `dataDir`. The
  // Config type is pinned to a two-field Pick so exposing one would not
  // typecheck; this asserts the schema itself offers no such field either, so
  // a future widening of that Pick still has to get past a test.
  it('exposes nothing but those two fields', async () => {
    const result = await harness.execute('{ config { password } }', {
      viewer: harness.aliceViewer,
    });

    expect(result.errors?.[0]?.message).toMatch(/Cannot query field/);
  });
});
