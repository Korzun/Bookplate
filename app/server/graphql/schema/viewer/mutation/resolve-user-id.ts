/**
 * The acting account's row id.
 *
 * `viewer.userId` is null for the config-based admin — its access token
 * deliberately carries no `sub`, so that every ownership path keeps behaving as
 * it did before the admin had a row at all. The admin DOES now have a row (it is
 * where its address lives), reachable only by username. Every email mutation
 * needs a row id to key `EmailToken`, so all three resolve it through here
 * rather than each re-deriving the fallback.
 */
import type { Context } from '../../../context';
import { requireViewer } from '../../../context';

export async function resolveViewerUserId(context: Context): Promise<string | null> {
  const viewer = requireViewer(context);
  if (viewer.userId !== null) return viewer.userId;
  const row = await context.prisma.user.findUnique({
    where: { username: viewer.username },
    select: { id: true },
  });
  return row?.id ?? null;
}
