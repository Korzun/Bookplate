import * as fs from 'fs';
import * as path from 'path';

import { logger } from '../logger';
import { WORKSPACE_ROOT } from './server-root';

const log = logger('Server');

/** Reported when the workspace package.json cannot be read — see below. */
export const UNKNOWN_VERSION = 'unknown';

/** The package.json whose `version` the app reports as its own. */
export const WORKSPACE_PACKAGE_JSON = path.join(WORKSPACE_ROOT, 'package.json');

/**
 * Reads the `version` field out of a package.json, or null if it cannot be
 * had for any reason (absent, unreadable, malformed, no `version`, `version`
 * not a string).
 *
 * Deliberately total rather than throwing. Every one of those cases means a
 * broken deployment, but the value feeds exactly one cosmetic thing — the
 * `Bookplate v… starting` line in `startup.ts` — and a server that refuses to
 * boot because it cannot label its own log line is strictly worse than one
 * that boots and says so. That is not hypothetical: this replaces
 * `import packageJson from '../../package.json'` in `index.ts`, which did
 * exactly that, taking the whole process down with MODULE_NOT_FOUND.
 */
export function readVersionFrom(packageJsonPath: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const version = (parsed as { version?: unknown }).version;
  return typeof version === 'string' ? version : null;
}

/**
 * The running app's version.
 *
 * Read at runtime through `WORKSPACE_ROOT` rather than `import`ed, because a
 * bare `import '../../package.json'` is resolved relative to the emitting
 * file and so cannot be right for both layouts at once: correct from
 * `app/server/index.ts`, it becomes `app/package.json` from
 * `app/server/dist/index.js`. `npm run build && npm start` therefore never
 * worked from a checkout, and the container image only worked because the
 * Dockerfile copied the workspace package.json to that wrong path to satisfy
 * it. Reading the resolved path ourselves removes both the breakage and the
 * workaround. See `server-root.ts`.
 */
const resolved = readVersionFrom(WORKSPACE_PACKAGE_JSON);
if (resolved === null) {
  log.warn(
    `Could not read a version from ${WORKSPACE_PACKAGE_JSON} — reporting "${UNKNOWN_VERSION}". This points at a packaging problem; the server is otherwise unaffected.`
  );
}
export const APP_VERSION = resolved ?? UNKNOWN_VERSION;
