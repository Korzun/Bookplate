import type { Prisma } from '@prisma/client';

import { ownerScopedFindUnique } from '../node-scope';

/**
 * Book's owner-scoped lookup. Without this, prismaNode takes the userId half of
 * the compound key from the caller's own global ID — a cross-tenant read for any
 * authenticated user. See the spec's resolved open question #1.
 */
export const findUnique = ownerScopedFindUnique<Prisma.BookWhereUniqueInput>((userId, id) => ({
  userId_id: { userId, id },
}));
