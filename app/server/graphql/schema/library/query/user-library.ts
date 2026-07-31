import { builder } from '../../builder';
import { model as user } from '../../user';
import { model as library } from '../index';

// `ownerOf`'s denial branch has no reachable case today: `Query.user` is
// admin-gated and `Query.node` for `User` is `isOwnerOrAdmin`-gated, so the
// only `User` object a non-admin viewer can ever hold here is their own. This
// scope is defense-in-depth, not dead code — it becomes load-bearing the
// moment a non-admin-reachable path to another user's `User` object exists.
builder.objectField(user, 'library', (t) =>
  t.field({
    type: library,
    authScopes: (parent) => ({ ownerOf: parent.id }),
    resolve: (parent) => ({ userId: parent.id, username: parent.username }),
  })
);
