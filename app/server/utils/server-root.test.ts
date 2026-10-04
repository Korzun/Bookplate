import * as path from 'path';

import { serverRootFrom, SERVER_ROOT, WORKSPACE_ROOT } from './server-root';

describe('serverRootFrom', () => {
  // The bug class this pins, twice over: `routes/ui.ts` reaching for the client
  // build and `index.ts` reaching for the workspace package.json both spelled a
  // relative walk that was correct under exactly one of the two layouts.
  it('resolves the server root from the compiled layout (server/dist/utils)', () => {
    expect(serverRootFrom(path.join('/srv', 'app', 'server', 'dist', 'utils'))).toBe(
      path.join('/srv', 'app', 'server')
    );
  });

  it('resolves the server root from the source layout run by tsx (server/utils)', () => {
    expect(serverRootFrom(path.join('/srv', 'app', 'server', 'utils'))).toBe(
      path.join('/srv', 'app', 'server')
    );
  });

  it('is not confused by a checkout whose own path contains a "dist" segment', () => {
    expect(serverRootFrom(path.join('/dist', 'app', 'server', 'utils'))).toBe(
      path.join('/dist', 'app', 'server')
    );
  });
});

describe('the derived roots', () => {
  // Derived from the test runner's cwd (the server workspace — see the repo's
  // documented `cd app/server && npm test`) rather than from this file's own
  // __dirname, so these are independent checks and not copies of the walk
  // under test.
  it('SERVER_ROOT is the server workspace', () => {
    expect(SERVER_ROOT).toBe(path.resolve(process.cwd()));
  });

  it('WORKSPACE_ROOT is the npm workspace root two levels above it', () => {
    expect(WORKSPACE_ROOT).toBe(path.resolve(process.cwd(), '../..'));
  });
});
