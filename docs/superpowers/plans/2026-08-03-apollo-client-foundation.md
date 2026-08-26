# Apollo Client Foundation & Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Path note (post-execution, 2026-08-04):** every `app/client/src/lib/apollo/…` path below
> now lives at `app/client/src/provider/apollo/…`, and the module is reached through
> `provider/apollo/index.ts`. The paths are left as written because this plan is the record
> of what each task actually did at the time. For current locations see the spec's §14.

**Goal:** Land the Apollo Client foundation (codegen, normalized cache, link chain, test seam, three CI guardrails), prove the transport end to end, and replace the scan-progress polling loop with a real GraphQL subscription over SSE.

**Architecture:** Apollo Client v4 talks to the existing `POST /graphql` yoga mount alongside the untouched REST API. Typed documents and a persisted-operations manifest are generated from the committed SDL artifact (production introspection is disabled, so introspection-based codegen is not an option). Auth reuses the existing `refreshAccessToken()`/`ensureFreshToken()` helpers rather than reimplementing them. Subscriptions ride a hand-rolled `SSELink` over `graphql-sse`, modelled on Apollo's own `GraphQLWsLink` implementation.

**Tech Stack:** React 19, TypeScript, Vite 8, Vitest 4, `@apollo/client@4`, `rxjs@7`, `graphql-sse@2`, `@graphql-codegen/cli@7` with `client-preset@6`, oxlint/oxfmt.

**Scope:** This plan covers steps **0–2** of the spec's 11-step sequencing (`2026-08-03-apollo-client-migration-design.md` §9). Steps 3–10 (the route migrations) get their own plans, written after this one lands — their exact code depends on the generated types, `cacheConfig`, and shared helpers this plan produces.

## Global Constraints

- **Never add a server change.** If a screen has nowhere to go, surface it and stop. The one server-side file this plan adds is a *test* (Task 7), which changes no schema and no runtime behaviour.
- **`graphql` stays at the hoisted `16.14.2`.** Apollo v4 accepts `^16 || ^17`. Do NOT install graphql 17 — two graphql instances in one workspace is a known hazard.
- **`rxjs@^7.3.0` is a required peer dependency** of `@apollo/client@4`, not optional.
- **Run lint from the repo root only** (`cd <repo root> && npm run lint`). The two workspaces have separate configs; a workspace-local run silently skips the other.
- **oxlint rules that will bite:** `typescript/no-explicit-any` is `error`, `no-shadow` is `error`, `react-hooks/exhaustive-deps` is `error`, `eqeqeq` is `error` (null-ignoring). Use `unknown` + narrowing, never `any`.
- **Formatting is `oxfmt`**, not prettier. Run `npm run lint:fix -w app/client` before committing if formatting fails.
- **`docs/` is gitignored.** Do not attempt to commit plan or spec files.
- **Codegen output (`app/client/src/gql/`) IS committed** — it is a build input for the CI guardrails, which must run without a server.
- **Cost budgets:** `BREADTH_BUDGET` 100, `COMPLEXITY_BUDGET` 33,000, `MAX_DEPTH` 12. Every shipped operation must stay under **70%** of both. Prefer literal page sizes: a variable-valued `first`/`last` is priced at that field's `maxSize`, not its default.
- **Baseline to preserve:** server suite 1939/1939, `npm run test:cost -w app/server` 30/30, client suite green, lint clean from root.

---

### Task 1: Dependencies, codegen, and the first typed document

Codegen fails with zero documents, so the first document ships in this task. `ViewerBootstrap` is the one every later task depends on — it carries the self library id.

**Files:**
- Modify: `app/client/package.json`
- Create: `app/client/codegen.ts`
- Create: `app/client/src/graphql/viewer-bootstrap.ts`
- Create (generated, committed): `app/client/src/gql/**`
- Modify: `app/client/.oxlintrc.json`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `app/client/src/gql/` — `graphql()` tagged-document function, generated result types, and `persisted-documents.json` (a `{ [sha256]: operationString }` map).
  - `ViewerBootstrapDocument` (exported from `~/graphql/viewer-bootstrap`) — `query ViewerBootstrap { viewer { username isAdmin mustChangePassword user { id } library { id } } }`.
  - npm scripts `codegen` and `codegen:check` in `app/client`.

