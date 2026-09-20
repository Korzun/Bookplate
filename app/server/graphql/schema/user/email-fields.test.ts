import { markEmailVerified, setUserEmail } from '../../../services/email';
import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const QUERY = 'query($id: ID!) { node(id: $id) { ... on User { email emailVerifiedAt } } }';

describe('User.email / User.emailVerifiedAt', () => {
  it("lets an admin read another user's address and confirmed state", async () => {
    await setUserEmail(harness.prisma, harness.aliceOwner.userId, 'ann@example.com');
    await markEmailVerified(harness.prisma, harness.aliceOwner.userId);

    const result = await harness.execute(QUERY, {
      viewer: harness.adminViewer,
      variables: { id: harness.aliceGlobalId },
    });

    expect(result.errors).toBeUndefined();
    const node = (result.data as { node: { email: string; emailVerifiedAt: string } }).node;
    expect(node.email).toBe('ann@example.com');
    expect(node.emailVerifiedAt).not.toBeNull();
  });

  it('lets a user read their own address', async () => {
    await setUserEmail(harness.prisma, harness.aliceOwner.userId, 'ann@example.com');

    const result = await harness.execute(QUERY, {
      viewer: harness.aliceViewer,
      variables: { id: harness.aliceGlobalId },
    });

    expect(result.errors).toBeUndefined();
    const node = (result.data as { node: { email: string; emailVerifiedAt: string | null } }).node;
    expect(node.email).toBe('ann@example.com');
    // Never confirmed: setUserEmail always clears emailVerifiedAt.
    expect(node.emailVerifiedAt).toBeNull();
  });

  it("does not let one reader read another reader's address", async () => {
    await setUserEmail(harness.prisma, harness.aliceOwner.userId, 'ann@example.com');

    const result = await harness.execute(QUERY, {
      viewer: harness.bobViewer,
      variables: { id: harness.aliceGlobalId },
    });

    // `User`'s own findUnique redirects a non-owner to NO_MATCH_USER_ID, so the
    // node resolves null rather than erroring — assert no address leaks either way.
    expect(JSON.stringify(result)).not.toContain('ann@example.com');
  });
});
