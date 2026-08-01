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

  // `t.arg.globalID` without `for:` accepts ANY type's global ID and hands the
  // resolver its local half, so a Book id would be looked up in the users
  // table and resolve to null — indistinguishable from "no such user". With
  // `for: model` the wrong type is a coercion error instead.
  it("rejects another type's global ID rather than silently resolving null", async () => {
    const bookGlobalId = await harness.seedNodeFor('Book');

    const result = await harness.execute(USER_QUERY, {
      viewer: harness.adminViewer,
      variables: { id: bookGlobalId },
    });

    expect(result.errors).toBeDefined();
    expect(result.errors?.[0]?.message).toMatch(/User/);
    // The positive control: the same query with the RIGHT type of id works,
    // so this is proving type-checking and not merely that something failed.
    const ok = await harness.execute(USER_QUERY, {
      viewer: harness.adminViewer,
      variables: { id: harness.aliceGlobalId },
    });
    expect(ok.errors).toBeUndefined();
  });
});