- [ ] **Step 1: Install dependencies**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration
npm i -w app/client @apollo/client@^4.2.9 rxjs@^7.8.1 graphql-sse@^2.6.0
npm i -w app/client -D @graphql-codegen/cli@^7.2.0 @graphql-codegen/client-preset@^6.1.0 @graphql-codegen/fragment-matcher@^7.1.0
```

Verify `graphql` was NOT added to `app/client/package.json` (it resolves from the hoisted root install):

```bash
node -p "require('./app/client/package.json').dependencies.graphql ?? 'not present — correct'"
node -p "require('./node_modules/graphql/package.json').version"   # expect 16.14.2
```

- [ ] **Step 2: Write the codegen config**

Create `app/client/codegen.ts`:

```ts
import type { CodegenConfig } from '@graphql-codegen/cli';
import { addTypenameSelectionDocumentTransform } from '@graphql-codegen/client-preset';

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
  // Test files are excluded deliberately: the persisted-documents manifest is
  // consumed by the cost gate and the cache-key check as the definition of
  // "what the client ships", and an ad hoc `gql` fixture in a test is not a
  // shipped operation. (Added during execution, Task 4 fix round 2.)
  documents: ['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}', '!src/gql/**/*'],
  ignoreNoDocuments: false,
  generates: {
    'src/gql/': {
      preset: 'client',
      presetConfig: {
        persistedDocuments: { hashAlgorithm: 'sha256' },
      },
      // ADDED during execution (Task 4 fix round 1). Apollo v4 always injects
      // `__typename` at runtime; without this transform the generated types
      // omit it, so typed mocks reject the `__typename` that Apollo needs in
      // order to normalize — and the persisted-documents manifest records a
      // query that is not the one actually sent, which would make the cost
      // gate measure the wrong thing.
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
```

- [ ] **Step 3: Write the first document**

Create `app/client/src/graphql/viewer-bootstrap.ts`:

```ts
import { graphql } from '~/gql';

/**
 * The app-start read. `library { id }` is the self library's global ID, which
 * `useCurrentLibraryId()` hands to every library-scoped screen.
 *
 * Read from the server rather than minted client-side as
 * `btoa('Library:' + userId)`: the JWT claims do carry the raw user id, but
 * hard-coding Pothos's global-ID encoding into the client is exactly the
 * coupling the book-relay-id plan removed.
 *
 * `library` and `user` are both null for the config-based admin, which owns no
 * library and has no user row.
 */
export const ViewerBootstrapDocument = graphql(`
  query ViewerBootstrap {
    viewer {
      username
      isAdmin
      mustChangePassword
      user {
        id
      }
      library {
        id
      }
    }
  }
`);
```

- [ ] **Step 4: Add npm scripts**

In `app/client/package.json`, add to `scripts`:

```json
"codegen": "graphql-codegen --config codegen.ts",
"codegen:check": "graphql-codegen --config codegen.ts --check"
```

- [ ] **Step 5: Exclude generated output from oxfmt, keep it in oxlint's ignore**

In `app/client/.oxlintrc.json`, extend `ignorePatterns`:

```json
"ignorePatterns": ["dist/**", "node_modules/**", "src/gql/**"]
```

Change the `lint` script in `app/client/package.json` so oxfmt skips generated files:

```json
"lint": "oxlint src && oxfmt --check \"src/**/*.{ts,tsx}\" --ignore-path .oxfmtignore && tsc --noEmit"
```

Create `app/client/.oxfmtignore`:

```
src/gql/
```

- [ ] **Step 6: Run codegen**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npm run codegen -w app/client
```

Expected: writes `app/client/src/gql/` containing at least `index.ts`, `graphql.ts`, `fragment-masking.ts`, `persisted-documents.json`, and `possible-types.ts`.

Verify the manifest has exactly one entry and that it is the bootstrap query:

```bash
node -p "const m=require('./app/client/src/gql/persisted-documents.json'); JSON.stringify({count:Object.keys(m).length, first:Object.values(m)[0]}, null, 1)"
```

Expected: `count: 1`, and the operation string contains `query ViewerBootstrap`.

- [ ] **Step 7: Typecheck**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npx tsc --noEmit -p app/client
```

Expected: no errors. If `~/gql` does not resolve, confirm `app/client/tsconfig.json` maps `~/*` to `./src/*`.

- [ ] **Step 8: Commit**

```bash
git add app/client/package.json app/client/codegen.ts app/client/src/graphql app/client/src/gql app/client/.oxlintrc.json app/client/.oxfmtignore package-lock.json
git commit -m "feat(client): add Apollo Client deps and GraphQL codegen from the committed SDL"
```

---

### Task 2: Cache configuration

The single exported `cacheConfig` that both the app and every test consume, so tests can never drift from production.

**Files:**
- Create: `app/client/src/lib/apollo/cache.ts`
- Test: `app/client/src/lib/apollo/cache.test.ts`

**Interfaces:**
- Consumes: `app/client/src/gql/possible-types.ts` (Task 1).
- Produces: `cacheConfig: InMemoryCacheConfig` exported from `~/lib/apollo/cache`. Consumed by Task 4's client factory and test helper.

- [ ] **Step 1: Write the failing test**

Create `app/client/src/lib/apollo/cache.test.ts`:

```ts
import { InMemoryCache } from '@apollo/client';
import { gql } from '@apollo/client';
import { describe, expect, it } from 'vitest';

import { cacheConfig } from './cache';

const VIEWER_QUERY = gql`
  query V {
    viewer {
      username
    }
  }
`;

const PROGRESS_QUERY = gql`
  query P($id: ID!) {
    node(id: $id) {
      ... on Library {
        id
        progress(first: 1) {
          edges {
            node {
              userId
              document
              percentage
            }
          }
        }
      }
    }
  }
`;

const writeProgress = (cache: InMemoryCache, libraryId: string, userId: string, pct: number) =>
  cache.writeQuery({
    query: PROGRESS_QUERY,
    variables: { id: libraryId },
    data: {
      node: {
        __typename: 'Library',
        id: libraryId,
        progress: {
          __typename: 'LibraryProgressConnection',
          edges: [
            {
              __typename: 'LibraryProgressConnectionEdge',
              node: {
                __typename: 'Progress',
                userId,
                document: 'shared-doc-hash',
                percentage: pct,
              },
            },
          ],
        },
      },
    },
  });

describe('cacheConfig', () => {
  it('normalizes Viewer as a root singleton', () => {
    const cache = new InMemoryCache(cacheConfig);
    cache.writeQuery({
      query: VIEWER_QUERY,
      data: { viewer: { __typename: 'Viewer', username: 'alice' } },
    });

    // keyFields: [] gives the singleton entity `Viewer:{}`. Without it, Viewer
    // lives inline under ROOT_QUERY and is not addressable.
    expect(cache.extract()['Viewer:{}']).toMatchObject({ username: 'alice' });
  });

  // SEEN-TO-FAIL: this is the test that must fail if Progress reverts to
  // keyFields: ['document']. Two users owning the SAME book share a `document`
  // value (it is a KOReader content hash), so a single-user fixture passes
  // either way and proves nothing.
  it('keys Progress on (userId, document) so two users do not collapse', () => {
    const cache = new InMemoryCache(cacheConfig);
    writeProgress(cache, 'LIB-A', 'user-a', 10);
    writeProgress(cache, 'LIB-B', 'user-b', 90);

    const a = cache.readQuery<{ node: { progress: { edges: { node: { percentage: number } }[] } } }>(
      { query: PROGRESS_QUERY, variables: { id: 'LIB-A' } }
    );
    const b = cache.readQuery<{ node: { progress: { edges: { node: { percentage: number } }[] } } }>(
      { query: PROGRESS_QUERY, variables: { id: 'LIB-B' } }
    );

    expect(a?.node.progress.edges[0].node.percentage).toBe(10);
    expect(b?.node.progress.edges[0].node.percentage).toBe(90);
  });

  it('registers pagination policies on all four connection fields', () => {
    const policies = cacheConfig.typePolicies ?? {};
    expect(Object.keys(policies.Library?.fields ?? {}).sort()).toEqual([
      'book',
      'entries',
      'progress',
    ]);
    expect(Object.keys(policies.Series?.fields ?? {})).toEqual(['books']);
    expect(Object.keys(policies.Validation?.fields ?? {})).toEqual(['messages']);
  });

  it('carries possibleTypes for the result unions', () => {
    expect(cacheConfig.possibleTypes?.['LibraryEntry']).toEqual(
      expect.arrayContaining(['Book', 'Series'])
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npx vitest run src/lib/apollo/cache.test.ts --root app/client
```

Expected: FAIL — `Cannot find module './cache'`.

- [ ] **Step 3: Write the implementation**

Create `app/client/src/lib/apollo/cache.ts`:

```ts
import type { InMemoryCacheConfig } from '@apollo/client';
import { relayStylePagination } from '@apollo/client/utilities';

import introspection from '~/gql/possible-types';

/**
 * The ONE cache configuration. Both `createApolloClient()` and the test helper
 * `renderWithApollo` build their cache from this object, so a test can never
 * pass against typePolicies the app does not actually use.
 *
 * Only three types need explicit config; everything else normalizes on `id`
 * with zero configuration. `Book`/`Library`/`Series`/`User` are Nodes;
 * `Device`/`PendingFix`/`Validation`/`ScanStatus` carry a scalar `id` without
 * implementing Node.
 *
 * NOTE on pagination: `Library.entries` and `Library.progress` are FORWARD-ONLY
 * server-side — they reject `last`/`before` with BACKWARD_PAGINATION_UNSUPPORTED.
 * `Series.books` and `Validation.messages` do support backward paging.
 * `relayStylePagination` handles both directions, so this config does not
 * enforce the asymmetry; the client simply never pages backward. Do not add
 * backward paging to `entries`/`progress` — it throws at runtime.
 */
export const cacheConfig: InMemoryCacheConfig = {
  possibleTypes: introspection.possibleTypes,
  typePolicies: {
    // Root singletons: no `id` field at all, so without an explicit empty key
    // they live inline under ROOT_QUERY and mutations cannot address them.
    Viewer: { keyFields: [] },
    Config: { keyFields: [] },

    // Prisma PK is (userId, document). `document` is a KOReader content hash
    // and COLLIDES across users — two users owning the same book share it, so
    // `document` alone would collapse both onto one entity in admin views.
    Progress: { keyFields: ['userId', 'document'] },

    Library: {
      fields: {
        entries: relayStylePagination(['filter']),
        progress: relayStylePagination(),
        book: { keyArgs: ['id'] },
      },
    },
    Series: { fields: { books: relayStylePagination() } },
    Validation: { fields: { messages: relayStylePagination() } },
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npx vitest run src/lib/apollo/cache.test.ts --root app/client
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Demonstrate the Progress test can fail (seen-to-fail)**

Temporarily change `Progress: { keyFields: ['userId', 'document'] }` to `Progress: { keyFields: ['document'] }`, re-run, and confirm the two-user test FAILS (both reads return the same percentage). Then revert.

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npx vitest run src/lib/apollo/cache.test.ts --root app/client
```

Expected while broken: FAIL on "keys Progress on (userId, document)". Record the observed values in the commit message. Revert before committing.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/lib/apollo/cache.ts app/client/src/lib/apollo/cache.test.ts
git commit -m "feat(client): add Apollo cache config with Viewer singleton and Progress composite key"
```

---

### Task 3: Auth link chain

**Files:**
- Create: `app/client/src/lib/apollo/links.ts`
- Test: `app/client/src/lib/apollo/links.test.ts`

**Interfaces:**
- Consumes: `refreshAccessToken` from `~/lib/api-fetch`, `getToken` from `~/lib/token`.
- Produces: `createAuthLink(): SetContextLink` and `createRefreshLink(): ErrorLink`, both exported from `~/lib/apollo/links`. Task 4 composes them; Task 10 adds `SSELink` alongside.

- [ ] **Step 1: Write the failing test**

Create `app/client/src/lib/apollo/links.test.ts`:

```ts
import { ApolloClient, ApolloLink, InMemoryCache, Observable, gql } from '@apollo/client';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setToken } from '~/lib/token';

import { createAuthLink, createRefreshLink } from './links';

vi.mock('~/lib/api-fetch', () => ({
  refreshAccessToken: vi.fn(async () => {
    // A real refresh stores a new token; the retry must pick THIS one up.
    const { setToken: set } = await import('~/lib/token');
    set('refreshed-token');
    return true;
  }),
  ensureFreshToken: vi.fn(async () => 'refreshed-token'),
}));

const QUERY = gql`
  query V {
    viewer {
      username
    }
  }
`;

const unauthenticated = () =>
  new CombinedGraphQLErrors({
    errors: [{ message: 'Not authenticated', extensions: { code: 'UNAUTHENTICATED' } }],
  });

/** Terminating link that 401s the first N attempts, then succeeds. */
const flakyLink = (failures: number) => {
  const seenAuthHeaders: (string | undefined)[] = [];
  let attempts = 0;
  const link = new ApolloLink(
    (operation) =>
      new Observable((sink) => {
        attempts += 1;
        const headers = operation.getContext()['headers'] as Record<string, string> | undefined;
        seenAuthHeaders.push(headers?.['authorization']);
        if (attempts <= failures) {
          sink.error(unauthenticated());
          return;
        }
        sink.next({ data: { viewer: { __typename: 'Viewer', username: 'alice' } } });
        sink.complete();
      })
  );
  return { link, seenAuthHeaders, attemptCount: () => attempts };
};

const clientWith = (terminating: ApolloLink) =>
  new ApolloClient({
    link: ApolloLink.from([createRefreshLink(), createAuthLink(), terminating]),
    cache: new InMemoryCache({ typePolicies: { Viewer: { keyFields: [] } } }),
  });

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('auth link chain', () => {
  it('attaches the stored bearer token', async () => {
    setToken('first-token');
    const { link, seenAuthHeaders } = flakyLink(0);
    await clientWith(link).query({ query: QUERY, fetchPolicy: 'no-cache' });

    expect(seenAuthHeaders[0]).toBe('Bearer first-token');
  });

  // SEEN-TO-FAIL #1: must fail if the `retried` guard is removed (the chain
  // then loops forever against a permanently-401ing server).
  it('retries exactly once on UNAUTHENTICATED, then gives up', async () => {
    setToken('stale-token');
    const { link, attemptCount } = flakyLink(Number.POSITIVE_INFINITY);

    await expect(clientWith(link).query({ query: QUERY, fetchPolicy: 'no-cache' })).rejects.toThrow();

    // One original attempt + exactly one retry. Never more.
    expect(attemptCount()).toBe(2);
  });

  // SEEN-TO-FAIL #2: must fail if the link order is flipped (authLink before
  // refreshLink), because the retry would then re-send the STALE token.
  it('re-reads the freshly stored token on the retry', async () => {
    setToken('stale-token');
    const { link, seenAuthHeaders } = flakyLink(1);

    const result = await clientWith(link).query({ query: QUERY, fetchPolicy: 'no-cache' });

    expect(result.data).toEqual({ viewer: { __typename: 'Viewer', username: 'alice' } });
    expect(seenAuthHeaders).toEqual(['Bearer stale-token', 'Bearer refreshed-token']);
  });

  it('does not retry a non-auth error', async () => {
    setToken('good-token');
    let attempts = 0;
    const link = new ApolloLink(
      () =>
        new Observable((sink) => {
          attempts += 1;
          sink.error(
            new CombinedGraphQLErrors({
              errors: [
                { message: 'Cannot query field "nope"', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } },
              ],
            })
          );
        })
    );

    await expect(clientWith(link).query({ query: QUERY, fetchPolicy: 'no-cache' })).rejects.toThrow();
    expect(attempts).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npx vitest run src/lib/apollo/links.test.ts --root app/client
```

Expected: FAIL — `Cannot find module './links'`.

- [ ] **Step 3: Write the implementation**

Create `app/client/src/lib/apollo/links.ts`:

```ts
import { CombinedGraphQLErrors, ServerError } from '@apollo/client/errors';
import { SetContextLink } from '@apollo/client/link/context';
import { ErrorLink } from '@apollo/client/link/error';
import { from as observableFrom, mergeMap, throwError } from 'rxjs';

import { refreshAccessToken } from '~/lib/api-fetch';
import { getToken } from '~/lib/token';

/** Injects the stored access token. Composed AFTER the refresh link so a retry re-reads storage. */
export const createAuthLink = (): SetContextLink =>
  new SetContextLink(({ headers }) => {
    const token = getToken();
    return { headers: token ? { ...headers, authorization: `Bearer ${token}` } : headers };
  });

/**
 * One-shot refresh-and-retry, mirroring `apiFetch`'s own semantics so a
 * permanently-dead refresh cannot loop. Reuses `refreshAccessToken()`, which is
 * already single-flight in-tab AND cross-tab via `navigator.locks` — do not
 * reimplement that coordination here.
 *
 * rxjs, NOT the snippet in the server spec's §C: Apollo v4 re-exports rxjs's
 * Observable verbatim, so there is no static `Observable.from` and no
 * `.flatMap`. rxjs 7 uses the standalone `from()` with `.pipe(mergeMap(...))`,
 * and its `throwError` takes a FACTORY, not a value.
 *
 * The `ServerError` branch is a defensive fallback: yoga answers Apollo's
 * negotiated Accept header with `application/graphql-response+json`, which
 * keeps `extensions.code` reachable even on a 401. If that ever regressed to
 * `application/json`, Apollo would throw an opaque ServerError instead — this
 * degrades rather than breaking.
 */
export const createRefreshLink = (): ErrorLink =>
  new ErrorLink(({ error, operation, forward }) => {
    const isAuth =
      (CombinedGraphQLErrors.is(error) &&
        error.errors.some((e) => e.extensions?.['code'] === 'UNAUTHENTICATED')) ||
      (ServerError.is(error) && error.statusCode === 401);

    if (!isAuth || operation.getContext()['retried'] === true) return;
    operation.setContext({ retried: true });

    return observableFrom(refreshAccessToken()).pipe(
      mergeMap((ok) => (ok ? forward(operation) : throwError(() => error)))
    );
  });
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npx vitest run src/lib/apollo/links.test.ts --root app/client
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Demonstrate both seen-to-fail tests can fail**

Break 1 — **DOES NOT REPRODUCE. Corrected 2026-08-03 during execution; do not attempt it.** The claim here was that removing the `retried` guard makes "retries exactly once" fail by looping. Probed against `@apollo/client@4.2.9` with a permanently-failing refresh:

```
guard=true   handlerEntries=1  networkAttempts=2  outcome=rejected
guard=false  handlerEntries=1  networkAttempts=2  outcome=rejected
```

Apollo's `ErrorLink` intercepts only the original `forward()`; the retry observable it returns subscribes straight to the outer observer, so a second failure never re-enters the handler. The guard is therefore **unreachable defense-in-depth**, kept deliberately (non-re-entry is an implementation detail of 4.2.9, not a documented contract) but NOT load-bearing. The test stays — asserting exactly one retry is worth pinning — but its comment must say only what it proves. Break 2 is this file's real seen-to-fail.

Break 2 — flip the order. In the test's `clientWith`, change `ApolloLink.from([createRefreshLink(), createAuthLink(), terminating])` to `ApolloLink.from([createAuthLink(), createRefreshLink(), terminating])`. Re-run; expect "re-reads the freshly stored token" to FAIL with the second header still `Bearer stale-token`. Revert.

Record both observed failures in the commit message.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/lib/apollo/links.ts app/client/src/lib/apollo/links.test.ts
git commit -m "feat(client): add Apollo auth link with one-shot refresh-and-retry"
```

---

### Task 4: Client factory, ApolloProvider wiring, and the test helper

**Files:**
- Create: `app/client/src/lib/apollo/client.ts`
- Modify: `app/client/src/App.tsx`
- Modify: `app/client/src/test-utils.tsx`
- Test: `app/client/src/lib/apollo/client.test.tsx`

**Interfaces:**
- Consumes: `cacheConfig` (Task 2), `createAuthLink`/`createRefreshLink` (Task 3).
- Produces:
  - `createApolloClient(): ApolloClient` from `~/lib/apollo/client`.
  - `renderWithApollo(ui, { mocks, user?, initialEntries?, ... })` from `~/test-utils` — same options as `renderWithProviders` plus `mocks: MockedResponse[]`.

- [ ] **Step 1: Write the failing test**

Create `app/client/src/lib/apollo/client.test.tsx`:

```tsx
import { useQuery } from '@apollo/client/react';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import { renderWithApollo } from '~/test-utils';

import { createApolloClient } from './client';

const Probe = () => {
  const { data } = useQuery(ViewerBootstrapDocument);
  return <div>{data?.viewer.username ?? 'loading'}</div>;
};

describe('createApolloClient', () => {
  it('builds a client whose cache uses the app cacheConfig', () => {
    const client = createApolloClient();
    client.cache.writeQuery({
      query: ViewerBootstrapDocument,
      data: {
        viewer: {
          __typename: 'Viewer',
          username: 'alice',
          isAdmin: false,
          mustChangePassword: false,
          user: { __typename: 'User', id: 'USER-1' },
          library: { __typename: 'Library', id: 'LIB-1' },
        },
      },
    });

    // Proves the Viewer singleton policy is in force, not Apollo's defaults.
    expect(client.cache.extract()['Viewer:{}']).toBeDefined();
  });
});

describe('renderWithApollo', () => {
  it('serves a mocked document through a real normalized cache', async () => {
    renderWithApollo(<Probe />, {
      mocks: [
        {
          request: { query: ViewerBootstrapDocument },
          result: {
            data: {
              viewer: {
                __typename: 'Viewer',
                username: 'alice',
                isAdmin: false,
                mustChangePassword: false,
                user: { __typename: 'User', id: 'USER-1' },
                library: { __typename: 'Library', id: 'LIB-1' },
              },
            },
          },
        },
      ],
    });

    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npx vitest run src/lib/apollo/client.test.tsx --root app/client
```

Expected: FAIL — `Cannot find module './client'` and `renderWithApollo` is not exported.

- [ ] **Step 3: Write the client factory**

Create `app/client/src/lib/apollo/client.ts`:

```ts
import { ApolloClient, HttpLink, InMemoryCache, ApolloLink } from '@apollo/client';

import { cacheConfig } from './cache';
import { createAuthLink, createRefreshLink } from './links';

/**
 * `refreshLink` BEFORE `authLink` so a retry re-reads the freshly stored token.
 *
 * No `credentials` option: everything is same-origin (the Vite dev proxy
 * already forwards `/graphql`), and the refresh call is plain REST outside
 * Apollo, riding the existing httpOnly cookie.
 */
export const createApolloClient = (): ApolloClient =>
  new ApolloClient({
    link: ApolloLink.from([
      createRefreshLink(),
      createAuthLink(),
      new HttpLink({ uri: '/graphql' }),
    ]),
    cache: new InMemoryCache(cacheConfig),
  });
```

- [ ] **Step 4: Add the test helper**

In `app/client/src/test-utils.tsx`, add these imports at the top:

```tsx
import { ApolloClient, InMemoryCache } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { MockLink, type MockedResponse } from '@apollo/client/testing';

import { cacheConfig } from './lib/apollo/cache';
```

Then append this export:

```tsx
interface RenderWithApolloOptions extends RenderWithProvidersOptions {
  mocks?: MockedResponse[];
}

/**
 * Renders with a REAL InMemoryCache built from the app's own `cacheConfig` over
 * Apollo's MockLink. The point is that cache-update functions are exercised
 * against the actual typePolicies — that is where the bugs are.
 *
 * The transport links (auth/refresh, SSE) are deliberately NOT in this chain;
 * they have dedicated tests rather than riding along in every screen test.
 *
 * Type your mocks as `MockedResponse<YourQueryType>` — `tsc --noEmit` (already
 * part of `npm run lint`) then rejects a mock whose shape the server could
 * never return, which is MockLink's one real weakness.
 */
export function renderWithApollo(
  ui: ReactElement,
  { mocks = [], ...options }: RenderWithApolloOptions = {}
) {
  const client = new ApolloClient({
    link: new MockLink(mocks),
    cache: new InMemoryCache(cacheConfig),
  });
  return renderWithProviders(<ApolloProvider client={client}>{ui}</ApolloProvider>, options);
}
```

Note: `RenderWithProvidersOptions` is currently declared but not exported — leave it unexported and reuse it directly, since both functions live in this file.

- [ ] **Step 5: Wire ApolloProvider into the app**

In `app/client/src/App.tsx`, replace the file body with:

```tsx
import { ApolloProvider } from '@apollo/client/react';

import { createApolloClient } from './lib/apollo/client';
import { buildProvidersTree } from './provider';
import { AuthProvider } from './provider/auth';
import { BookProvider } from './provider/book';
import { ConfigProvider } from './provider/config';
import { DeviceProvider } from './provider/device';
import { LibraryTargetProvider } from './provider/library-target';
import { ProgressProvider } from './provider/progress';
import { ThemeProvider } from './provider/theme';
import { ToastProvider } from './provider/toast';
import { UploadProvider } from './provider/upload';
import { UserProvider } from './provider/user';
import { AppRouter } from './router/';

const ProvidersTree = buildProvidersTree([
  [ConfigProvider],
  [ThemeProvider],
  [AuthProvider],
  [LibraryTargetProvider],
  [UserProvider],
  [DeviceProvider],
  [BookProvider],
  [UploadProvider],
  [ProgressProvider],
  [ToastProvider],
]);

// Created once at module scope: a client rebuilt on every render would discard
// the normalized cache each time.
const apolloClient = createApolloClient();

export const App = () => (
  <ApolloProvider client={apolloClient}>
    <ProvidersTree>
      <AppRouter />
    </ProvidersTree>
  </ApolloProvider>
);
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npx vitest run src/lib/apollo --root app/client
```

Expected: PASS.

- [ ] **Step 7: Run the whole client suite for regressions**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npm test -w app/client
```

Expected: all green. Record the test count.

- [ ] **Step 8: Commit**

```bash
git add app/client/src/lib/apollo/client.ts app/client/src/lib/apollo/client.test.tsx app/client/src/App.tsx app/client/src/test-utils.tsx
git commit -m "feat(client): wire ApolloProvider and add renderWithApollo test helper"
```

---

### Task 5: Guardrail — codegen freshness check

Mirrors the server's `graphql:schema:check`: a stale generated directory must fail CI.

**Files:**
- Modify: `app/client/package.json`
- Create: `app/client/scripts/codegen-check.mjs`

**Interfaces:**
- Consumes: Task 1's `codegen` script and `src/gql/` output.
- Produces: `npm run codegen:check -w app/client` exits non-zero on drift; wired into `app/client`'s `lint`.

- [ ] **Step 1: Verify the built-in `--check` flag actually detects drift**

`@graphql-codegen/cli` ships a `--check` mode. Confirm it behaves before relying on it:

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration
printf '\n// drift\n' >> app/client/src/gql/graphql.ts
npm run codegen:check -w app/client; echo "EXIT: $?"
git checkout app/client/src/gql/graphql.ts
```

Expected: non-zero exit. **If it exits 0**, `--check` is unreliable here — proceed to Step 2 and use the explicit script instead. If it exits non-zero, skip Step 2 and go to Step 3, wiring `codegen:check` directly.

- [ ] **Step 2: (Only if Step 1 exited 0) Write an explicit drift check**

Create `app/client/scripts/codegen-check.mjs`:

```js
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Regenerate into a scratch copy and diff against the committed output, the
 * same contract as the server's `graphql:schema:check`. A stale `src/gql/`
 * is a build-input drift, not a cosmetic issue: the id-lint and cost-gate
 * guardrails both read `persisted-documents.json`, so stale output means
 * both are measuring something that is not what ships.
 */
const backup = mkdtempSync(join(tmpdir(), 'bookplate-codegen-'));
cpSync('src/gql', join(backup, 'gql'), { recursive: true });

try {
  execFileSync('npx', ['graphql-codegen', '--config', 'codegen.ts'], { stdio: 'inherit' });
  execFileSync('diff', ['-r', join(backup, 'gql'), 'src/gql'], { stdio: 'inherit' });
  console.log('codegen output is up to date');
} catch {
  console.error(
    'GraphQL codegen output is out of date.\n  Run: npm run codegen -w app/client'
  );
  cpSync(join(backup, 'gql'), 'src/gql', { recursive: true });
  process.exit(1);
} finally {
  rmSync(backup, { recursive: true, force: true });
}
```

Then set the script to `"codegen:check": "node scripts/codegen-check.mjs"`.

- [ ] **Step 3: Wire it into lint**

In `app/client/package.json`, extend `lint`:

```json
"lint": "oxlint src && oxfmt --check \"src/**/*.{ts,tsx}\" --ignore-path .oxfmtignore && tsc --noEmit && npm run codegen:check"
```

- [ ] **Step 4: Verify the guardrail fires**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration
printf '\n// drift\n' >> app/client/src/gql/graphql.ts
npm run lint -w app/client; echo "EXIT: $?"
git checkout app/client/src/gql/graphql.ts
npm run lint -w app/client; echo "EXIT: $?"
```

Expected: first run non-zero with the "out of date" message, second run 0.

- [ ] **Step 5: Commit**

```bash
git add app/client/package.json app/client/scripts
git commit -m "ci(client): fail lint when GraphQL codegen output is stale"
```

---

### Task 6: Guardrail — `id` in every selection

Apollo injects `__typename` into every selection set but **never** `id`. An omission silently produces an un-normalized object and no test necessarily catches it. This runs against `persisted-documents.json`, so it checks exactly what ships, with all fragments already inlined.

It is a **vitest test, not a lint script**, so it can import the real `cacheConfig` and derive each type's key fields from it. A standalone `.mjs` script would have to restate that knowledge and keep it in sync by hand.

**Files:**
- Create: `app/client/src/lib/apollo/selection-ids.ts`
- Test: `app/client/src/lib/apollo/selection-ids.test.ts`

**Interfaces:**
- Consumes: `cacheConfig` (Task 2), `app/client/src/gql/persisted-documents.json` (Task 1), `app/server/graphql/schema.generated.graphql`.
- Produces: `findMissingKeyFields(schema: GraphQLSchema, source: string): { typeName: string; path: string; missing: string[] }[]` from `~/lib/apollo/selection-ids`.

- [ ] **Step 1: Write the failing test**

Create `app/client/src/lib/apollo/selection-ids.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npx vitest run src/lib/apollo/selection-ids.test.ts --root app/client
```

Expected: FAIL — `Cannot find module './selection-ids'`.

- [ ] **Step 3: Write the implementation**

Create `app/client/src/lib/apollo/selection-ids.ts`:

```ts
import {
  getNamedType,
  isCompositeType,
  isInterfaceType,
  isObjectType,
  Kind,
  parse,
  type FragmentDefinitionNode,
  type GraphQLNamedType,
  type GraphQLSchema,
  type SelectionSetNode,
} from 'graphql';

import { cacheConfig } from './cache';

export type MissingKeyField = {
  typeName: string;
  /** Dotted path from the operation root, for a readable failure message. */
  path: string;
  missing: string[];
};

/**
 * The key fields Apollo will actually use for `type`, derived from the app's
 * own `cacheConfig` rather than restated here — change a typePolicy and this
 * follows automatically.
 *
 * An explicit `keyFields: []` (the root singletons) yields no requirement; a
 * type with no policy falls back to Apollo's default, which is `id` when the
 * type has one and inline storage otherwise.
 */
const keyFieldsFor = (type: GraphQLNamedType): string[] => {
  const policy = cacheConfig.typePolicies?.[type.name];
  if (policy && typeof policy === 'object' && 'keyFields' in policy) {
    const declared = policy.keyFields;
    return Array.isArray(declared) ? declared.filter((f): f is string => typeof f === 'string') : [];
  }
  if (!isObjectType(type) && !isInterfaceType(type)) return [];
  return 'id' in type.getFields() ? ['id'] : [];
};

/** Field names reachable in a selection set, following spreads that apply to `type`. */
const reachableFieldNames = (
  selectionSet: SelectionSetNode,
  type: GraphQLNamedType,
  fragments: Record<string, FragmentDefinitionNode>,
  seen: Set<string> = new Set()
): Set<string> => {
  const names = new Set<string>();
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      names.add(selection.name.value);
      continue;
    }
    if (selection.kind === Kind.INLINE_FRAGMENT) {
      const onName = selection.typeCondition?.name.value;
      if (onName && onName !== type.name) continue;
      for (const n of reachableFieldNames(selection.selectionSet, type, fragments, seen)) {
        names.add(n);
      }
      continue;
    }
    const fragmentName = selection.name.value;
    if (seen.has(fragmentName)) continue;
    seen.add(fragmentName);
    const definition = fragments[fragmentName];
    if (definition && definition.typeCondition.name.value === type.name) {
      for (const n of reachableFieldNames(definition.selectionSet, type, fragments, seen)) {
        names.add(n);
      }
    }
  }
  return names;
};

/**
 * Every selection set in `source` whose type is normalized by Apollo but which
 * omits that type's cache key field(s).
 */
export const findMissingKeyFields = (schema: GraphQLSchema, source: string): MissingKeyField[] => {
  const document = parse(source);
  const issues: MissingKeyField[] = [];

  const fragments: Record<string, FragmentDefinitionNode> = {};
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments[definition.name.value] = definition;
  }

  const check = (selectionSet: SelectionSetNode, type: GraphQLNamedType, path: string): void => {
    const required = keyFieldsFor(type);
    if (required.length === 0) return;
    const present = reachableFieldNames(selectionSet, type, fragments);
    const missing = required.filter((field) => !present.has(field));
    if (missing.length > 0) issues.push({ typeName: type.name, path, missing });
  };

  const walk = (selectionSet: SelectionSetNode, parentType: GraphQLNamedType, path: string): void => {
    for (const selection of selectionSet.selections) {
      // Fragment spreads are walked at their own definition, below.
      if (selection.kind === Kind.FRAGMENT_SPREAD) continue;

      if (selection.kind === Kind.INLINE_FRAGMENT) {
        const onName = selection.typeCondition?.name.value;
        const nextType = onName ? schema.getType(onName) : parentType;
        if (nextType && isCompositeType(nextType)) {
          check(selection.selectionSet, nextType, path);
          walk(selection.selectionSet, nextType, path);
        }
        continue;
      }

      if (!selection.selectionSet) continue;
      if (!isObjectType(parentType) && !isInterfaceType(parentType)) continue;
      const fieldDef = parentType.getFields()[selection.name.value];
      if (!fieldDef) continue;
      const namedType = getNamedType(fieldDef.type);
      if (!isCompositeType(namedType)) continue;

      const nextPath = `${path}.${selection.name.value}`;
      check(selection.selectionSet, namedType, nextPath);
      walk(selection.selectionSet, namedType, nextPath);
    }
  };

  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) {
      const rootType =
        definition.operation === 'query'
          ? schema.getQueryType()
          : definition.operation === 'mutation'
            ? schema.getMutationType()
            : schema.getSubscriptionType();
      if (rootType) {
        walk(definition.selectionSet, rootType, definition.name?.value ?? '(anonymous)');
      }
      continue;
    }
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      const onType = schema.getType(definition.typeCondition.name.value);
      if (onType && isCompositeType(onType)) {
        const path = `fragment ${definition.name.value}`;
        check(definition.selectionSet, onType, path);
        walk(definition.selectionSet, onType, path);
      }
    }
  }

  return issues;
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npx vitest run src/lib/apollo/selection-ids.test.ts --root app/client
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Prove the guardrail catches a real regression (seen-to-fail)**

