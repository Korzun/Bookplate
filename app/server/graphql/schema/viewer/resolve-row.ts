/**
 * The viewer's own `users` row — resolved the way every identity-bearing
 * field must (I3, whole-branch review): by `userId` when the token carries
 * one, and by the `isConfigAdmin` flag when it doesn't, NEVER by username.
 *
 * A username lookup looks right and is wrong: `ensureAdminUser`'s rename can
 * be blocked by a collision (`services/admin-account.ts`, case 2 — still
 * possible after this branch's C1 fix, which only closed case 3's adoption
 * path), leaving the marked admin row under its OLD username while
 * `config.username` now names an unrelated reader's row. `viewer.username` on
 * the admin's token is always `config.username` (`/api/login` sets it from
 * the config value it just matched, not from the DB row), so a
 * `where: { username: viewer.username }` lookup silently resolves the ADMIN's
 * session to that reader's row — reading their address, and (via
 * `viewerSetEmail`/`viewerConfirmEmail`) writing to and verifying it.
 *
 * `viewer.userId` is null only for the config-based admin (`Context`'s own
 * doc comment) — reached past that branch, this IS the admin, resolved by
 * the flag `ensureAdminUser` sets rather than by name.
 */
import type { Prisma } from '@prisma/client';

import type { Context } from '../../context';
import { requireViewer } from '../../context';

export async function resolveViewerRow<T extends Prisma.UserSelect>(
  context: Context,
  select: T
): Promise<Prisma.UserGetPayload<{ select: T }> | null> {
  const viewer = requireViewer(context);
  if (viewer.userId !== null) {
    return context.prisma.user.findUnique({ where: { id: viewer.userId }, select });
  }
  return context.prisma.user.findFirst({ where: { isConfigAdmin: true }, select });
}
