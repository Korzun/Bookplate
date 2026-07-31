import type { Owner } from '../../../types';
import { builder } from '../builder';
import { isOwnerOrAdmin } from '../node-scope';
import * as user from '../user';

/**
 * A Library is backed by an Owner, and only two resolvers can mint one:
 * Viewer.library (self, by construction) and User.library (ownerOf-gated).
 * Every field registered onto this ref therefore trusts its parent — ownership
 * is decided once, at the point the Owner is created, rather than per field.
 */
export const model = builder.objectRef<Owner>('Library');

// `builder.node(ref, options)` both implements `ref` and attaches the `Node`
// interface in a single call — it is not `ref.implement()` followed by a
// separate `builder.node()` registration. Calling `.implement()` first and
// then handing the already-implemented ref to `builder.node` conflicts with
// how the relay plugin's `node()` is documented and typed (see
// @pothos/plugin-relay's README, "Creating Nodes": `builder.node(User, { id,
// loadOne, fields })`), so the two steps are combined here.
//
// `Library` is 1:1 with a `User`, so its global id is the user id under a
// different type name. `loadOne` carries the exact same ownership rule as
// `User`'s `findUnique` (`isOwnerOrAdmin`) — without it `node(id:)` would be a
// second, ungated door onto the same object `User.library` already gates.
builder.node(model, {
  id: { resolve: (owner) => owner.userId },
  loadOne: (id, context) => {
    if (!isOwnerOrAdmin(context.viewer, id)) return null;
    return context.loadOwner(id);
  },
  fields: (t) => ({
    user: t.field({
      type: user.model,
      resolve: (owner, _args, context) =>
        context.prisma.user.findUniqueOrThrow({ where: { id: owner.userId } }),
    }),
  }),
});
