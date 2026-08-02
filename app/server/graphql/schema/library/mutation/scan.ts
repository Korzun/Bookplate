import { logger } from '../../../../logger';
import { revalidateLibrary } from '../../../../services/revalidate-library';
import type { ScanJob } from '../../../../services/scan-events';
import type { Owner } from '../../../../types';
import { builder } from '../../builder';
import {
  scanAlreadyRunningError,
  model as scanAlreadyRunningErrorModel,
} from '../../scan-already-running-error/model';
import { model as scanStatus, type ScanStatusShape } from '../../scan-status/model';
import { model as user } from '../../user/model';
import { model as library } from '../model';

const log = logger('GraphQL:libraryScan');

/** `userId`, a `User` global ID per the spec's rule for every user-associated mutation. */
const input = builder.inputType('LibraryScanInput', {
  fields: (t) => ({
    userId: t.globalID({ required: true, for: user }),
  }),
});

type LibraryScanPayloadShape = {
  readonly __typename: 'LibraryScanPayload';
  readonly owner: Owner;
  readonly job: ScanJob;
};

const payload = builder.objectRef<LibraryScanPayloadShape>('LibraryScanPayload').implement({
  fields: (t) => ({
    scanStatus: t.field({
      type: scanStatus,
      resolve: (parent): ScanStatusShape => ({ owner: parent.owner, job: parent.job }),
    }),
    library: t.field({ type: library, resolve: (result) => result.owner }),
  }),
});

/**
 * No `resolveType`: every member value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 */
const result = builder.unionType('LibraryScanResult', {
  types: [payload, scanAlreadyRunningErrorModel],
});

/**
 * Mirrors `POST /api/books/scan` (`routes/ui.ts:1057-1090`).
 *
 * OWNER RESOLUTION: that route resolves its owner through the generic
 * `resolveOwner` (`routes/ui.ts:150-171`) — an admin session MUST supply
 * `?user=` (400 without it) and then acts on the named user; a non-admin
 * session always acts on itself. That is exactly the `ownerOf` shape every
 * other admin-widened mutation in this schema uses (`bookDelete`,
 * `bookUpdateMetadata`, …), unlike `progressSet`'s self-only shape — REST has
 * no admin exception carved out for scanning, so `ownerOf` is the correct
 * mirror here. `nullable: true` covers REST's "User not found" 404 for an
 * admin-named target that doesn't resolve, the same "no such row" convention
 * `bookDelete`/`deviceEnableUser` already use.
 *
 * 409: REST checks `scanJobStore.isRunning(owner.userId)` BEFORE starting
 * anything and responds with the in-flight job's own body — mirrored here as
 * `ScanAlreadyRunningError`, an honest typed member carrying that same job
 * (see that type's doc comment), not a fabricated validation error.
 *
 * FIRE-AND-FORGET: REST responds 202 with the just-`start()`ed job and runs
 * the scan (plus `revalidateLibrary` and `thumbnailQueue.reconcile`) in a
 * detached `void (async () => { ... })()`, never awaited by the request
 * handler — the client polls `/api/books/scan/status` for completion. This
 * resolver mirrors that exactly: it returns `LibraryScanPayload` the instant
 * `start()` produces a job, and performs the scan/revalidate/reconcile
 * pipeline in the same kind of detached `void` block, updating `scanJobStore`
 * via `complete`/`fail` when it eventually settles — a client observes that
 * settling through `Library.scanStatus`/`scanProgress` (both task 9), not
 * through this mutation's own return value.
 *
 * `onProgress` is wired through to `scanJobStore.progress` so the job's
 * `total`/`processed`/`phase`/`currentFile`/`importedBookIds` stay current
 * while the scan runs — consumed by task 9's `scanStatus` query and
 * `scanProgress` subscription, not by anything in this task.
 *
 * Not wrapped in `toResult`: `BookStore.scan()` throws none of the seven
 * known store errors (it catches and logs per-file failures itself, same as
 * `revalidateBook`'s per-book catch) — any throw that does escape the
 * detached block is a genuine unexpected fault, mirrored into the job via
 * `fail()` exactly as REST's own `catch (err: unknown)` does, not into a
 * typed union member.
 */
builder.mutationField('libraryScan', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Starts a library scan in the background. Resolves to null when the ' +
      'resolved owner does not exist.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: (_parent, args) => ({ ownerOf: args.input.userId.id }),
    resolve: async (_parent, args, context) => {
      const owner = await context.loadOwner(args.input.userId.id);
      if (owner === null) return null;

      const { scanJob, book, validation, thumbnail } = context.stores;

      if (scanJob.isRunning(owner.userId)) {
        const running = scanJob.get(owner.userId);
        // isRunning() being true guarantees get() is defined — both read the
        // same Map entry, with nothing async between them to race.
        return scanAlreadyRunningError(owner, running as ScanJob);
      }

      const job = scanJob.start(owner.userId);

      void (async () => {
        try {
          const scanResult = await book.scan(owner, undefined, (progress) => {
            scanJob.progress(owner.userId, progress);
          });
          const val = await revalidateLibrary(
            {
              bookStore: book,
              validationStore: validation,
              validationThreshold: context.config.validationThreshold,
            },
            owner
          );
          await thumbnail.reconcile();
          log.info(
            `Scan: ${scanResult.imported.length} imported, ${scanResult.removed.length} removed, ` +
              `${val.validated} validated (${val.failed} failed)`
          );
          scanJob.complete(owner.userId, scanResult);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          log.error(`Scan failed for "${owner.username}": ${message}`);
          scanJob.fail(owner.userId, message);
        }
      })();

      return {
        __typename: 'LibraryScanPayload' as const,
        owner,
        job,
      };
    },
  })
);
