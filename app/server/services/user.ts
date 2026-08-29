import { PrismaClient } from '@prisma/client';

import { logger } from '../logger';
import { generateUserId } from '../utils/id';
import { purgeForUser } from './edition';
import { generateSyncPassword } from './password';
import { isPrismaError } from './prisma-errors';

const log = logger('user');

/**
 * Creates a user account. Returns `false` on a `P2002` unique-constraint
 * collision (duplicate username) rather than throwing — every caller treats
 * that as an ordinary "already exists" outcome, not an error.
 */
export async function createUser(
  prisma: PrismaClient,
  username: string,
  passwordHash: string | null,
  syncPassword?: string,
  mustChangePassword?: boolean
): Promise<boolean> {
  try {
    await prisma.user.create({
      data: {
        id: generateUserId(),
        username,
        passwordHash,
        syncPassword: syncPassword ?? generateSyncPassword(),
        mustChangePassword: mustChangePassword ?? false,
      },
    });
    return true;
  } catch (e) {
    if (isPrismaError(e, 'P2002')) {
      return false;
    }
    throw e;
  }
}

/**
 * Deletes a user account (`P2025` — no such username — returns `false`
 * rather than throwing) and best-effort purges that user's cached device
 * editions. The purge failing does not fail the delete: the DB row is
 * already gone by the time it runs, and a stale edition cache file left
 * behind is a cleanup problem, not a correctness one.
 */
export async function deleteUser(
  prisma: PrismaClient,
  editionsRoot: string,
  username: string
): Promise<boolean> {
  let userId: string;
  try {
    const deleted = await prisma.user.delete({ where: { username } });
    userId = deleted.id;
  } catch (e) {
    if (isPrismaError(e, 'P2025')) {
      return false;
    }
    throw e;
  }
  try {
    await purgeForUser(prisma, editionsRoot, userId);
  } catch (err) {
    log.warn(
      `deleteUser: edition-cache purge failed for "${userId}" — ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return true;
}