Temporarily remove `id` from the `user { id }` selection in `src/graphql/viewer-bootstrap.ts`, regenerate, and re-run:

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration
npm run codegen -w app/client
npx vitest run src/lib/apollo/selection-ids.test.ts --root app/client
```

Expected: FAIL on "every shipped operation", naming `User` and `id`. Restore the field, re-run codegen, confirm the test passes again. Record the observed failure in the commit message.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/lib/apollo/selection-ids.ts app/client/src/lib/apollo/selection-ids.test.ts
git commit -m "test(client): fail when a shipped operation omits its Apollo cache key field"
```


---

### Task 7: Guardrail — persisted-documents cost gate

Measures the operations that actually ship, rather than hand-copied fixtures that drift. §Q of the server spec records two occasions where a transcribed cost number was wrong.

**Files:**
- Create: `app/server/graphql/client-operations-cost.test.ts`
- Modify: `app/server/package.json` (the `test:cost` script)

**Interfaces:**
- Consumes: `app/client/src/gql/persisted-documents.json` (Task 1), `costOf`/`accepts` from `./cost-test-support`, `BREADTH_BUDGET`/`COMPLEXITY_BUDGET` from `./cost-limit`.
- Produces: a CI-enforced ceiling of 70% on every shipped client operation.

- [ ] **Step 1: Write the failing test**

