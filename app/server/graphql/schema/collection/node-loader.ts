import type { Prisma } from '@prisma/client';

import type { Context } from '../../context';
import { NO_MATCH_USER_ID } from '../node-scope';

/**
 * Collection ids are opaque and globally unique, so the global ID carries no
 * userId to compare. Like `series/node-loader.ts`, the lookup is constrained
 * by the viewer's own userId (unconstrained for an admin), yielding null
 * rather than another user's row. See that file for why `isOwnerOrAdmin` is
 * deliberately not used.
 */
export const findUnique = (id: string, context: Context): Prisma.CollectionWhereUniqueInput => {
  const viewer = context.viewer;
  if (viewer === null) return { id, userId: NO_MATCH_USER_ID };
  if (viewer.isAdmin) return { id };
  return { id, userId: viewer.userId ?? NO_MATCH_USER_ID };
};
