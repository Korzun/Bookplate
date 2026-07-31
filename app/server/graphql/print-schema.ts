import * as fs from 'fs';
import * as path from 'path';

import { lexicographicSortSchema, printSchema, type GraphQLSchema } from 'graphql';

export const ARTIFACT_PATH = path.join(__dirname, 'schema.generated.graphql');

export const printSchemaToString = (schema: GraphQLSchema): string =>
  `${printSchema(lexicographicSortSchema(schema)).trimEnd()}\n`;

/**
 * CLI entry point. With --check it exits non-zero when the committed artifact
 * has drifted from the built schema; without it, it rewrites the artifact.
 *
 * Printing lives in a script rather than at schema-module scope on purpose:
 * writing a file as a side effect of importing the schema would fire on every
 * test run and on production startup.
 */
const main = async (): Promise<void> => {
  const { schema } = await import('./schema');
  const printed = printSchemaToString(schema);

  if (process.argv.includes('--check')) {
    const existing = fs.existsSync(ARTIFACT_PATH) ? fs.readFileSync(ARTIFACT_PATH, 'utf-8') : '';
    if (existing !== printed) {
      console.error(
        `GraphQL schema artifact is out of date.\n  Expected: ${ARTIFACT_PATH}\n  Run: npm run graphql:schema -w app/server`
      );
      process.exit(1);
    }
    return;
  }

  fs.writeFileSync(ARTIFACT_PATH, printed);
  console.log(`Wrote ${ARTIFACT_PATH}`);
};

if (require.main === module) {
  void main();
}