Create `app/server/graphql/client-operations-cost.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';

import { BREADTH_BUDGET, COMPLEXITY_BUDGET } from './cost-limit';
import { accepts, costOf } from './cost-test-support';

/**
 * The client's shipped operations, measured against the same budgets the
 * enforcing rule uses — NOT hand-copied fixtures, which drift from what
 * actually ships.
 *
 * `accepts()` runs schema validity plus the REAL `costLimitRule` through
 * `validate()`, exactly as a live request does. That is what catches
 * PAGE_SIZE_EXCEEDED and BACKWARD_PAGINATION_UNSUPPORTED, which a bare
 * `costOf()` measurement would not.
 *
 * NOTE on page sizes: a variable-valued `first`/`last` is priced at that
 * field's `maxSize`, not its default (cost-limit.ts, `multiplierFor`). Prefer
 * literal page sizes in client documents.
 */
const MANIFEST_PATH = path.join(
  __dirname,
  '..',
  '..',
  'client',
  'src',
  'gql',
  'persisted-documents.json'
);

/** The CI `Cost calibration` job's own threshold. */
const HEADROOM = 0.7;

const loadManifest = (): Record<string, string> =>
  JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as Record<string, string>;

describe('shipped client operations', () => {
  it('has a generated manifest to measure', () => {
    expect(fs.existsSync(MANIFEST_PATH)).toBe(true);
    expect(Object.keys(loadManifest()).length).toBeGreaterThan(0);
  });

  it('every operation is valid and admitted by the real cost rule', () => {
    for (const [hash, source] of Object.entries(loadManifest())) {
      try {
        accepts(source);
      } catch (error) {
        throw new Error(`operation ${hash} was rejected:\n${source}\n\n${String(error)}`);
      }
    }
  });

  it(`every operation stays under ${HEADROOM * 100}% of both budgets`, () => {
    const rows: string[] = [];
    const over: string[] = [];

    for (const [hash, source] of Object.entries(loadManifest())) {
      const cost = costOf(source);
      const breadthPct = cost.breadth / BREADTH_BUDGET;
      const complexityPct = cost.complexity / COMPLEXITY_BUDGET;
      const name = /(?:query|mutation|subscription)\s+(\w+)/.exec(source)?.[1] ?? hash.slice(0, 8);

      rows.push(
        `${name.padEnd(34)} breadth ${String(cost.breadth).padStart(3)} (${(breadthPct * 100).toFixed(1)}%)` +
          `  complexity ${String(cost.complexity).padStart(6)} (${(complexityPct * 100).toFixed(1)}%)`
      );
      if (breadthPct > HEADROOM || complexityPct > HEADROOM) over.push(name);
    }

    // Printed on every run, pass or fail — the same contract the calibration
    // suite follows, so the table is the current-as-of-HEAD source of truth.
    console.log('\nShipped client operations:\n' + rows.join('\n') + '\n');

    expect(over).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it passes for the right reason**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration/app/server && npx vitest run graphql/client-operations-cost --reporter=verbose
```

