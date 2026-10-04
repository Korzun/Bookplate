import * as fs from 'fs';
import * as path from 'path';

import { SERVER_ROOT } from './server-root';

/**
 * The built client's output directory, `app/client/dist` — the single source
 * of truth for it, replacing the two hand-written `'../../../client/dist'`
 * strings `routes/ui.ts` used to carry.
 *
 * See `server-root.ts` for why this is anchored on `SERVER_ROOT` rather than
 * spelled relative to the importing module, and for the bug that cost.
 */
export const CLIENT_DIST_DIR = path.join(SERVER_ROOT, '..', 'client', 'dist');

/** The SPA shell every non-API GET route serves. */
export const CLIENT_INDEX_HTML = path.join(CLIENT_DIST_DIR, 'index.html');

/**
 * Checked per request rather than once at startup, so that a dev server which
 * was already running when the client got built starts serving it without a
 * restart. That is not a micro-optimisation but the thing that makes
 * `CLIENT_NOT_BUILT_MESSAGE`'s instruction honest: it tells the reader to run
 * the build, and following it has to be enough.
 */
export function clientIndexExists(): boolean {
  return fs.existsSync(CLIENT_INDEX_HTML);
}

/**
 * The response body for "the SPA was asked for and there is no SPA on disk".
 *
 * This is the NORMAL state of the dev API server, not an anomaly, which is why
 * it gets a deliberate answer instead of being left to surface as the unhandled
 * ENOENT it used to be. A stack trace and `{"error":"Internal server error"}`
 * both describe a server bug; this is a missing build step, and the two want
 * very different things from whoever is reading.
 */
export const CLIENT_NOT_BUILT_MESSAGE = [
  'Client not built.',
  '',
  `This server serves the web UI from ${CLIENT_DIST_DIR}, which has no index.html.`,
  'Build it with:  npm run build -w app/client',
  '',
  'In development the UI is normally served by vite on :5173, which proxies',
  '/api and /graphql here — open that instead of this port.',
].join('\n');
