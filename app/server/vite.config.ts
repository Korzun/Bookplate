import { defineConfig } from 'vitest/config';

// The server is a Node/Express app with no Vite dev server or bundler — this
// config exists purely to drive Vitest (replacing the previous Jest setup).
export default defineConfig({
  ssr: {
    // graphql ships both a CJS ("main") and ESM ("module") build with no
    // "exports" field to unify them. By default Vitest externalizes
    // node_modules packages, letting Node's native require pick the CJS
    // build for Pothos's internal `import ... from 'graphql'`, while a test
    // file's own `import ... from 'graphql'` gets Vite's ESM build instead.
    // That produces two distinct GraphQLSchema classes whose `instanceof`
    // checks against each other fail at runtime ("Cannot use GraphQLSchema
    // ... from another module or realm"). Forcing these packages through
    // Vite's transform pipeline (noExternal) makes every consumer resolve
    // the same module instance.
    //
    // 2026-07-31: Task 3 introduces three more Pothos plugins beyond Task 1's
    // spike (scope-auth, errors, validation). Each hits the identical
    // dual-module-instance hazard described above — its module-scope
    // `SchemaBuilder.registerPlugin(...)` call was landing on a different
    // `@pothos/core` instance than the builder imports, so the builder saw
    // "No plugin named scopeAuth was registered". Same root cause, same fix.
    //
    // A package-scope pattern (e.g. a `/^@pothos\//` RegExp, or Vitest's
    // `test.server.deps.inline`) would avoid growing this list on every new
    // Pothos plugin, and was tried first — see the fix-round-1 entry in
    // task-3-report.md for the specific variants attempted and why each
    // failed. In this Vite/Vitest version, a RegExp mixed into `noExternal`
    // alongside strings is silently never matched (only the string entries
    // take effect), and moving the same RegExp to `test.server.deps.inline`
    // instead reintroduces the exact dual-GraphQLSchema-instance failure this
    // list exists to prevent. Enumerating each plugin by exact string name is
    // the only variant that has been observed to work reliably, so it stays
    // enumerated. Add the new plugin's exact package name here when the next
    // Pothos plugin is introduced.
    noExternal: [
      'graphql',
      '@pothos/core',
      '@pothos/plugin-prisma',
      '@pothos/plugin-relay',
      '@pothos/plugin-scope-auth',
      '@pothos/plugin-errors',
      '@pothos/plugin-validation',
    ],
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
  },
});
