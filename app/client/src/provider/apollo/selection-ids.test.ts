/// <reference types="node" />
import * as fs from 'node:fs';
import * as path from 'node:path';

import { buildSchema, type GraphQLSchema } from 'graphql';
import { beforeAll, describe, expect, it } from 'vitest';

// The manifest is loaded as a JSON module (not via `fs`), which always
// reflects the real committed `persisted-documents.json`.
//
// The SDL is still read via `fs`/`path`, and the triple-slash `node`
// reference below is what makes `__dirname` and `node:fs`/`node:path`
// typecheck. Tried loading the SDL with Vite's `?raw` import instead (typed
// by `vite/client`, already in tsconfig's `types`), but Vite's dev-server
// file-serving guard rejects it: `schema.generated.graphql` lives in
// `app/server`, outside `app/client`'s project root, so the transform fails
// with `Error: Denied ID .../app/server/graphql/schema.generated.graphql?raw`.
// Widening `server.fs.allow` to reach across workspaces felt like a bigger,
// less obviously-scoped change than keeping this one `fs.readFileSync` call,
// so the directive stays for this file's SDL read.
//
// IMPORTANT for the next reader: `/// <reference types="node" />` is NOT
// scoped to this file. A global (non-module) `.d.ts` reference pulls Node's
// ambient globals into the WHOLE program being type-checked by `tsc`, no
// matter which file's directive triggered it — that is standard TypeScript
// behaviour, not a bug. It defeats `app/client/tsconfig.json` restricting
// `types` to `["vitest/globals", "vite/client"]`, just less discoverably
// than widening that array would (a reader auditing tsconfig won't find this
// as the cause). If a stricter boundary is ever needed, prefer removing this
// import in favor of another `?raw`-style approach with a workspace-level
// `fs.allow` change made deliberately, not restoring this directive.
import manifestJson from '../../gql/persisted-documents.json';
import { findMissingKeyFields } from './selection-ids';

const SDL_PATH = path.resolve(__dirname, '../../../../server/graphql/schema.generated.graphql');
const manifest = manifestJson as Record<string, string>;

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

  // `Book implements Node`, so a fragment declared on the abstract `Node`
  // interface legally supplies `Book`'s own `id` requirement when spread into
  // a Book selection. This must NOT be flagged.
  it('resolves id supplied through a fragment on an interface the type implements', () => {
    const issues = findMissingKeyFields(
      schema,
      `query Q($id: ID!) { node(id: $id) { id ... on Library { id book(id: $id) { ...NodeId title } } } }
       fragment NodeId on Node { id }`
    );
    expect(issues).toEqual([]);
  });

  // Derived from cacheConfig's default `id` keying for `Progress` — not
  // restated here. Change the typePolicy and this expectation follows.
  it('requires id on Progress', () => {
    const issues = findMissingKeyFields(
      schema,
      `query Q($id: ID!) { node(id: $id) { ... on Library { id progress(first: 5) { edges { node { document percentage } } } } } }`
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ typeName: 'Progress', missing: ['id'] })
    );
  });

  it('does not require id on root or keyless singleton types', () => {
    const issues = findMissingKeyFields(schema, `query Q { viewer { username isAdmin } }`);
    expect(issues).toEqual([]);
  });

  // I-1: `keyFieldsFor`'s composite-array branch (an explicit `keyFields:
  // ['a', 'b']`) was, until this test, exercised by nothing — `Progress` was
  // the only non-empty-array `keyFields` in the real `cacheConfig`, and it was
  // deleted when `Progress` moved to default `id` keying. `Viewer`/`Config`
  // are both `keyFields: []`, which is a different branch entirely. A
  // synthetic policy here (not added to the real `cacheConfig`, which has no
  // genuinely composite-keyed type) is the only way to cover this branch:
  // pass it as `findMissingKeyFields`'s third argument. `Device` is a real
  // schema type with two plain string fields (`id`, `name`) to select from.
  //
  // SEEN-TO-FAIL: mutating `keyFieldsFor`'s composite-array branch to
  // `return []` (the mutant the reviewer verified leaves all 1012 real
  // client tests green) makes this test fail — see the fix report for the
  // captured output.
  it('flags a selection missing one field of a synthetic composite key', () => {
    const syntheticPolicies = { Device: { keyFields: ['id', 'name'] } };
    const issues = findMissingKeyFields(
      schema,
      `query Q { viewer { devices { id } } }`,
      syntheticPolicies
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ typeName: 'Device', missing: ['name'] })
    );
  });
});

describe('every shipped operation', () => {
  it('selects the cache key field of every normalizable type it touches', () => {
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
