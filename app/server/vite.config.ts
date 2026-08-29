import { createRequire } from 'node:module';

import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

// The server is a Node/Express app with no Vite dev server or bundler — this
// config exists purely to drive Vitest (replacing the previous Jest setup).
export default defineConfig({
  resolve: {
    // `graphql` has no "exports" field, so Vite's SSR resolver picks its ESM
    // build while Node's require picks CJS — two GraphQLSchema classes, and
    // Pothos plugins that register at module scope land on the wrong instance.
    // Pin the bare specifier to the same file Node resolves.
    alias: [{ find: /^graphql$/, replacement: require.resolve('graphql') }],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Many suites spin up ephemeral Express servers via supertest. Under Vitest's
    // parallel file execution these occasionally hit a transient `read ECONNRESET`
    // on the loopback socket. Retry once so a transient reset doesn't fail CI;
    // a genuinely broken test still fails both attempts.
    retry: 1,
    // Reset every mock (implementation, queued once-behaviors, and call
    // history) before each test. vi.restoreAllMocks()+vi.clearAllMocks()
    // does NOT do this — restoreAllMocks() only reverts vi.spyOn() spies,
    // and clearAllMocks() drops call history but leaves queued
    // mockImplementationOnce/mockResolvedValueOnce entries and persistent
    // mockImplementation overrides intact, letting them leak into later
    // tests. mockReset does both, and restores a `vi.fn(impl)` factory back
    // to `impl`, which is the call-through default these suites rely on.
    mockReset: true,
  },
});
