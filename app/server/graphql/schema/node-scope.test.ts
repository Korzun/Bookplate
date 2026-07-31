import { GraphQLObjectType } from 'graphql';

import type { Context } from '../context';
import { createHarness, type Harness } from '../test-util';
import { schema } from './index';
import { NO_MATCH_USER_ID, ownerScopedFindUnique } from './node-scope';

vi.mock('../../logger');

const contextFor = (viewer: Context['viewer']): Context => ({ viewer }) as Context;

const alice = {
  userId: 'user-alice',
  username: 'alice',
  isAdmin: false,
  mustChangePassword: false,
};
const bob = { userId: 'user-bob', username: 'bob', isAdmin: false, mustChangePassword: false };
const admin = { userId: null, username: 'admin', isAdmin: true, mustChangePassword: false };

const findUnique = ownerScopedFindUnique((userId: string, id: string) => ({
  userId_id: { userId, id },
}));

// The local id `findUnique` actually receives at runtime for a compound
// `prismaNode('Book', { id: { field: 'userId_id' } })` — confirmed by
// instrumenting a real registration and logging what a custom `findUnique`
// was called with for a real encoded global id: it is
// `JSON.stringify([userId, id])`, NOT `"userId:id"`. See node-scope.ts's
// `parseCompoundId` doc comment for how this was verified.
const compoundId = (userId: string, id: string) => JSON.stringify([userId, id]);

describe('ownerScopedFindUnique', () => {
  it('builds the real clause when the viewer owns the row', () => {
    expect(findUnique(compoundId('user-alice', 'book-1'), contextFor(alice))).toEqual({
      userId_id: { userId: 'user-alice', id: 'book-1' },
    });
  });

  it('builds the real clause for an admin reading another user row', () => {
    expect(findUnique(compoundId('user-alice', 'book-1'), contextFor(admin))).toEqual({
      userId_id: { userId: 'user-alice', id: 'book-1' },
    });
  });

  it('builds a clause that cannot match when the viewer does not own the row', () => {
    expect(findUnique(compoundId('user-alice', 'book-1'), contextFor(bob))).toEqual({
      userId_id: { userId: NO_MATCH_USER_ID, id: 'book-1' },
    });
  });

  it('does not substitute the requester own userId on denial', () => {
    // Book ids are content hashes, so bob may legitimately own a row with the
    // same id. Substituting his userId would silently return a DIFFERENT valid
    // row instead of nothing.
    const clause = findUnique(compoundId('user-alice', 'book-1'), contextFor(bob));

    expect(clause.userId_id.userId).not.toBe('user-bob');
  });

  it('cannot match when there is no viewer at all', () => {
    expect(findUnique(compoundId('user-alice', 'book-1'), contextFor(null)).userId_id.userId).toBe(
      NO_MATCH_USER_ID
    );
  });

  it('cannot match when the global id is malformed', () => {
    expect(findUnique('garbage', contextFor(alice)).userId_id.userId).toBe(NO_MATCH_USER_ID);
  });
});

describe('every Node type refuses cross-tenant reads', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  const nodeInterface = schema.getType('Node');
  const nodeTypes = Object.values(schema.getTypeMap()).filter(
    (type): type is GraphQLObjectType =>
      type instanceof GraphQLObjectType &&
      nodeInterface !== undefined &&
      type.getInterfaces().some((i) => i.name === 'Node')
  );

  it('has at least one Node type, or this suite proves nothing', () => {
    expect(nodeTypes.length).toBeGreaterThan(0);
  });

  it.each(nodeTypes.map((t) => t.name))(
    '%s is not readable by a non-owner via Query.node',
    async (typeName) => {
      const globalId = await harness.seedNodeFor(typeName);

      const denied = await harness.execute('query ($id: ID!) { node(id: $id) { __typename } }', {
        viewer: harness.bobViewer,
        variables: { id: globalId },
      });
      expect(denied.data?.node ?? null).toBeNull();

      // Positive control. Without this the assertion above passes for any
      // reason at all — a malformed ID, an unregistered type, a typo in the
      // encoding — and the suite would report a guard that does not exist.
      const allowed = await harness.execute('query ($id: ID!) { node(id: $id) { __typename } }', {
        viewer: harness.aliceViewer,
        variables: { id: globalId },
      });
      expect((allowed.data as { node: { __typename: string } } | null)?.node?.__typename).toBe(
        typeName
      );
    }
  );
});
