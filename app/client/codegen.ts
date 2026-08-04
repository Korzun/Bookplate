import type { CodegenConfig } from '@graphql-codegen/cli';

/**
 * Generates from the COMMITTED SDL artifact, never runtime introspection —
 * production introspection is disabled (NoSchemaIntrospectionCustomRule), so an
 * introspection-based generator only ever works against a dev server.
 *
 * `persistedDocuments` is a build/measurement artifact here, not a transport
 * feature: `mode` stays at its default `embedHashInDocument`, so the full
 * document remains in the bundle and the client keeps sending real queries.
 * The manifest exists so CI can measure and lint exactly what ships.
 * `hashAlgorithm` is pinned (rather than left to default) because it is a
 * cross-spec contract: spec 3 may adopt this manifest for trusted documents,
 * and yoga's default extractor reads `extensions.persistedQuery.sha256Hash`.
 */
const config: CodegenConfig = {
  schema: '../server/graphql/schema.generated.graphql',
  documents: ['src/**/*.{ts,tsx}', '!src/gql/**/*'],
  ignoreNoDocuments: false,
  generates: {
    'src/gql/': {
      preset: 'client',
      presetConfig: {
        persistedDocuments: { hashAlgorithm: 'sha256' },
      },
      config: {
        scalars: { DateTime: 'string', JSON: 'unknown' },
      },
    },
    'src/gql/possible-types.ts': {
      plugins: ['fragment-matcher'],
      config: { module: 'es2015' },
    },
  },
};

export default config;
