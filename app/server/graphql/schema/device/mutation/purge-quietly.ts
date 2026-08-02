import { logger } from '../../../../logger';

const log = logger('graphql-device-mutation');

/**
 * Best-effort edition-cache purge, mirroring `routes/devices.ts`'s identical
 * try/catch + `log.warn` around `editionStore.purgeForDevice`/
 * `purgeForDeviceAndUser` after `PATCH /:id`, `DELETE /:id` and
 * `DELETE /:id/users/:username` — a settings change or removal invalidates
 * any cached per-device (and per-device-per-user) edition, but REST never
 * fails the request over a cache-cleanup error: it logs a warning and
 * returns success regardless (`routes/devices.ts`'s three identical
 * `catch (err) { log.warn(...) }` blocks).
 *
 * The try/catch lives HERE, not in any resolver's `resolve` body — the same
 * pattern `book/mutation/replace.ts`'s `repairBestEffort` uses — so
 * "resolver bodies: zero try/catch/throw" holds literally, not just in
 * spirit. This is deliberately NOT a `toResult` site: `purgeForDevice`/
 * `purgeForDeviceAndUser` are not among the seven known store errors, and
 * REST's own guard never surfaces this failure to the caller at all (it
 * only logs and continues), so there is nothing for a result union to
 * discharge — swallowing it here is the honest mirror, not a shortcut.
 *
 * Three call sites (`update.ts`, `delete.ts`, `disable-user.ts`) share this
 * rather than each repeating the same eight-line try/catch — an intra-module
 * DRY helper, not a REST/GraphQL shared helper (`routes/devices.ts` itself
 * is untouched; this file has no REST counterpart).
 *
 * `label` matches the calling mutation's own name, so the log line stays
 * easy to correlate with which GraphQL operation triggered it (REST's own
 * warn lines are similarly prefixed with the route, e.g. `"PATCH /:id — ..."`).
 */
export async function purgeEditionsQuietly(label: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    log.warn(
      `${label} — edition-cache purge failed — ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
