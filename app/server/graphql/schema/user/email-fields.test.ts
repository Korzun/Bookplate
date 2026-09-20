import { GraphQLObjectType } from 'graphql';

import { markEmailVerified, setUserEmail } from '../../../services/email';
import { createHarness, type Harness } from '../../test-util';
import { schema } from '../index';

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
    await setUserEmail(harness.prisma, harness.aliceOwner.userId, 'alice@example.com');
    await markEmailVerified(harness.prisma, harness.aliceOwner.userId);

    const result = await harness.execute(QUERY, {
      viewer: harness.adminViewer,
      variables: { id: harness.aliceGlobalId },
    });

    expect(result.errors).toBeUndefined();
    const node = (result.data as { node: { email: string; emailVerifiedAt: string } }).node;
    expect(node.email).toBe('alice@example.com');
    expect(node.emailVerifiedAt).not.toBeNull();
  });

  it('lets a user read their own address', async () => {
    await setUserEmail(harness.prisma, harness.aliceOwner.userId, 'alice@example.com');

    const result = await harness.execute(QUERY, {
      viewer: harness.aliceViewer,
      variables: { id: harness.aliceGlobalId },
    });

    expect(result.errors).toBeUndefined();
    const node = (result.data as { node: { email: string; emailVerifiedAt: string | null } }).node;
    expect(node.email).toBe('alice@example.com');
    // Never confirmed: setUserEmail always clears emailVerifiedAt.
    expect(node.emailVerifiedAt).toBeNull();
  });

  it("does not let one reader read another reader's address", async () => {
    await setUserEmail(harness.prisma, harness.aliceOwner.userId, 'alice@example.com');

    const result = await harness.execute(QUERY, {
      viewer: harness.bobViewer,
      variables: { id: harness.aliceGlobalId },
    });

    // Pins `User`'s own node-level guard: `findUnique` redirects a non-owner
    // to `NO_MATCH_USER_ID`, so `node(id:)` for another reader's User resolves
    // to a clean `null` rather than erroring or leaking data. This covers the
    // node redirect ONLY — it says nothing about the `email`/`emailVerifiedAt`
    // field scopes below it, which is what would actually stop a leak if this
    // redirect were ever relaxed. See "field scopes are actually enforced"
    // below for that coverage.
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ node: null });
  });

  // Important 1 (task-1-review.md): no path in this schema lets a non-owner,
  // non-admin reader reach another user's `User` object — every route to a
  // foreign `User` is either admin-gated (`Query.user`, `Viewer.users`,
  // `Device.enabledUsers`) or owner-redirected before it gets there (`User`'s
  // own `findUnique`, `Library`'s `loadOne`) — so there is no way to write a
  // behavioural test that reaches the field scope through a live query, as
  // the test above's own comment concedes. This asserts the scope directly
  // against the schema instead: `authScopes` really is wired onto `email` and
  // `emailVerifiedAt` (and `library`, the precedent both copy), and really
  // does compute `{ ownerOf: <row id> }` from the parent — not merely present
  // and inert. `username` is the negative control: an unscoped sibling field
  // proves the probe can also observe "no scope", so the positive results
  // above cannot be a property of every field on this type.
  it('field scopes are actually enforced: email, emailVerifiedAt and library carry authScopes; username does not', () => {
    const userType = schema.getType('User');
    expect(userType).toBeInstanceOf(GraphQLObjectType);
    const fields = (userType as GraphQLObjectType).getFields();

    for (const name of ['email', 'emailVerifiedAt', 'library']) {
      const extensions = fields[name].extensions as {
        pothosConfig?: { pothosOptions?: { authScopes?: unknown } };
      };
      const authScopes = extensions.pothosConfig?.pothosOptions?.authScopes;
      expect(typeof authScopes).toBe('function');
      expect((authScopes as (parent: { id: string }) => unknown)({ id: 'row-1' })).toEqual({
        ownerOf: 'row-1',
      });
    }

    const usernameExtensions = fields.username.extensions as {
      pothosConfig?: { pothosOptions?: { authScopes?: unknown } };
    };
    expect(usernameExtensions.pothosConfig?.pothosOptions?.authScopes).toBeUndefined();
  });
});
