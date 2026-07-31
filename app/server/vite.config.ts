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
    // list exists to prevent.
    //
    // 2026-07-31 (Task 4): re-tried an all-RegExp array —
    // `[/^graphql/, /^@graphql-tools\//, /^@pothos\//]` — covering `graphql`
    // itself this time (the earlier attempt above had dropped it, which was
    // never a fair test). It fixed graphql-yoga's dual-instance hazard, but
    // regressed 5 previously-passing tests elsewhere in this same workspace
    // (graphql/prisma-node.spike.test.ts and
    // graphql/schema/viewer/query/current.test.ts), each failing with the
    // identical "Cannot use GraphQLSchema ... from another module or realm"
    // error the regex was supposed to prevent — Vite's noExternal regex
    // matching in this version is not equivalent to the enumerated string
    // list even when it does get applied (unlike the mixed-array case, where
    // it silently no-ops). So the regex approach is not a safe drop-in;
    // discovered only by running the *full* suite, not just the GraphQL
    // tests — a narrower check would have looked green. Enumerating each
    // package by exact string name is the only variant that has been
    // observed to work reliably across the whole suite, so it stays
    // enumerated. Add the new dependency's exact package name here whenever
    // something new imports `graphql` and hits this same hazard (most
    // recently `graphql-yoga` and its default executor's `@graphql-tools/executor`,
    // for Task 4's HTTP mount).
    noExternal: [
      'graphql',
      '@pothos/core',
      '@pothos/plugin-prisma',
      '@pothos/plugin-relay',
      '@pothos/plugin-scope-auth',
      '@pothos/plugin-errors',
      '@pothos/plugin-validation',
      'graphql-yoga',
      '@graphql-tools/executor',
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