Expected: PASS, 3 tests, and the printed table shows `ViewerBootstrap` at a low percentage of both budgets.

- [ ] **Step 3: Demonstrate the gate can fail (seen-to-fail)**

Temporarily lower `HEADROOM` to `0.0001` and re-run. Expect the third test to FAIL listing `ViewerBootstrap`. Revert to `0.7`.

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration/app/server && npx vitest run graphql/client-operations-cost --reporter=verbose
```

- [ ] **Step 4: Wire into the cost script**

In `app/server/package.json`, change:

```json
"test:cost": "vitest run graphql/cost-calibration graphql/client-operations-cost --reporter=verbose --retry=0"
```

- [ ] **Step 5: Verify the full cost suite**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npm run test:cost -w app/server
```

Expected: previous 30 tests still pass, plus the 3 new ones.

- [ ] **Step 6: Commit**

```bash
git add app/server/graphql/client-operations-cost.test.ts app/server/package.json
git commit -m "ci(server): gate shipped client operations at 70% of both query budgets"
```

---

### Task 8: Viewer bootstrap and `useCurrentLibraryId` (self path)

**Files:**
- Create: `app/client/src/provider/library-target/hook/use-current-library-id.ts`
- Modify: `app/client/src/provider/library-target/hook/index.ts`
- Test: `app/client/src/provider/library-target/hook/use-current-library-id.test.tsx`

**Interfaces:**
- Consumes: `ViewerBootstrapDocument` (Task 1), `renderWithApollo` (Task 4), `useIsAdmin` from `~/provider/auth`.
- Produces: `useCurrentLibraryId(): { libraryId: string | undefined; loading: boolean }` from `~/provider/library-target`.

**Scope note:** this task delivers the **self** path only. An admin gets `undefined` (their `viewer.library` is null) until the library-target reshape in a later plan supplies a stored selection.

- [ ] **Step 1: Write the failing test**

Create `app/client/src/provider/library-target/hook/use-current-library-id.test.tsx`:

```tsx
import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import { renderWithApollo } from '~/test-utils';

import { useCurrentLibraryId } from './use-current-library-id';

const viewerMock = (library: { __typename: 'Library'; id: string } | null, isAdmin: boolean) => ({
  request: { query: ViewerBootstrapDocument },
  result: {
    data: {
      viewer: {
        __typename: 'Viewer' as const,
        username: isAdmin ? 'admin' : 'alice',
        isAdmin,
        mustChangePassword: false,
        user: isAdmin ? null : { __typename: 'User' as const, id: 'USER-1' },
        library,
      },
    },
  },
});

/** Renders the hook inside renderWithApollo's provider stack. */
const renderCurrentLibraryId = (mocks: ReturnType<typeof viewerMock>[]) => {
  const result: { current?: ReturnType<typeof useCurrentLibraryId> } = {};
  const Probe = () => {
    result.current = useCurrentLibraryId();
    return null;
  };
  renderWithApollo(<Probe />, { mocks });
  return result;
};

describe('useCurrentLibraryId', () => {
  it('returns the self library id for a regular user', async () => {
    const result = renderCurrentLibraryId([
      viewerMock({ __typename: 'Library', id: 'LIB-SELF' }, false),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.libraryId).toBe('LIB-SELF');
  });

  it('returns undefined for an admin, whose viewer.library is null', async () => {
    const result = renderCurrentLibraryId([viewerMock(null, true)]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.libraryId).toBeUndefined();
  });

  it('reports loading until the bootstrap query resolves', () => {
    const result = renderCurrentLibraryId([
      viewerMock({ __typename: 'Library', id: 'LIB-SELF' }, false),
    ]);

    expect(result.current?.loading).toBe(true);
    expect(result.current?.libraryId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npx vitest run src/provider/library-target/hook/use-current-library-id.test.tsx --root app/client
```

Expected: FAIL — `Cannot find module './use-current-library-id'`.

- [ ] **Step 3: Write the implementation**

Create `app/client/src/provider/library-target/hook/use-current-library-id.ts`:

```ts
import { useQuery } from '@apollo/client/react';

import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';

export type UseCurrentLibraryId = {
  /** The Library global ID every library-scoped screen roots on, or undefined when there is none to read yet. */
  libraryId: string | undefined;
  loading: boolean;
};

/**
 * The single source of "which library am I reading".
 *
 * Every library-scoped screen roots on `node(id: $libraryId) { ... on Library }`
 * rather than `viewer.library` — `Query.user(id:)` is admin-only (it FORBIDs a
 * non-admin even for their own id) and `viewer.library` is null for the
 * config-based admin, so `node(id:)` is the only root that serves both roles
 * with one document. The Library global ID is `encodeGlobalID('Library', userId)`
 * and is therefore viewer-independent, unlike `Book.id`.
 *
 * SELF PATH ONLY for now: an admin has no `viewer.library`, so this returns
 * undefined for them until the library-target reshape supplies a stored
 * selection.
 */
export const useCurrentLibraryId = (): UseCurrentLibraryId => {
  const { data, loading } = useQuery(ViewerBootstrapDocument);
  return { libraryId: data?.viewer.library?.id, loading };
};
```

- [ ] **Step 4: Export it**

In `app/client/src/provider/library-target/hook/index.ts`, add:

```ts
export { useCurrentLibraryId } from './use-current-library-id';
```

and re-export from `app/client/src/provider/library-target/index.ts` alongside the existing exports.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npx vitest run src/provider/library-target --root app/client
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/provider/library-target
git commit -m "feat(client): add useCurrentLibraryId backed by the viewer bootstrap query"
```

---

### Task 9: Login 429 handling

Spec §C2: the form treats any non-200 as bad credentials, so a rate-limit renders as "wrong password" — misleading, and it does not clear on a correct retry, because a successful login does not reset the counter.

**Files:**
- Modify: `app/client/src/page/login/index.tsx`
- Test: `app/client/src/page/login/index.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure REST; unrelated to Apollo).
- Produces: no exported interface change.

- [ ] **Step 1: Write the failing test**

Append to `app/client/src/page/login/index.test.tsx` (keep existing tests):

```tsx
it('shows a retry-after message on 429 rather than "Invalid credentials"', async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('', { status: 429, headers: { 'Retry-After': '42' } })
    )
  );

  renderWithProviders(<LoginPage />);
  await user.type(screen.getByPlaceholderText('Username'), 'alice');
  await user.type(screen.getByPlaceholderText('Password'), 'hunter2');
  await user.click(screen.getByRole('button', { name: /sign in/i }));

  expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
  expect(screen.getByText(/42 second/i)).toBeInTheDocument();
  expect(screen.queryByText(/invalid credentials/i)).not.toBeInTheDocument();
});

it('still shows "Invalid credentials" on 401', async () => {
  const user = userEvent.setup();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));

  renderWithProviders(<LoginPage />);
  await user.type(screen.getByPlaceholderText('Username'), 'alice');
  await user.type(screen.getByPlaceholderText('Password'), 'wrong');
  await user.click(screen.getByRole('button', { name: /sign in/i }));

  expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
});

it('falls back to a generic wait message when Retry-After is absent', async () => {
  const user = userEvent.setup();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));

  renderWithProviders(<LoginPage />);
  await user.type(screen.getByPlaceholderText('Username'), 'alice');
  await user.type(screen.getByPlaceholderText('Password'), 'hunter2');
  await user.click(screen.getByRole('button', { name: /sign in/i }));

  expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
});
```

Ensure the file imports `userEvent`, `screen`, `vi`, `renderWithProviders`, and `LoginPage` — add any that are missing.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npx vitest run src/page/login --root app/client
```

Expected: FAIL — the 429 case shows "Invalid credentials".

- [ ] **Step 3: Write the implementation**

In `app/client/src/page/login/index.tsx`, replace the `else` branch of the `response.ok` check:

```tsx
      if (response.ok) {
        const accessToken = extractAccessToken(await response.json());
        if (accessToken) {
          setToken(accessToken);
        } else {
          showToast('Unexpected response from server', 'error');
        }
      } else if (response.status === 429) {
        // POST /api/login rate-limits at 10 attempts/minute/IP. This is NOT a
        // credentials failure: a successful login does not reset the counter
        // (see routes/ui.ts), so "Invalid credentials" would be both wrong and
        // would not clear on a correct retry.
        const retryAfter = Number(response.headers.get('Retry-After'));
        showToast(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? `Too many attempts — try again in ${retryAfter} seconds`
            : 'Too many attempts — please wait a moment and try again',
          'error'
        );
      } else {
        showToast('Invalid credentials', 'error');
      }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npx vitest run src/page/login --root app/client
