/**
 * The config-based admin's `users` row.
 *
 * Bookplate's admin is defined by the add-on options (`config.username` /
 * `config.password`) and has historically had NO row at all — `/api/login`
 * compares against the options before it touches Prisma, and
 * `RefreshToken.userId` is nullable precisely for it. That left nowhere to hang
 * an email address, a verification state, or notification preferences, which
 * is the only reason this row exists.
 *
 * THE ROW IS IDENTITY-ATTACHED DATA, NOT A PROMOTION. Three invariants keep it
 * that way, and each is load-bearing:
 *
 *  1. `passwordHash` and `syncPassword` stay NULL. The options remain the single
 *     credential; a hash here would be a second one that the options cannot
 *     rotate, and a sync password would grant OPDS/KOSync access the admin has
 *     never had (`authenticate` refuses a null sync password, which is the only
 *     thing denying it today).
 *  2. The admin's access token still carries no `sub`, so every path that
 *     reasons about ownership (`Viewer.library`, `Viewer.user`,
 *     `Viewer.syncPassword`, `loadOwner`) behaves exactly as before.
 *  3. Every user listing and every by-name mutation excludes the row, through
 *     `NOT_CONFIG_ADMIN` and `isConfigAdminRow` below. `user/mutation/delete.ts`
 *     and `user/mutation/reset-password.ts` used to get this for free — their doc
 *     comments argued that no `User` global ID could ever name the admin because
 *     it had no row. Creating the row invalidates that argument, so those
 *     mutations now need explicit guards.
 *
 * The exclusion is expressed ONCE, here, so that promoting the admin to an
 * ordinary user later (which needs a first-run onboarding flow this app does not
 * have — see the spec) is a change at one call site rather than an audit of every
 * query that touches users.
 */
import { PrismaClient } from '@prisma/client';

import { logger } from '../logger';
import { generateUserId } from '../utils/id';
import { isPrismaError } from './prisma-errors';

const log = logger('AdminAccount');

export const NOT_CONFIG_ADMIN = { isConfigAdmin: false } as const;

/**
 * Upserts the admin row and returns its id, or `null` when it refuses to act.
 * Four cases, in this order:
 *
 *  1. A row already marked `isConfigAdmin` with the right username — nothing to do.
 *  2. A row already marked `isConfigAdmin` under a DIFFERENT username — the
 *     operator changed `username` in the options. RENAMED, not re-created, so the
 *     address and preferences follow the account. A rename blocked by a
 *     collision leaves the row untouched and warns; the alternative (creating a
 *     second admin row) would silently split the identity in two.
 *  3. No marked row, but an unmarked row already bears the admin username. This
 *     can happen on a legacy database, but it can just as easily be a REAL
 *     user's row — a reader who happens to hold that username, or an operator
 *     who changed `username` in the add-on options and upgraded in the same
 *     step. Adopting it (as this used to) would destroy that user's argon2 hash
 *     and sync password unrecoverably: excluded from every listing and refused
 *     by `userDelete`/`userResetPassword` (both key off `isConfigAdmin`), the
 *     row could never be repaired, re-credentialed or deleted afterward. This
 *     is REFUSED, matching case 2's collision handling exactly — the two are
 *     the same operator error (a username collides with the admin's), and only
 *     the direction differed before. No row is created or modified; the caller
 *     gets `null` and the admin has no row until the operator resolves the
 *     collision (renaming whichever side is wrong) and restarts. Every email
 *     flow that needs a row degrades to "no such account" in consequence — see
 *     `resolveViewerUserId` and `computeMustSetEmail`, both of which already
 *     handle a missing row for other reasons.
 *  4. Nothing at all — created.
 */
export async function ensureAdminUser(
  prisma: PrismaClient,
  username: string
): Promise<string | null> {
  const marked = await prisma.user.findFirst({ where: { isConfigAdmin: true } });
  if (marked !== null) {
    if (marked.username === username) return marked.id;
    try {
      await prisma.user.update({ where: { id: marked.id }, data: { username } });
      log.info(`Admin row renamed from "${marked.username}" to "${username}"`);
    } catch (e) {
      if (!isPrismaError(e, 'P2002')) throw e;
      log.warn(
        `Cannot rename the admin row to "${username}" — another account already uses that ` +
          `username. Leaving it as "${marked.username}"; the admin still signs in with the ` +
          `add-on options credential.`
      );
    }
    return marked.id;
  }

  const legacy = await prisma.user.findUnique({ where: { username } });
  if (legacy !== null) {
    // C1: do NOT adopt. This row may belong to a real user, and adopting it
    // would clear its passwordHash/syncPassword irrecoverably — see the doc
    // comment above (case 3). Refuse exactly as case 2 refuses a blocked
    // rename: leave the row alone, create nothing, and tell the operator what
    // to do about it.
    log.error(
      `A row already exists with username "${username}" but is not marked as the admin ` +
        `account. Refusing to adopt it as the admin — doing so would permanently destroy its ` +
        `password and sync password. The admin has no account row until this is resolved: ` +
        `either rename that row (if it belongs to a real user) or change the "${username}" ` +
        `add-on option to a username that does not collide, then restart.`
    );
    return null;
  }

  const created = await prisma.user.create({
    data: {
      id: generateUserId(),
      username,
      passwordHash: null,
      syncPassword: null,
      isConfigAdmin: true,
    },
  });
  log.info(`Created the admin account row for "${username}"`);
  return created.id;
}

/** Guard for every mutation that resolves its target by id or by name. */
export async function isConfigAdminRow(prisma: PrismaClient, userId: string): Promise<boolean> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { isConfigAdmin: true },
  });
  return row?.isConfigAdmin === true;
}
