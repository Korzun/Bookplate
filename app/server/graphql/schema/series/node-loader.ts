import type { Prisma } from '@prisma/client';

import type { Context } from '../../context';
import { NO_MATCH_USER_ID } from '../node-scope';

/**
 * Series ids are opaque and unique globally, so the global ID carries no userId
 * to compare. The guard therefore constrains the lookup by the viewer's own
 * userId (or leaves it unconstrained for an admin), which yields null rather
 * than another user's row.
 *
 * `SeriesWhereUniqueInput` is `Prisma.AtLeast<{ id?, userId?, ... }, "id" |
 * "userId_name">` — Prisma's "extended where unique input" feature (stable
 * since Prisma 4.16, no preview flag) lets a `findUnique` combine one unique
 * field (`id`) with additional plain filter fields (`userId`) that further
 * constrain the match rather than participating in the uniqueness lookup
 * itself. So `{ id, userId }` typechecks as-is — no cast needed — and at
 * runtime a row whose `id` matches but whose `userId` doesn't returns null,
 * exactly like `ownerScopedFindUnique`'s compound-key denial branch.
 *
 * Deliberately does NOT call `isOwnerOrAdmin` (node-scope.ts), unlike every
 * other node-level guard in this codebase. `isOwnerOrAdmin(viewer, userId)`
 * answers "may this viewer act on data owned by *this claimed* userId" — it
 * needs a candidate owner to test against, parsed or read for free before any
 * database access (`User`'s id IS the userId; `Library`'s too;
 * `ownerScopedFindUnique` decodes one out of the compound id). `Series`'s
 * plain `@id` carries no such claim — the only userId available here is the
 * viewer's own, used to scope the WHERE clause, not to compare against a
 * claim extracted from the id. Calling `isOwnerOrAdmin(viewer,
 * viewer.userId)` would be a tautology, not a use of the shared rule, so this
 * builds the clause directly instead. See node-scope.ts's doc comment on
 * `isOwnerOrAdmin` for the same note from the other side.
 */
export const findUnique = (id: string, context: Context): Prisma.SeriesWhereUniqueInput => {
  const viewer = context.viewer;
  if (viewer === null) return { id, userId: NO_MATCH_USER_ID };
  if (viewer.isAdmin) return { id };
  return { id, userId: viewer.userId ?? NO_MATCH_USER_ID };
};
