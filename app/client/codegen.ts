import { addTypenameSelectionDocumentTransform } from '@graphql-codegen/client-preset';
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
 *
 * `documentTransforms: [addTypenameSelectionDocumentTransform]` makes the
 * generated types agree with what Apollo Client actually sends: v4 injects
 * `__typename` into every selection set at runtime regardless of what the
 * source `.graphql` document spells out. Without this, generated types omit
 * `__typename`, which both pushes typed-mock authors away from including it
 * (so a cache-normalization test can pass while testing nothing — MockLink
 * silently fails to normalize a result missing `__typename`) and makes the
 * persisted-documents manifest record a query that isn't the one sent over
 * the wire, which would corrupt a later cost-measurement guardrail.
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
      documentTransforms: [addTypenameSelectionDocumentTransform],
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