```

Expected: PASS, including the pre-existing login tests.

- [ ] **Step 5: Commit**

```bash
git add app/client/src/page/login
git commit -m "fix(client): distinguish login rate-limit 429 from invalid credentials"
```

---

### Task 10: `SSELink`

Apollo has no SSE link. This is Apollo's own `GraphQLWsLink` implementation reduced to the one method graphql-sse's client provides. **The code below is verified working against real `graphql-yoga@5.21.2`** — 3 events delivered, body keys exactly `["extensions","operationName","query","variables"]`, no `operationType` leak, and the async auth callback sending a real `Authorization` header.

Do **not** copy graphql-sse's README recipe: it spreads `{ ...operation }`, which puts Apollo v4's `operationType` property in the request body, and yoga rejects unknown body parameters with a confusing 400.

**Files:**
- Create: `app/client/src/lib/apollo/sse-link.ts`
- Test: `app/client/src/lib/apollo/sse-link.test.ts`
- Modify: `app/client/src/lib/apollo/client.ts`

**Interfaces:**
- Consumes: `ensureFreshToken` from `~/lib/api-fetch`.
- Produces: `class SSELink extends ApolloLink` with constructor `{ url: string; getToken: () => Promise<string | null> }`, exported from `~/lib/apollo/sse-link`. `createApolloClient()` gains a `split()` routing subscriptions to it.

- [ ] **Step 1: Write the failing test**

Create `app/client/src/lib/apollo/sse-link.test.ts`:

```ts
import { gql } from '@apollo/client';
import { print } from '@apollo/client/utilities';
import { describe, expect, it, vi } from 'vitest';

import { SSELink } from './sse-link';

const SUBSCRIPTION = gql`
  subscription ScanProgress($libraryId: ID!) {
    scanProgress(libraryId: $libraryId) {
      id
      processed
    }
  }
`;

/** Captures what the link hands to graphql-sse without opening a real stream. */
const captureSubscribeCall = () => {
  const calls: Record<string, unknown>[] = [];
  vi.doMock('graphql-sse', () => ({
    createClient: (options: { headers: () => Promise<Record<string, string>> }) => ({
      subscribe: (payload: Record<string, unknown>, sink: { complete: () => void }) => {
        calls.push({ payload, headers: options.headers });
        sink.complete();
        return () => {};
      },
      dispose: () => {},
    }),
  }));
  return calls;
};

