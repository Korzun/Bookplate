import { builder } from '../../builder';
import { model } from '../index';

/**
 * Mirrors `GET /api/config` (`routes/ui.ts`): `requireAuth` and nothing more —
 * every authenticated viewer, admin or not, gets the same two values. The
 * builder's default `authenticated` scope on the query type already supplies
 * that gate, so no field-level scope is needed or wanted here.
 *
 * Distinct from `GET /api/public-config`, which returns `libraryName` alone
 * with no auth at all and stays REST permanently — the login page fetches it
 * before a token exists, so it cannot be a GraphQL field (see the spec's "Out
 * of scope" section).
 *
 * PLACEMENT — a root field rather than a field on `Viewer`. These are
 * server-wide values, identical for every viewer; hanging them off `Viewer`
 * would imply they vary per viewer, and would force the upload page (the only
 * consumer, for `maxConcurrentUploads`) to fetch a `Viewer` it does not
 * otherwise need. `Config` is not a `Node`: there is one of it, reached by one
 * path, so a global ID would be a second door onto a singleton.
 *
 * Resolves into a fresh narrowed object rather than handing back
 * `context.config` itself, so the secret-bearing `AppConfig` (it holds the
 * admin `password`) is never the parent value a future field could read from.
 */
builder.queryField('config', (t) =>
  t.field({
    type: model,
    resolve: (_parent, _args, context) => ({
      libraryName: context.config.libraryName,
      maxConcurrentUploads: context.config.maxConcurrentUploads,
    }),
  })
);
