import * as path from 'path';

/**
 * Walks from a module's directory up to the server workspace root
 * (`app/server`), which is the anchor every "where does X live on disk"
 * question in this package should be answered from.
 *
 * Exists because the server runs under two different on-disk layouts, and a
 * hand-written relative path is correct for exactly one of them:
 *
 *   production  `app/server/dist/…` (tsconfig `outDir: ./dist`, `rootDir: .`)
 *   development `app/server/…`      (`npm run dev` runs the TS directly via tsx)
 *
 * The compiled tree is one directory deeper, so the two differ by exactly one
 * `..`. That one segment has bitten this codebase twice:
 *
 *   - `routes/ui.ts` carried `'../../../client/dist'` twice. Right in
 *     production; in dev it resolved to `<repo>/client/dist`, a path that has
 *     never existed, so every HTML GET the dev API server handled died on an
 *     unhandled ENOENT and a generic 500.
 *   - `index.ts` did `import packageJson from '../../package.json'`. Right
 *     from source; compiled it resolved to `app/package.json`, so the built
 *     server could not start at all. That went unnoticed for as long as it did
 *     because the Dockerfile papered over it by copying the workspace
 *     package.json to that exact wrong path.
 *
 * Deciding the layout from the server's own position — the parent of a module
 * in `utils/` is `dist/` only in the compiled build — rather than probing for
 * the target keeps this honest for targets that legitimately may not exist yet
 * (`app/client/dist` in development) and depends on nothing outside this
 * workspace.
 *
 * Exported (and taking `moduleDir` rather than closing over `__dirname`) so
 * both layouts are directly testable from either one.
 */
export function serverRootFrom(moduleDir: string): string {
  return path.basename(path.dirname(moduleDir)) === 'dist'
    ? path.join(moduleDir, '..', '..') // compiled: server/dist/utils → server
    : path.join(moduleDir, '..'); // dev (tsx):  server/utils      → server
}

/**
 * The server workspace root, `app/server`.
 *
 * Correct for every module in this directory, which is why the path helpers
 * that need it live here alongside it rather than each redoing the walk.
 */
export const SERVER_ROOT = serverRootFrom(__dirname);

/**
 * The npm workspace root — the directory holding the root `package.json` that
 * declares `app/server` and `app/client` as workspaces, and `app/` itself.
 *
 * `<repo>` in a checkout; `/bookplate` in the container image, where the
 * Dockerfile reproduces the same `app/server`, `app/client` shape under
 * WORKDIR.
 */
export const WORKSPACE_ROOT = path.join(SERVER_ROOT, '..', '..');
