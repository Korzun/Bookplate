/**
 * The acting account's row id.
 *
 * `viewer.userId` is null for the config-based admin — its access token
 * deliberately carries no `sub`, so that every ownership path keeps behaving
 * as it did before the admin had a row at all. Every email mutation needs a
 * row id to key `EmailToken`, so all three resolve it through here rather
 * than each re-deriving the fallback.
 *
 * Delegates to `resolveViewerRow` (I3, whole-branch review) rather than
 * looking the admin up by `viewer.username` itself — see that module's doc
 * comment for why a username lookup can resolve to the WRONG row.
 */
import type { Context } from '../../../context';
import { resolveViewerRow } from '../resolve-row';

export async function resolveViewerUserId(context: Context): Promise<string | null> {
  const row = await resolveViewerRow(context, { id: true });
  return row?.id ?? null;
}
