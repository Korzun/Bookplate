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
 * **`label` and `detail` together reproduce REST's full warn text (review,
 * task 7, M-1 — the original version dropped the ids entirely; the doc
 * comment here used to claim the two log lines were "similarly prefixed",
 * which was true but silently omitted that REST's warns also carry the
 * id(s) — this fixes both the code and the overclaiming comment).** REST's
 * three warns are:
 *   - `` `PATCH /:id — edition-cache purge failed for device "${existing.id}" — …` ``
 *   - `` `DELETE /:id — edition-cache purge failed for device "${existing.id}" — …` ``
 *   - `` `DELETE /:id/users/:username — edition purge failed for device
 *     "${device.id}" user "${userId}" — …` ``
 * `label` supplies the mutation-name prefix (REST's route), and `detail`
 * supplies the id(s) — `` `device "${id}"` `` or `` `device "${id}" user
 * "${userId}"` `` — so an operator reading a GraphQL warn can tell exactly
 * which device's (and, for the pair case, which user's) cache is now stale,
 * the same as reading REST's own log line would.
 */
export async function purgeEditionsQuietly(
  label: string,
  detail: string,
  run: () => Promise<void>
): Promise<void> {
  try {
    await run();
  } catch (err) {
    log.warn(
      `${label} — edition-cache purge failed for ${detail} — ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