describe('SSELink', () => {
  // SEEN-TO-FAIL: must fail if the implementation spreads `{ ...operation }`.
  // Apollo v4 hangs an `operationType` property off the operation object and
  // yoga rejects unknown body parameters outright — asserting the EXACT key set
  // is what catches it; asserting "a subscription works" would not.
  it('sends exactly query/variables/operationName/extensions — never operationType', async () => {
    const calls = captureSubscribeCall();
    const { SSELink: FreshLink } = await import('./sse-link');

    const link = new FreshLink({ url: '/graphql', getToken: async () => 'tok' });
    await new Promise<void>((resolve) => {
      link
        .request({
          query: SUBSCRIPTION,
          variables: { libraryId: 'LIB-1' },
          operationName: 'ScanProgress',
          extensions: {},
          getContext: () => ({}),
          setContext: () => {},
        } as never)!
        .subscribe({ complete: resolve, error: resolve });
    });

    expect(calls).toHaveLength(1);
    const payload = calls[0]['payload'] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      'extensions',
      'operationName',
      'query',
      'variables',
    ]);
    expect(payload['query']).toBe(print(SUBSCRIPTION));
    expect(payload['variables']).toEqual({ libraryId: 'LIB-1' });
  });

  it('supplies a bearer header from the async token callback', async () => {
    const calls = captureSubscribeCall();
    const { SSELink: FreshLink } = await import('./sse-link');

    const link = new FreshLink({ url: '/graphql', getToken: async () => 'tok-abc' });
    await new Promise<void>((resolve) => {
      link
        .request({
          query: SUBSCRIPTION,
          variables: { libraryId: 'LIB-1' },
          operationName: 'ScanProgress',
          extensions: {},
          getContext: () => ({}),
          setContext: () => {},
        } as never)!
        .subscribe({ complete: resolve, error: resolve });
    });

    const headers = calls[0]['headers'] as () => Promise<Record<string, string>>;
    expect(await headers()).toEqual({ authorization: 'Bearer tok-abc' });
  });

  it('sends no authorization header when there is no token', async () => {
    const calls = captureSubscribeCall();
    const { SSELink: FreshLink } = await import('./sse-link');

    const link = new FreshLink({ url: '/graphql', getToken: async () => null });
    await new Promise<void>((resolve) => {
      link
        .request({
          query: SUBSCRIPTION,
          variables: {},
          operationName: 'ScanProgress',
          extensions: {},
          getContext: () => ({}),
          setContext: () => {},
        } as never)!
        .subscribe({ complete: resolve, error: resolve });
    });

    const headers = calls[0]['headers'] as () => Promise<Record<string, string>>;
    expect(await headers()).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npx vitest run src/lib/apollo/sse-link.test.ts --root app/client
```

Expected: FAIL — `Cannot find module './sse-link'`.

- [ ] **Step 3: Write the implementation**

Create `app/client/src/lib/apollo/sse-link.ts` (verified verbatim against real yoga):

```ts
import { ApolloLink, Observable, type FetchResult, type Operation } from '@apollo/client';
import { print } from '@apollo/client/utilities';
import { createClient, type Client } from 'graphql-sse';

/**
 * Apollo ships no SSE link. This is Apollo's own GraphQLWsLink implementation
 * (`@apollo/client/link/subscriptions`) reduced to the one method graphql-sse's
 * client actually provides — `subscribe`.
 *
 * Why not use GraphQLWsLink directly? It works at runtime (verified against
 * graphql-yoga 5.21.2), but graphql-sse's `Client<false>` is missing `on` and
 * `terminate`, so the constructor is a TYPE error. Adopting it would mean
 * `as unknown as Client` plus installing `graphql-ws` purely to satisfy a .d.ts
 * it never executes — and the cast is only safe because the link happens to
 * touch one method today. A future Apollo release calling `terminate()` during
 * cleanup would break it silently on the disconnect path.
 *
 * The explicit destructure below is load-bearing. Apollo v4 hangs an
 * `operationType` property off `operation`; graphql-sse's README recipe spreads
 * `{ ...operation }`, which puts it in the request body, and yoga rejects
 * unknown body parameters with a confusing 400.
 *
 * Auth is a non-problem because graphql-sse uses `fetch`, not `EventSource`:
 * a real Authorization header works and the `headers` callback may be async.
 */
export class SSELink extends ApolloLink {
  private readonly client: Client;

  constructor(options: { url: string; getToken: () => Promise<string | null> }) {
    super();
    this.client = createClient({
      url: options.url,
      // Annotated: the ternary would otherwise widen to a union including
      // `{ authorization?: undefined }`, which is not a Record<string, string>.
      headers: async (): Promise<Record<string, string>> => {
        const token = await options.getToken();
        return token ? { authorization: `Bearer ${token}` } : {};
      },
    });
  }

  request(operation: Operation): Observable<FetchResult> {
    return new Observable((observer) => {
      const { variables, operationName, extensions } = operation;
      return this.client.subscribe<Record<string, unknown>>(
        { variables, operationName, extensions, query: print(operation.query) },
        {
          next: (value) => observer.next(value as FetchResult),
          complete: () => observer.complete(),
          error: (err) => observer.error(err instanceof Error ? err : new Error(String(err))),
        }
      );
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npx vitest run src/lib/apollo/sse-link.test.ts --root app/client
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Demonstrate the operationType test can fail (seen-to-fail)**

Temporarily change the `subscribe` payload to `{ ...operation, query: print(operation.query) }`. Re-run; expect the first test to FAIL because the key set now includes `operationType` (and other operation properties). Revert.

- [ ] **Step 6: Route subscriptions through it**

Replace `app/client/src/lib/apollo/client.ts` with:

```ts
import { ApolloClient, ApolloLink, HttpLink, InMemoryCache } from '@apollo/client';
import { getMainDefinition } from '@apollo/client/utilities';

import { ensureFreshToken } from '~/lib/api-fetch';

import { cacheConfig } from './cache';
import { createAuthLink, createRefreshLink } from './links';
import { SSELink } from './sse-link';

const isSubscription = (operation: Parameters<ApolloLink['request']>[0]): boolean => {
  const definition = getMainDefinition(operation.query);
  return definition.kind === 'OperationDefinition' && definition.operation === 'subscription';
};

/**
 * `refreshLink` BEFORE `authLink` so a retry re-reads the freshly stored token.
 *
 * Subscriptions bypass both: SSELink carries its own auth via `ensureFreshToken`
 * (graphql-sse's headers callback may be async), and the one-shot HTTP retry
 * has no meaning for a long-lived stream.
 *
 * No `credentials` option: everything is same-origin (the Vite dev proxy already
 * forwards `/graphql`), and the refresh call is plain REST outside Apollo.
 */
export const createApolloClient = (): ApolloClient =>
  new ApolloClient({
    link: ApolloLink.split(
      isSubscription,
      new SSELink({ url: '/graphql', getToken: ensureFreshToken }),
      ApolloLink.from([createRefreshLink(), createAuthLink(), new HttpLink({ uri: '/graphql' })])
    ),
    cache: new InMemoryCache(cacheConfig),
  });
```

- [ ] **Step 7: Run the apollo suite and the full client suite**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npx vitest run src/lib/apollo --root app/client && npm test -w app/client
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add app/client/src/lib/apollo/sse-link.ts app/client/src/lib/apollo/sse-link.test.ts app/client/src/lib/apollo/client.ts
git commit -m "feat(client): add SSELink over graphql-sse and route subscriptions to it"
```

---

### Task 11: `scanProgress` subscription replaces the polling loop

**Files:**
- Create: `app/client/src/graphql/scan.ts`
- Create: `app/client/src/provider/book/hook/use-scan-progress.ts`
- Test: `app/client/src/provider/book/hook/use-scan-progress.test.tsx`
- Modify: `app/client/src/provider/book/hook/use-scan-library.ts`

**Interfaces:**
- Consumes: `useCurrentLibraryId` (Task 8), `SSELink` routing (Task 10), `renderWithApollo` (Task 4).
- Produces: `useScanProgress(libraryId: string | undefined): { status: ScanStatusFields | undefined; userId: string | undefined; loading: boolean }` from `~/provider/book/hook/use-scan-progress`, where `ScanStatusFields` is codegen's result type for the `ScanStatusFields` fragment.

**Two different global IDs, verified against the SDL — do not assume one.** The subscription is keyed on a **Library** id (`scanProgress(libraryId: ID!)`), but the mutation is keyed on a **User** id (`libraryScan(input: LibraryScanInput!)` where `input LibraryScanInput { userId: ID! }`). That follows the schema's documented convention — every user-associated mutation takes a User global ID — so it is a seam, not a defect. `useScanProgress` bridges it by selecting `Library.user { id }` off whatever library is current, which works identically for self and for an admin viewing someone else's library. Do **not** try to reuse the Library id as the mutation's `userId`.

**Enum values, verified:** `ScanState` is `RUNNING | COMPLETED | FAILED` — there is **no** `IDLE` member (the REST polling shape had one; the GraphQL type does not). `ScanPhase` is `IMPORTING | PRUNING`.

- [ ] **Step 1: Write the documents**

Create `app/client/src/graphql/scan.ts`:

```ts
import { graphql } from '~/gql';

/**
 * Shared by the reconnect read and the live stream so both write the SAME
 * shape into the cache. `ScanStatus` carries a scalar `id`, so events merge
 * into an already-rendered `Library.scanStatus` with no typePolicy override.
 */
export const ScanStatusFieldsFragment = graphql(`
  fragment ScanStatusFields on ScanStatus {
    id
    state
    phase
    processed
    total
    currentFile
    startedAt
    error
    result {
      imported {
        id
        title
      }
      # The string list the ScanResult tuple has always carried (REST parity).
      # `imported` is [Book!]! and is NOT interchangeable with it.
      importedFilenames
      removed
    }
  }
`);

/**
 * The reconnect / current-state read. There is an inherent registration gap
 * between opening the stream and the server publishing to it, so this runs
 * immediately after subscribing and on every reconnect.
 *
 * `user { id }` is the bridge to the mutation: `libraryScan` is keyed on a USER
 * global ID while the subscription is keyed on a LIBRARY one. Reading it off
 * the current library makes the scan work identically for self and for an admin
 * viewing someone else's library.
 */
export const LibraryScanStatusDocument = graphql(`
  query LibraryScanStatus($libraryId: ID!) {
    node(id: $libraryId) {
      id
      ... on Library {
        user {
          id
        }
        scanStatus {
          ...ScanStatusFields
        }
      }
    }
  }
`);

export const ScanProgressDocument = graphql(`
  subscription ScanProgress($libraryId: ID!) {
    scanProgress(libraryId: $libraryId) {
      ...ScanStatusFields
    }
  }
`);

/**
 * `LibraryScanResult` is a two-member union. `ScanAlreadyRunningError` is NOT a
 * failure for this UI — it is the "attach to the running scan" path, the direct
 * equivalent of the REST route's HTTP 409, and it carries the live `scanStatus`.
 *
 * The whole result is nullable ("Resolves to null when the resolved owner does
 * not exist"), so the call site branches three ways: null / error member /
 * payload.
 */
export const LibraryScanDocument = graphql(`
  mutation LibraryScan($userId: ID!) {
    libraryScan(input: { userId: $userId }) {
      __typename
      ... on LibraryScanPayload {
        scanStatus {
          ...ScanStatusFields
        }
      }
      ... on ScanAlreadyRunningError {
        message
        scanStatus {
          ...ScanStatusFields
        }
      }
    }
  }
`);
```

Then generate:

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npm run codegen -w app/client
```

Expected: no codegen errors. A field name that does not exist in the SDL fails here, loudly.

- [ ] **Step 2: Write the failing test**

Create `app/client/src/provider/book/hook/use-scan-progress.test.tsx`:

```tsx
import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LibraryScanStatusDocument, ScanProgressDocument } from '~/graphql/scan';
import { renderWithApollo } from '~/test-utils';

import { useScanProgress } from './use-scan-progress';

const LIBRARY_ID = 'LIB-1';

const status = (overrides: Record<string, unknown>) => ({
  __typename: 'ScanStatus' as const,
  id: 'job-1',
  state: 'RUNNING',
  phase: 'IMPORTING',
  processed: 0,
  total: 10,
  currentFile: null,
  startedAt: '2026-08-03T00:00:00.000Z',
  error: null,
  result: null,
  ...overrides,
});

/** A `node(id:)` result carrying the Library arm, its user bridge, and a scan status. */
const libraryNode = (scanStatus: ReturnType<typeof status> | null) => ({
  node: {
    __typename: 'Library' as const,
    id: LIBRARY_ID,
    user: { __typename: 'User' as const, id: 'USER-1' },
    scanStatus,
  },
});

const renderScanProgress = (mocks: Parameters<typeof renderWithApollo>[1]['mocks']) => {
  const result: { current?: ReturnType<typeof useScanProgress> } = {};
  const Probe = () => {
    result.current = useScanProgress(LIBRARY_ID);
    return null;
  };
  renderWithApollo(<Probe />, { mocks });
  return result;
};

describe('useScanProgress', () => {
  // SEEN-TO-FAIL: must fail if the reconnect read is dropped. There is an
  // inherent gap between subscribing and the server publishing, so a hook that
  // ONLY subscribes shows nothing for an already-running scan.
  it('reads current scanStatus immediately, without waiting for an event', async () => {
    const result = renderScanProgress([
      {
        request: { query: LibraryScanStatusDocument, variables: { libraryId: LIBRARY_ID } },
        result: { data: libraryNode(status({ processed: 4 })) },
      },
      {
        request: { query: ScanProgressDocument, variables: { libraryId: LIBRARY_ID } },
        result: { data: { scanProgress: status({ processed: 4 }) } },
        delay: 100_000, // never arrives within the test
      },
    ]);

    await waitFor(() => expect(result.current?.status?.processed).toBe(4));
  });

  it('merges a streamed event over the initial read', async () => {
    const result = renderScanProgress([
      {
        request: { query: LibraryScanStatusDocument, variables: { libraryId: LIBRARY_ID } },
        result: { data: libraryNode(status({ processed: 1 })) },
      },
      {
        request: { query: ScanProgressDocument, variables: { libraryId: LIBRARY_ID } },
        result: { data: { scanProgress: status({ processed: 7 }) } },
      },
    ]);

    await waitFor(() => expect(result.current?.status?.processed).toBe(7));
  });

  it('reports no status when the library has never been scanned', async () => {
    const result = renderScanProgress([
      {
        request: { query: LibraryScanStatusDocument, variables: { libraryId: LIBRARY_ID } },
        result: { data: libraryNode(null) },
      },
      {
        request: { query: ScanProgressDocument, variables: { libraryId: LIBRARY_ID } },
        result: { data: { scanProgress: status({}) } },
        delay: 100_000,
      },
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.status).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npx vitest run src/provider/book/hook/use-scan-progress.test.tsx --root app/client
```

Expected: FAIL — `Cannot find module './use-scan-progress'`.

- [ ] **Step 4: Write the implementation**

Create `app/client/src/provider/book/hook/use-scan-progress.ts`:

```ts
import { useQuery, useSubscription } from '@apollo/client/react';

import { LibraryScanStatusDocument, ScanProgressDocument } from '~/graphql/scan';

/**
 * Live scan status for a library.
 *
 * Two reads, deliberately: the subscription streams progress, and the query is
 * the reconnect/current-state read that closes the inherent registration gap
 * between `subscribe()` resolving and the server publishing to that stream. A
 * hook that only subscribes shows nothing for an already-running scan.
 *
 * Both write through the same `ScanStatusFields` fragment, and `ScanStatus`
 * carries a scalar `id`, so the streamed event merges into the already-rendered
 * status with no typePolicy override — the query result and the event are the
 * same cache entity.
 *
 * A scan started through REST is visible here, but only at start/terminal
 * granularity: REST passes no onProgress callback, so per-file progress exists
 * only for a scan started via `libraryScan`.
 */
export const useScanProgress = (libraryId: string | undefined) => {
  const { data: readData, loading } = useQuery(LibraryScanStatusDocument, {
    variables: { libraryId: libraryId ?? '' },
    skip: !libraryId,
    fetchPolicy: 'cache-and-network',
  });

  const { data: eventData } = useSubscription(ScanProgressDocument, {
    variables: { libraryId: libraryId ?? '' },
    skip: !libraryId,
  });

  const library = readData?.node?.__typename === 'Library' ? readData.node : undefined;

  return {
    status: eventData?.scanProgress ?? library?.scanStatus ?? undefined,
    // The mutation is keyed on a USER global ID while this hook is keyed on a
    // LIBRARY one — see this task's Interfaces note. Reading it off the current
    // library is what makes an admin-targeted scan work.
    userId: library?.user.id,
    loading,
  };
};
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npx vitest run src/provider/book/hook/use-scan-progress.test.tsx --root app/client
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Demonstrate the reconnect-read test can fail (seen-to-fail)**

Temporarily change the return to `status: eventData?.scanProgress ?? undefined` (dropping the `fromRead` fallback). Re-run; expect "reads current scanStatus immediately" to FAIL. Revert.

- [ ] **Step 7: Replace the polling loop**

The only consumer is `component/scan-library-setting/index.tsx`, which destructures `[scanLibrary, , scanning]` — it never reads the result tuple's second slot, and never awaits `scanLibrary`'s return value. The tuple shape is preserved so the call site needs no change; `ScanLibrary` becomes `() => Promise<void>` because completion now arrives over the subscription rather than from the mutation.

Replace `app/client/src/provider/book/hook/use-scan-library.ts` entirely with:

```ts
import { useMutation } from '@apollo/client/react';
import { useCallback, use, useEffect, useMemo, useRef, useState } from 'react';

import { LibraryScanDocument } from '~/graphql/scan';
import { useCurrentLibraryId } from '~/provider/library-target';

import { Context } from '../context';
import { useFetchBookList } from './use-fetch-book-list';
import { useScanProgress } from './use-scan-progress';

export type ScanResult = {
  imported: string[];
  removed: string[];
};

export type ScanLibrary = () => Promise<void>;
export type UseScanLibrary =
  | [ScanLibrary, undefined, false, false, undefined] // Initial state
  | [ScanLibrary, undefined, true, false, undefined] // Scan is under way
  | [ScanLibrary, ScanResult, false, false, undefined] // Scan completed successfully
  | [ScanLibrary, undefined, false, true, undefined] // Unspecified error while scanning
  | [ScanLibrary, undefined, false, true, string]; // Specified error while scanning

/**
 * Starts a library scan and reports its live progress.
 *
 * Replaces a 2-second polling loop against `/api/books/scan/status`. The
 * mount-time "attach to a running scan" effect is gone too — it is now
 * structural rather than something this hook arranges: `useScanProgress` always
 * reads current `scanStatus` alongside the stream, so a page reloaded mid-scan
 * renders the running state on first paint.
 *
 * `ScanAlreadyRunningError` is the attach path, not a failure — it is the
 * direct equivalent of the REST route's HTTP 409, and it carries the live
 * status, so it is treated as success exactly as the old code treated 409.
 *
 * `scanLibrary` resolves `void`, not the old `ScanResult | null`: completion
 * now arrives asynchronously over the subscription, so the mutation has no
 * result to hand back. The tuple's second slot still carries the ScanResult,
 * driven by the terminal status.
 */
export const useScanLibrary = (): UseScanLibrary => {
  const { clearCompleteBookIds } = use(Context);
  const fetchBookList = useFetchBookList();
  const { libraryId } = useCurrentLibraryId();
  const { status, userId } = useScanProgress(libraryId);

  const [startScan] = useMutation(LibraryScanDocument);
  const [startError, setStartError] = useState<string | undefined>();
  const [starting, setStarting] = useState(false);

  const running = starting || status?.state === 'RUNNING';

  const scanLibrary: ScanLibrary = useCallback(async () => {
    // Guard concurrent presses, exactly as the polling version did.
    if (running || !userId) return;

    setStarting(true);
    setStartError(undefined);
    try {
      const { data } = await startScan({ variables: { userId } });
      const result = data?.libraryScan;
      // Three-way branch: null (owner gone) / typed error member / payload.
      // ScanAlreadyRunningError is NOT a failure — it is the attach path, the
      // equivalent of the REST route's 409, and it carries the live status.
      // Both it and LibraryScanPayload leave progress to `useScanProgress`,
      // so neither needs anything read off the payload here.
      if (!result) setStartError('Failed to start scan');
    } catch (err) {
      setStartError(err instanceof Error ? err.message : undefined);
    } finally {
      setStarting(false);
    }
  }, [running, userId, startScan]);

  // Fire the completion side effects once per finished job, not on every
  // re-render while the terminal status stays in the cache.
  const completedJobRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (status?.state !== 'COMPLETED' || status.id === completedJobRef.current) return;
    completedJobRef.current = status.id;
    clearCompleteBookIds();
    void fetchBookList();
  }, [status?.state, status?.id, clearCompleteBookIds, fetchBookList]);

  const scanResult = useMemo<ScanResult | undefined>(() => {
    if (status?.state !== 'COMPLETED') return undefined;
    return {
      // `ScanResult.imported` is [Book!]! in GraphQL; `importedFilenames` is the
      // string list this tuple has always carried (REST parity).
      imported: status.result?.importedFilenames ?? [],
      removed: status.result?.removed ?? [],
    };
  }, [status?.state, status?.result]);

  const failed = status?.state === 'FAILED' || startError !== undefined;
  const errorMessage = status?.error ?? startError ?? undefined;

  return useMemo(
    () =>
      [
        scanLibrary,
        failed ? undefined : scanResult,
        running,
        failed,
        failed ? errorMessage : undefined,
      ] as UseScanLibrary,
    [scanLibrary, scanResult, running, failed, errorMessage]
  );
};
```

Verify the REST references are gone:

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && grep -n "apiFetch\|scan/status" app/client/src/provider/book/hook/use-scan-library.ts; echo "EXIT: $?"
```

Expected: grep prints nothing and exits 1.

- [ ] **Step 8: Rewrite the existing scan test**

Replace `app/client/src/provider/book/hook/use-scan-library.test.tsx` entirely with:

```tsx
import { waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { LibraryScanDocument, LibraryScanStatusDocument, ScanProgressDocument } from '~/graphql/scan';
import { renderWithApollo } from '~/test-utils';

import { Context } from '../context';
import { useScanLibrary } from './use-scan-library';

const LIBRARY_ID = 'LIB-1';
const USER_ID = 'USER-1';

vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({ libraryId: LIBRARY_ID, loading: false }),
}));

const fetchBookList = vi.fn();
vi.mock('./use-fetch-book-list', () => ({ useFetchBookList: () => fetchBookList }));

const status = (overrides: Record<string, unknown>) => ({
  __typename: 'ScanStatus' as const,
  id: 'job-1',
  state: 'RUNNING',
  phase: 'IMPORTING',
  processed: 0,
  total: 10,
  currentFile: null,
  startedAt: '2026-08-03T00:00:00.000Z',
  error: null,
  result: null,
  ...overrides,
});

const libraryNode = (scanStatus: ReturnType<typeof status> | null) => ({
  node: {
    __typename: 'Library' as const,
    id: LIBRARY_ID,
    user: { __typename: 'User' as const, id: USER_ID },
    scanStatus,
  },
});

const statusMock = (scanStatus: ReturnType<typeof status> | null) => ({
  request: { query: LibraryScanStatusDocument, variables: { libraryId: LIBRARY_ID } },
  result: { data: libraryNode(scanStatus) },
});

/** The stream stays silent unless a test supplies its own event mock. */
const silentStream = {
  request: { query: ScanProgressDocument, variables: { libraryId: LIBRARY_ID } },
  result: { data: { scanProgress: status({}) } },
  delay: 100_000,
};

const clearCompleteBookIds = vi.fn();

const renderScanLibrary = (mocks: Parameters<typeof renderWithApollo>[1]['mocks']) => {
  const result: { current?: ReturnType<typeof useScanLibrary> } = {};
  const Probe = () => {
    result.current = useScanLibrary();
    return null;
  };
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <Context.Provider value={{ clearCompleteBookIds } as never}>{children}</Context.Provider>
  );
  renderWithApollo(
    <Wrapper>
      <Probe />
    </Wrapper>,
    { mocks }
  );
  return result;
};

describe('useScanLibrary', () => {
  it('reports a running scan on first render, with no mutation sent', async () => {
    const result = renderScanLibrary([statusMock(status({ state: 'RUNNING' })), silentStream]);

    // The old hook needed a mount-time "attach" effect for this; it is now
    // structural, because the status read runs alongside the stream.
    await waitFor(() => expect(result.current?.[2]).toBe(true));
  });

  it('starts a scan with the library owner userId, not the library id', async () => {
    const scanMock = {
      request: { query: LibraryScanDocument, variables: { userId: USER_ID } },
      result: {
        data: {
          libraryScan: {
            __typename: 'LibraryScanPayload' as const,
            scanStatus: status({ state: 'RUNNING' }),
          },
        },
      },
    };
    const result = renderScanLibrary([statusMock(null), silentStream, scanMock]);

    await waitFor(() => expect(result.current).toBeDefined());
    await result.current?.[0]();

    // MockLink throws on an unmatched request, so reaching here without an
    // error proves `userId` (not libraryId) was sent.
    await waitFor(() => expect(result.current?.[3]).toBe(false));
  });

  it('treats ScanAlreadyRunningError as attach, not failure', async () => {
    const scanMock = {
      request: { query: LibraryScanDocument, variables: { userId: USER_ID } },
      result: {
        data: {
          libraryScan: {
            __typename: 'ScanAlreadyRunningError' as const,
            message: 'A scan is already running',
            scanStatus: status({ state: 'RUNNING' }),
          },
        },
      },
    };
    const result = renderScanLibrary([statusMock(null), silentStream, scanMock]);

    await waitFor(() => expect(result.current).toBeDefined());
    await result.current?.[0]();

    expect(result.current?.[3]).toBe(false);
  });

  it('refreshes the book list once when a scan completes', async () => {
    fetchBookList.mockClear();
    clearCompleteBookIds.mockClear();

    renderScanLibrary([
      statusMock(
        status({
          state: 'COMPLETED',
          result: {
            __typename: 'ScanResult',
            imported: [],
            importedFilenames: ['dune.epub'],
            removed: [],
          },
        })
      ),
      silentStream,
    ]);

    await waitFor(() => expect(fetchBookList).toHaveBeenCalledTimes(1));
    expect(clearCompleteBookIds).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed scan with its message', async () => {
    const result = renderScanLibrary([
      statusMock(status({ state: 'FAILED', error: 'disk full' })),
      silentStream,
    ]);

    await waitFor(() => expect(result.current?.[3]).toBe(true));
    expect(result.current?.[4]).toBe('disk full');
  });
});
```

Run it:

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npx vitest run src/provider/book/hook/use-scan-library.test.tsx --root app/client
```

Expected: PASS, 5 tests.

- [ ] **Step 9: Run the full suites and lint**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration
npm run codegen -w app/client
npm test -w app/client
npm test -w app/server
npm run test:cost -w app/server
npm run lint
```

Expected: all green. The cost table now lists `ViewerBootstrap`, `LibraryScanStatus`, `ScanProgress`, and `LibraryScan`, all well under 70%.

- [ ] **Step 10: Commit**

```bash
git add app/client/src/graphql/scan.ts app/client/src/gql \
        app/client/src/provider/book/hook/use-scan-progress.ts \
        app/client/src/provider/book/hook/use-scan-progress.test.tsx \
        app/client/src/provider/book/hook/use-scan-library.ts \
        app/client/src/provider/book/hook/use-scan-library.test.tsx
git commit -m "feat(client): stream scan progress over GraphQL subscription, drop the polling loop"
```

---

## Definition of done for this plan

- `npm run lint` clean **from the repo root** (includes the codegen freshness check).
- The selection-key guardrail passes as part of `npm test -w app/client` (Task 6 is a test, not a lint script).
- `npm test -w app/client` green; `npm test -w app/server` green at 1939+.
- `npm run test:cost -w app/server` green — 30 calibration tests plus 3 client-operation tests.
- `use-scan-library.ts` contains no `apiFetch` and no reference to `/api/books/scan/status`.
- Every seen-to-fail break listed above has been performed and observed failing, with the observed failure recorded in that task's commit message.

## What this plan does NOT do

Steps 3–10 of the spec's sequencing — `/devices`, `/users`, the library-target reshape and `/library` grid, book detail, book edit, progress, upload, and the final sweep. Those need the generated types, `cacheConfig`, and shared helpers this plan produces before their tasks can be written without placeholders. `useCurrentLibraryId` returns `undefined` for admins until the library-target reshape lands, and the four server-state providers are all still in place.
