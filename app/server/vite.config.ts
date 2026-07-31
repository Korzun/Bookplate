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
    noExternal: ['graphql', '@pothos/core', '@pothos/plugin-prisma', '@pothos/plugin-relay'],
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
