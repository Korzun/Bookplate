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
 */
export const findUnique = (id: string, context: Context): Prisma.SeriesWhereUniqueInput => {
  const viewer = context.viewer;
  if (viewer === null) return { id, userId: NO_MATCH_USER_ID };
  if (viewer.isAdmin) return { id };
  return { id, userId: viewer.userId ?? NO_MATCH_USER_ID };
};
