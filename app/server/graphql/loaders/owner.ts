import type { PrismaClient } from '@prisma/client';

import type { Owner } from '../../types';

export type OwnerLoader = (userId: string) => Promise<Owner | null>;

/**
 * Resolves a userId to a full Owner (userId + username), memoized for the life
 * of one request. The username is needed because the books directory on disk is
 * named by it, so nearly every Library field wants this — without memoization
 * a single query would repeat the same lookup dozens of times.
 *
 * A fresh loader is built per request in createContext; it is never shared
 * across requests, so a renamed or deleted user cannot be served from a stale
 * entry.
 */
export const createOwnerLoader = (prisma: PrismaClient): OwnerLoader => {
  const cache = new Map<string, Promise<Owner | null>>();

  return (userId: string): Promise<Owner | null> => {
    const cached = cache.get(userId);
    if (cached !== undefined) return cached;

    const pending = prisma.user
      .findUnique({ where: { id: userId }, select: { id: true, username: true } })
      .then((row) => (row === null ? null : { userId: row.id, username: row.username }));

    cache.set(userId, pending);
    return pending;
  };
};
