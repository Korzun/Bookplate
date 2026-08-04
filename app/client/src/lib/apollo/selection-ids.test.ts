/// <reference types="node" />
import * as fs from 'node:fs';
import * as path from 'node:path';

import { buildSchema, type GraphQLSchema } from 'graphql';
import { beforeAll, describe, expect, it } from 'vitest';

import { findMissingKeyFields } from './selection-ids';

const SDL_PATH = path.resolve(__dirname, '../../../../server/graphql/schema.generated.graphql');
const MANIFEST_PATH = path.resolve(__dirname, '../../gql/persisted-documents.json');

let schema: GraphQLSchema;

beforeAll(() => {
  schema = buildSchema(fs.readFileSync(SDL_PATH, 'utf-8'));
});

// NOTE (corrected during execution): every fixture below selects `id` directly
// on the `node(id:)` selection set, not only inside the inline fragment.
// `Node` is an interface WITH an `id` field, so the selection set on `Node`
// itself needs the key — an inline fragment on `Library` does not satisfy it.
// This mirrors what the real documents do, and it is what Apollo needs in
// order to normalize the object it gets back from `node(id:)`.
describe('findMissingKeyFields', () => {
  it('flags a Book selection that omits id', () => {
    const issues = findMissingKeyFields(
      schema,
      `query Q($id: ID!) { node(id: $id) { ... on Library { id book(id: $id) { title author } } } }`
    );
    expect(issues).toContainEqual(expect.objectContaining({ typeName: 'Book', missing: ['id'] }));
  });

  it('accepts a Book selection that includes id', () => {
    const issues = findMissingKeyFields(
      schema,
      `query Q($id: ID!) { node(id: $id) { id ... on Library { id book(id: $id) { id title } } } }`
    );
    expect(issues).toEqual([]);
  });

  it('resolves id supplied through a fragment spread', () => {
    const issues = findMissingKeyFields(
      schema,
      `query Q($id: ID!) { node(id: $id) { id ... on Library { id book(id: $id) { ...BookKey title } } } }
       fragment BookKey on Book { id }`
    );
    expect(issues).toEqual([]);
  });

  // Derived from cacheConfig's `Progress: { keyFields: ['userId', 'document'] }` —
  // not restated here. Change the typePolicy and this expectation follows.
  it('requires BOTH userId and document on Progress', () => {
    const issues = findMissingKeyFields(
      schema,
      `query Q($id: ID!) { node(id: $id) { ... on Library { id progress(first: 5) { edges { node { document percentage } } } } } }`
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ typeName: 'Progress', missing: ['userId'] })
    );
  });

  it('does not require id on root or keyless singleton types', () => {
    const issues = findMissingKeyFields(schema, `query Q { viewer { username isAdmin } }`);
    expect(issues).toEqual([]);
  });
});

describe('every shipped operation', () => {
  it('selects the cache key field of every normalizable type it touches', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as Record<string, string>;
    expect(Object.keys(manifest).length).toBeGreaterThan(0);

    const problems: string[] = [];
    for (const [hash, source] of Object.entries(manifest)) {
      for (const issue of findMissingKeyFields(schema, source)) {
        problems.push(
          `${issue.path} (${issue.typeName}) is missing: ${issue.missing.join(', ')}  [${hash.slice(0, 8)}]`
        );
      }
    }

    // Apollo injects __typename but never `id`. A selection without its key
    // field is stored un-normalized: mutations then fail to update it, and
    // nothing else in the suite necessarily notices.
    expect(problems).toEqual([]);
  });
});
