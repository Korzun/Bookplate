# GraphQL Read Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the whole app read surface over GraphQL — `User`, `Library`, `Book`, `Series`, `Validation`, `Progress`, `PendingFix`, `Device`, and the paginated `LibraryEntry` feed — with every tenant-owned entity reachable only by its owner or an admin.

**Architecture:** Pothos `prismaNode`/`prismaObject` types read through `context.prisma` so selections drive the SQL; the existing store classes stay the write path and are called only where read logic already lives in them (the interleaved feed, search suggestions, lineage). A `Library` object backed by an `Owner { userId, username }` is the single place ownership is decided for traversal, and a shared owner-scoped `findUnique` closes the `Query.node` back door.

**Tech Stack:** TypeScript, graphql 16, graphql-yoga 5, Pothos 4 (`core`, `plugin-relay`, `plugin-scope-auth`, `plugin-errors`, `plugin-prisma`, `plugin-validation`), Prisma 7 + better-sqlite3, Vitest.

**Source spec:** `docs/superpowers/specs/2026-07-30-graphql-server-design.md` — read its **"Phase 1 outcome"** section first. It records what phase 1 settled and what it left open; several decisions below are only intelligible against it.

**Predecessor:** `docs/superpowers/plans/2026-07-30-graphql-server-foundation.md` (delivery steps 1–2, merged as `db4035f8..28deb010`).

**Scope:** Delivery step 3 of the spec. The 23 mutations (step 4) and the scan-progress subscription (step 5) get their own plan, written once these models exist. No client changes; REST untouched.

**Deliberately deferred:** `Library.scanStatus` is part of the spec's `Library` type but is not built here. It is the reconnect path for the scan subscription, and its `ScanStatus`/`ScanState`/`ScanPhase` types only make sense alongside the `ScanJobStore` reducer that step 5 introduces. Building the query form now would mean designing those types twice.

## Global Constraints

- **No classes in new code** under `app/server/graphql/`. Modules of exported functions; dependencies arrive as arguments.
- **No in-place mutation.** Derive new values rather than modifying existing ones.
- **No `any`.** `typescript/no-explicit-any` is an *error* in `app/server/.oxlintrc.json`. Use `unknown` plus narrowing, or a concrete `as` cast.
- **Unused identifiers must be prefixed `_`** (`argsIgnorePattern: "^_"`).
- **Existing store classes are consumed as-is** — never refactored. Adding a *read* method to a store is allowed where the plan says so; changing an existing signature is not.
- **REST stays untouched and green.** No edits under `app/server/routes/`, and none to `server.ts` or `index.ts`.
- **No client changes.** Nothing under `app/client/`.
- **Pothos builder registration is side-effectful by design** — `builder.*` at module scope and side-effect imports in `schema/**/index.ts` are the framework's model and are exempt from the functional rule.
- **Every tenant-owned `prismaNode` MUST supply the owner-scoped `findUnique` from Task 3.** A node type without it is a cross-tenant read hole. Task 3's generic test enforces this.
- **`dmmf: getDatamodel()`** is already set on the builder and must stay — the plugin cannot resolve the datamodel from a context-function client without it.
- Plugin order is `[Relay, ScopeAuth, Errors, Prisma, Validation]` and is load-bearing in two documented ways. Do not reorder.
- Tests: `npm test -w app/server` from the repo root. Lint: `npm run lint` **from the repo root only** (two workspaces; running inside one silently skips the other). Lint includes `graphql:schema:check`, so **regenerate the SDL** (`npm run graphql:schema -w app/server`) whenever the schema changes and commit the artifact.
- Commit convention: `feat(graphql): lowercase summary`.

---

## File Structure

Following the convention established in phase 1: one entity per directory, one field per file, each field self-registering via a side-effect import from the entity's `index.ts`. Most `query/` files register onto **`Library`** via `builder.objectField`, not onto `Query`.

**Created:**

| Path | Responsibility |
|---|---|
| `app/server/graphql/derive.ts` | Pure derivations shared across read paths: JSON column parsing, epoch conversion, CFI-to-chapter. (No validity derivation — `Validation.valid` is a stored column.) |
| `app/server/graphql/derive.test.ts` | Table-driven tests for the above |
| `app/server/graphql/owner.ts` | `resolveOwner(context, userId)` with per-request memoization |
| `app/server/graphql/owner.test.ts` | |
| `app/server/graphql/schema/node-scope.ts` | `ownerScopedFindUnique` — the shared owner-scoped `findUnique` builder |
| `app/server/graphql/schema/node-scope.test.ts` | Generic cross-tenant test walking every `Node` type |
| `app/server/graphql/schema/user/{index,model}.ts` | `User` prismaNode |
| `app/server/graphql/schema/user/query/get.ts` | `Query.user(id:)` — admin scope |
| `app/server/graphql/schema/library/{index,model}.ts` | `Library` node + `subjects`, `authors` |
| `app/server/graphql/schema/library/query/{viewer-library,user-library}.ts` | `Viewer.library`, `User.library` (`ownerOf` gate) |
| `app/server/graphql/schema/book/{index,model}.ts` | `Book` prismaNode |
| `app/server/graphql/schema/book/node-loader.ts` | `Book`'s owner-scoped `findUnique` |
| `app/server/graphql/schema/book/query/{get,get-all,search-suggestions,lineage}.ts` | `Library.book`, `Library.entries`, `Library.searchSuggestions`, `Book.lineage` |
| `app/server/graphql/schema/series/{index,model,node-loader}.ts` + `query/{get,get-all,next-index}.ts` | |
| `app/server/graphql/schema/validation/{index,model,node-loader}.ts` | `Validation`, `ValidationMessage` |
| `app/server/graphql/schema/progress/{index,model}.ts` + `query/get-all.ts` | |
| `app/server/graphql/schema/pending-fix/{index,model}.ts` + `query/get-all.ts` | |
| `app/server/graphql/schema/device/{index,model}.ts` + `query/get-all.ts` | |
| `app/server/graphql/schema/library-entry.ts` | The `Book | Series` union and its connection |

**Modified:** `app/server/graphql/context.ts` (a request-scoped loader field), `app/server/graphql/schema/viewer/model.ts` (`user`, `library`, `users`, `syncPassword`), `app/server/graphql/schema/index.ts` (side-effect imports), `app/server/graphql/schema.generated.graphql` (regenerated).

**Added by the final fix wave** — the six fields this table already promised but no task owned, plus the four REST reads with no GraphQL home:

| Path | Responsibility |
|---|---|
| `app/server/graphql/schema/user/query/{viewer-user,get-all,sync-password}.ts` | `Viewer.user`, `Viewer.users` (admin), `Viewer.syncPassword` |
| `app/server/graphql/schema/user/query/device-enabled-users.ts` | `Device.enabledUsers` (admin), matching `GET /api/devices/:id/users` |
| `app/server/graphql/schema/book/device-edition-count.ts` | `Book.deviceEditionCount` |
| `app/server/graphql/schema/config/{index,model}.ts` + `query/get.ts` | `Query.config`, matching `GET /api/config` |
| `app/server/graphql/schema/pagination.ts` | `rejectBackwardPagination`, shared by both connections |
| `app/server/graphql/chapter-spine-map-loader.ts` | Request-scoped batching loader behind `Progress.currentChapter` |

`Library.subjects`/`Library.authors` landed where this table always said they would, in `library/model.ts`. `app/server/utils/progress-pagination.ts` gained `encodeProgressCursor` and `clampProgressTake`, with `parseProgressTake` refactored to delegate to the latter so REST and GraphQL share one set of bounds.

---

### Task 1: Shared pure derivations

The spec requires the GraphQL and OPDS read paths to share their derivations so they cannot drift. Four columns are JSON strings in SQLite (`identifiers`, `subjects`, `chapterSpineMap`, `chapterNames`), and validity is derived from a stored `Validation` row.

**Files:**
- Create: `app/server/graphql/derive.ts`
- Test: `app/server/graphql/derive.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `parseIdentifiers(json: string): { scheme: string; value: string }[]`
  - `parseStringArray(json: string): string[]`
  - `parseNumberArray(json: string): number[]`
  - `parseNullableStringArray(json: string | null): string[] | null`
  - `epochToDate(ms: number): Date`

- [ ] **Step 1: Write the failing test**

Create `app/server/graphql/derive.test.ts`:

```ts
import {
  epochToDate,
  parseIdentifiers,
  parseNullableStringArray,
  parseNumberArray,
  parseStringArray,
} from './derive';

describe('parseIdentifiers', () => {
  it('parses a well-formed identifier array', () => {
    expect(parseIdentifiers('[{"scheme":"ISBN","value":"9780441013593"}]')).toEqual([
      { scheme: 'ISBN', value: '9780441013593' },
    ]);
  });

  it('returns an empty array for the default empty-array column value', () => {
    expect(parseIdentifiers('[]')).toEqual([]);
  });

  it('returns an empty array rather than throwing on malformed JSON', () => {
    expect(parseIdentifiers('{not json')).toEqual([]);
  });

  it('drops entries that are not shaped like an identifier', () => {
    expect(parseIdentifiers('[{"scheme":"ISBN","value":"1"},"nope",{"scheme":2}]')).toEqual([
      { scheme: 'ISBN', value: '1' },
    ]);
  });
});

describe('parseStringArray', () => {
  it('parses a subject list', () => {
    expect(parseStringArray('["Fantasy","Epic"]')).toEqual(['Fantasy', 'Epic']);
  });

  it('returns an empty array on malformed JSON', () => {
    expect(parseStringArray('nope')).toEqual([]);
  });

  it('drops non-string entries', () => {
    expect(parseStringArray('["Fantasy",7,null]')).toEqual(['Fantasy']);
  });
});

describe('parseNumberArray', () => {
  it('parses a chapter spine map', () => {
    expect(parseNumberArray('[0,3,7]')).toEqual([0, 3, 7]);
  });

  it('drops non-finite entries', () => {
    expect(parseNumberArray('[0,"x",null]')).toEqual([0]);
  });
});

describe('parseNullableStringArray', () => {
  it('returns null when the column is null', () => {
    expect(parseNullableStringArray(null)).toBeNull();
  });

  it('parses chapter names when present', () => {
    expect(parseNullableStringArray('["One","Two"]')).toEqual(['One', 'Two']);
  });
});

describe('epochToDate', () => {
  it('converts stored epoch milliseconds to a Date', () => {
    expect(epochToDate(1_700_000_000_000).toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });
});
```

Malformed-JSON tolerance matters: these columns are written by the import pipeline, and a single bad row must degrade one field rather than fail the whole query.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w app/server -- graphql/derive
```

Expected: FAIL — `Cannot find module './derive'`.

- [ ] **Step 3: Write the implementation**

Create `app/server/graphql/derive.ts`:

```ts
/**
 * Pure derivations over the columns SQLite stores as JSON strings.
 *
 * These are shared deliberately: the GraphQL read path reads Prisma rows
 * directly while OPDS reads through BookStore, and both must agree on what a
 * row means. Keeping the interpretation in one pure module is what stops the
 * two paths drifting.
 *
 * Every parser is total — malformed JSON degrades to an empty value rather
 * than throwing, so one bad row cannot fail an entire query.
 */

const parseJson = (json: string): unknown => {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
};

export type Identifier = { scheme: string; value: string };

const isIdentifier = (value: unknown): value is Identifier =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { scheme?: unknown }).scheme === 'string' &&
  typeof (value as { value?: unknown }).value === 'string';

export const parseIdentifiers = (json: string): Identifier[] => {
  const parsed = parseJson(json);
  return Array.isArray(parsed) ? parsed.filter(isIdentifier) : [];
};

export const parseStringArray = (json: string): string[] => {
  const parsed = parseJson(json);
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
};

export const parseNumberArray = (json: string): number[] => {
  const parsed = parseJson(json);
  return Array.isArray(parsed)
    ? parsed.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    : [];
};

export const parseNullableStringArray = (json: string | null): string[] | null =>
  json === null ? null : parseStringArray(json);

/** `mtime` and `addedAt` are stored as Float epoch milliseconds. */
export const epochToDate = (ms: number): Date => new Date(ms);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -w app/server -- graphql/derive
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add app/server/graphql/derive.ts app/server/graphql/derive.test.ts
git commit -m "feat(graphql): add shared pure derivations for JSON columns"
```

---

### Task 2: Request-scoped owner resolution

Nearly every `Library` field needs the owner's **username** as well as their id, because the books directory on disk is named by username. Resolving it per field would issue the same query dozens of times in one request. The spec flags this (open question #4) as cheaper to add now than to thread through thirty resolvers later.

**Files:**
- Modify: `app/server/graphql/context.ts`
- Create: `app/server/graphql/owner.ts`
- Test: `app/server/graphql/owner.test.ts`

**Interfaces:**
- Consumes: `Context` from phase 1
- Produces:
  - `createOwnerLoader(prisma: PrismaClient): OwnerLoader` where `OwnerLoader = (userId: string) => Promise<Owner | null>`
  - `Context` gains `loadOwner: OwnerLoader`
  - `ContextDeps` is unchanged; `createContext` builds a fresh loader per request

- [ ] **Step 1: Write the failing test**

Create `app/server/graphql/owner.test.ts`:

```ts
import { createHarness, type Harness } from './test-util';
import { createOwnerLoader } from './owner';

vi.mock('../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

describe('createOwnerLoader', () => {
  it('resolves a userId to its Owner', async () => {
    const load = createOwnerLoader(harness.prisma);

    expect(await load(harness.aliceOwner.userId)).toEqual({
      userId: harness.aliceOwner.userId,
      username: 'alice',
    });
  });

  it('returns null for an unknown userId', async () => {
    const load = createOwnerLoader(harness.prisma);

    expect(await load('does-not-exist')).toBeNull();
  });

  it('queries once for repeated lookups of the same userId', async () => {
    const spy = vi.spyOn(harness.prisma.user, 'findUnique');
    const load = createOwnerLoader(harness.prisma);

    await load(harness.aliceOwner.userId);
    await load(harness.aliceOwner.userId);
    await load(harness.aliceOwner.userId);

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('caches the miss too, so a bad id cannot be queried repeatedly', async () => {
    const spy = vi.spyOn(harness.prisma.user, 'findUnique');
    const load = createOwnerLoader(harness.prisma);

    await load('does-not-exist');
    await load('does-not-exist');

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
```

The third and fourth tests are the point of the task — without them this is just a wrapper around `findUnique`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w app/server -- graphql/owner
```

Expected: FAIL — `Cannot find module './owner'`.

- [ ] **Step 3: Write the implementation**

Create `app/server/graphql/owner.ts`:

```ts
import type { PrismaClient } from '@prisma/client';

import type { Owner } from '../types';

export type OwnerLoader = (userId: string) => Promise<Owner | null>;

/**
 * Resolves a userId to a full Owner (userId + username), memoized for the life
 * of one request. The username is needed because the books directory on disk is
 * named by it, so nearly every Library field wants this — without memoization
 * a single query would repeat the same lookup dozens of times.
 *
 * A fresh loader is built per request in createContext; it is never shared
 * across requests, so a renamed or deleted user cannot be served from a stale
 * entry.
 */
export const createOwnerLoader = (prisma: PrismaClient): OwnerLoader => {
  const cache = new Map<string, Promise<Owner | null>>();

  return (userId: string): Promise<Owner | null> => {
    const cached = cache.get(userId);
    if (cached !== undefined) return cached;

    const pending = prisma.user
      .findUnique({ where: { id: userId }, select: { id: true, username: true } })
      .then((row) => (row === null ? null : { userId: row.id, username: row.username }));

    cache.set(userId, pending);
    return pending;
  };
};
```

Caching the *promise* rather than the resolved value is what makes concurrent field resolution share one query — Pothos resolves sibling fields in parallel, so caching after `await` would still fire several.

- [ ] **Step 4: Wire it into the context**

In `app/server/graphql/context.ts`, add `loadOwner: OwnerLoader` to `Context`, and build one per request in `createContext`:

```ts
  ({ request }: { request: FetchRequest }): Context => ({
    viewer: viewerFromHeader(deps.jwtSecret, request.headers.get('authorization') ?? undefined),
    prisma: deps.prisma,
    stores: deps.stores,
    config: deps.config,
    loadOwner: createOwnerLoader(deps.prisma),
  });
```

Update `test-util.ts`'s `execute` to build one the same way, so schema-level tests exercise the real loader.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test -w app/server -- graphql/owner graphql/context graphql/schema
```

Expected: PASS. The existing context and viewer tests must stay green — if they fail, the `Context` shape changed in a way they assert on.

- [ ] **Step 6: Commit**

```bash
git add app/server/graphql/owner.ts app/server/graphql/owner.test.ts \
  app/server/graphql/context.ts app/server/graphql/test-util.ts
git commit -m "feat(graphql): add request-scoped owner resolution to the context"
```

---

### Task 3: Owner-scoped node loader — the `Query.node` guard

**Read the spec's open question #1 before starting.** `prismaNode` builds its lookup as `where: { userId_id: idParser(globalId) }`, taking the `userId` from *the caller's own global ID*. Without an override, any authenticated user can fetch any other user's row by ID. This task builds the guard every tenant-owned node type must use, and the generic test that proves none is missing it.

**Files:**
- Create: `app/server/graphql/schema/node-scope.ts`
- Test: `app/server/graphql/schema/node-scope.test.ts`

**Interfaces:**
- Consumes: `Context` (with `viewer`) from phase 1
- Produces: `ownerScopedFindUnique<W>(build: (userId: string, id: string) => W): (globalId: string, context: Context) => W`

- [ ] **Step 1: Write the failing test**

Create `app/server/graphql/schema/node-scope.test.ts`:

```ts
import type { Context } from '../context';
import { NO_MATCH_USER_ID, ownerScopedFindUnique } from './node-scope';

const contextFor = (viewer: Context['viewer']): Context => ({ viewer }) as Context;

const alice = { userId: 'user-alice', username: 'alice', isAdmin: false, mustChangePassword: false };
const bob = { userId: 'user-bob', username: 'bob', isAdmin: false, mustChangePassword: false };
const admin = { userId: null, username: 'admin', isAdmin: true, mustChangePassword: false };

const findUnique = ownerScopedFindUnique((userId: string, id: string) => ({
  userId_id: { userId, id },
}));

describe('ownerScopedFindUnique', () => {
  it('builds the real clause when the viewer owns the row', () => {
    expect(findUnique('user-alice:book-1', contextFor(alice))).toEqual({
      userId_id: { userId: 'user-alice', id: 'book-1' },
    });
  });

  it('builds the real clause for an admin reading another user row', () => {
    expect(findUnique('user-alice:book-1', contextFor(admin))).toEqual({
      userId_id: { userId: 'user-alice', id: 'book-1' },
    });
  });

  it('builds a clause that cannot match when the viewer does not own the row', () => {
    expect(findUnique('user-alice:book-1', contextFor(bob))).toEqual({
      userId_id: { userId: NO_MATCH_USER_ID, id: 'book-1' },
    });
  });

  it('does not substitute the requester own userId on denial', () => {
    // Book ids are content hashes, so bob may legitimately own a row with the
    // same id. Substituting his userId would silently return a DIFFERENT valid
    // row instead of nothing.
    const clause = findUnique('user-alice:book-1', contextFor(bob));

    expect(clause.userId_id.userId).not.toBe('user-bob');
  });

  it('cannot match when there is no viewer at all', () => {
    expect(findUnique('user-alice:book-1', contextFor(null)).userId_id.userId).toBe(
      NO_MATCH_USER_ID
    );
  });

  it('cannot match when the global id is malformed', () => {
    expect(findUnique('garbage', contextFor(alice)).userId_id.userId).toBe(NO_MATCH_USER_ID);
  });
});
```

The fourth test encodes the non-obvious rule: `Book.id` is a 32-char partial MD5 of the file, which is exactly why the primary key is composite — two users routinely hold the same id for the same EPUB.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w app/server -- graphql/schema/node-scope
```

Expected: FAIL — `Cannot find module './node-scope'`.

- [ ] **Step 3: Write the implementation**

Create `app/server/graphql/schema/node-scope.ts`:

```ts
import type { Context } from '../context';

/**
 * A userId that cannot exist, used to build a where-clause guaranteed to match
 * no row. Denials resolve the node field to null — indistinguishable from a
 * nonexistent id.
 *
 * Deliberately NOT the requesting viewer's own userId: book ids are content
 * hashes (partial MD5), so two users routinely hold the same id for the same
 * file, and substituting would silently return a different, valid row. For the
 * same reason denial must not throw — confirming the row exists would leak
 * "another user has this exact file".
 */
export const NO_MATCH_USER_ID = 'no-such-user';

/**
 * Wraps a compound-key where-clause builder so the row is only reachable by its
 * owner or an admin.
 *
 * WHY THIS EXISTS: prismaNode's default lookup takes the userId half of the
 * compound key from the caller's own global ID, so without this every tenant-
 * owned node type is a cross-tenant read. Every such type must pass its
 * findUnique through here; node-scope.test.ts enforces that generically.
 */
export const ownerScopedFindUnique =
  <W>(build: (userId: string, id: string) => W) =>
  (localId: string, context: Context): W => {
    const parsed = parseCompoundId(localId);
    if (parsed === null) return build(NO_MATCH_USER_ID, localId);

    const [userId, id] = parsed;
    const viewer = context.viewer;
    const allowed = viewer !== null && (viewer.isAdmin || viewer.userId === userId);

    return allowed ? build(userId, id) : build(NO_MATCH_USER_ID, id);
  };
```

**CORRECTED — the format was verified empirically and is not what this plan originally assumed.**
An earlier draft parsed on a `:` delimiter. That is wrong. Pothos hands a custom `findUnique` the
**local** id (the global ID already decoded), and for a compound key that local id is
`JSON.stringify([userId, id])` — e.g. `["alice-id","bookhash"]`, not `"alice-id:bookhash"`.

This was confirmed by instrumenting a real `prismaNode('Book', …)` build and logging the exact
string a custom `findUnique` received, and the colon parser was proved wrong by substitution: it
failed 3 of 6 unit tests. Had it shipped it would have failed **closed for every legitimate
owner** — every read returning null, no leak, but silently broken.

Write `parseCompoundId` to parse the JSON array form, returning `null` for anything that is not a
two-string array. Keep the total, non-throwing style of `derive.ts`: a malformed id must yield a
never-matching clause, never an exception.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -w app/server -- graphql/schema/node-scope
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Add the generic cross-tenant guard test**

Append to `app/server/graphql/schema/node-scope.test.ts`. This is the durable half — it covers node types that do not exist yet:

```ts
import { graphql, GraphQLObjectType } from 'graphql';

import { createHarness, type Harness } from '../test-util';
import { schema } from './index';

vi.mock('../../logger');

describe('every Node type refuses cross-tenant reads', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  const nodeInterface = schema.getType('Node');
  const nodeTypes = Object.values(schema.getTypeMap()).filter(
    (type): type is GraphQLObjectType =>
      type instanceof GraphQLObjectType &&
      nodeInterface !== undefined &&
      type.getInterfaces().some((i) => i.name === 'Node')
  );

  it('has at least one Node type, or this suite proves nothing', () => {
    expect(nodeTypes.length).toBeGreaterThan(0);
  });

  it.each(nodeTypes.map((t) => t.name))(
    '%s is not readable by a non-owner via Query.node',
    async (typeName) => {
      const globalId = await harness.seedNodeFor(typeName);

      const denied = await harness.execute('query ($id: ID!) { node(id: $id) { __typename } }', {
        viewer: harness.bobViewer,
        variables: { id: globalId },
      });
      expect(denied.data?.node ?? null).toBeNull();

      // Positive control. Without this the assertion above passes for any
      // reason at all — a malformed ID, an unregistered type, a typo in the
      // encoding — and the suite would report a guard that does not exist.
      const allowed = await harness.execute('query ($id: ID!) { node(id: $id) { __typename } }', {
        viewer: harness.aliceViewer,
        variables: { id: globalId },
      });
      expect((allowed.data as { node: { __typename: string } } | null)?.node?.__typename).toBe(
        typeName
      );
    }
  );
});
```

Two harness additions are needed, and both are load-bearing:

- A second user: create `bob` alongside `alice` and expose `bobOwner` / `bobViewer`.
- `seedNodeFor(typeName): Promise<string>` — inserts a minimal row owned by **alice** for that type and returns its **real** global ID, read back from the schema rather than hand-encoded. Hand-encoding the ID is what makes the positive control necessary; reading it back is what makes the negative assertion meaningful. When a new node type appears with no seeding branch, `seedNodeFor` must **throw** rather than return a bogus ID — a silent skip is how this suite would quietly stop covering the type it was written for.

- [ ] **Step 6: Run the tests**

```bash
npm test -w app/server -- graphql/schema/node-scope
```

Expected: PASS. Today only `Library`/`User` may implement `Node`; the suite grows automatically as later tasks add types.

- [ ] **Step 7: Commit**

```bash
git add app/server/graphql/schema/node-scope.ts app/server/graphql/schema/node-scope.test.ts \
  app/server/graphql/test-util.ts
git commit -m "feat(graphql): add owner-scoped node lookups and a generic cross-tenant guard"
```

---

### Task 4: `User` node and `Query.user`

**Files:**
- Create: `app/server/graphql/schema/user/{index,model}.ts`, `app/server/graphql/schema/user/query/get.ts`
- Test: `app/server/graphql/schema/user/query/get.test.ts`
- Modify: `app/server/graphql/schema/index.ts`

**Interfaces:**
- Consumes: `builder`, `ownerScopedFindUnique`
- Produces: `model` (the `User` node ref), imported by `Library` and by `Viewer`

- [ ] **Step 1: Write the failing test**

Create `app/server/graphql/schema/user/query/get.test.ts`:

```ts
import { createHarness, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const USER_QUERY = 'query ($id: ID!) { user(id: $id) { id username mustChangePassword } }';

describe('Query.user', () => {
  it('returns a user for an admin', async () => {
    const result = await harness.execute(USER_QUERY, {
      viewer: harness.adminViewer,
      variables: { id: harness.aliceGlobalId },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.user).toMatchObject({ username: 'alice', mustChangePassword: false });
  });

  it('refuses a non-admin', async () => {
    const result = await harness.execute(USER_QUERY, {
      viewer: harness.aliceViewer,
      variables: { id: harness.aliceGlobalId },
    });

    expect(result.errors?.[0].extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.user ?? null).toBeNull();
  });

  it('refuses an unauthenticated caller', async () => {
    const result = await harness.execute(USER_QUERY, {
      viewer: null,
      variables: { id: harness.aliceGlobalId },
    });

    expect(result.errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');
  });
});
```

Add `aliceGlobalId` to the harness — the encoded `User` global ID, so tests do not hand-roll the encoding.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w app/server -- graphql/schema/user
```

Expected: FAIL — `Cannot find module` for the user schema directory.

- [ ] **Step 3: Write the model**

Create `app/server/graphql/schema/user/model.ts`:

```ts
import { builder } from '../builder';

export const model = builder.prismaNode('User', {
  id: { field: 'id' },
  fields: (t) => ({
    username: t.exposeString('username'),
    mustChangePassword: t.exposeBoolean('mustChangePassword'),
  }),
});
```

**CORRECTED — an earlier draft of this plan exempted `User` from the node guard. That was wrong,
and it was a real data leak.** The original reasoning was that a `User` global ID contains only
that user's own id, so there is nothing to cross-tenant, and that the `admin` scope on `Query.user`
was sufficient. It is not: **`Query.node(id:)` is a second door that bypasses `Query.user`
entirely.** Any authenticated user could hand `node()` another user's global ID and read their
`username` and `mustChangePassword`. This was reproduced during execution, and it is precisely the
class of hole Task 3's guard exists to close — exempting a type from the guard using the same
reasoning the guard was built to defeat.

`User` therefore carries a node-level guard like every other node type. Its key is a plain `id`
that *is* the userId, so the sentinel slots in directly:

```ts
findUnique: (id: string, context: Context) => {
  const viewer = context.viewer;
  const allowed = viewer !== null && (viewer.isAdmin || viewer.userId === id);
  return { id: allowed ? id : NO_MATCH_USER_ID };
},
nullable: true,
```

Import `NO_MATCH_USER_ID` from `../node-scope`; never re-declare it. `nullable: true` is required —
without it `prismaNode` uses `findUniqueOrThrow` and a denied lookup raises instead of resolving to
null. **There is now no exception to the rule: every node type carries a guard.**

Note `passwordHash` and `syncPassword` are deliberately absent from the field list — `syncPassword`
is exposed on `Viewer` only, for the viewer's own account.

Create `app/server/graphql/schema/user/query/get.ts`:

```ts
import { builder } from '../../builder';
import { model } from '../index';

builder.queryField('user', (t) =>
  t.prismaField({
    type: model,
    nullable: true,
    authScopes: { admin: true },
    args: { id: t.arg.globalID({ required: true }) },
    resolve: (query, _parent, args, context) =>
      context.prisma.user.findUnique({ ...query, where: { id: String(args.id.id) } }),
  })
);
```

Create `app/server/graphql/schema/user/index.ts`:

```ts
export { model } from './model';

import './query/get';
```

Add `import './user';` to `app/server/graphql/schema/index.ts`, before the `builder` import.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -w app/server -- graphql/schema/user
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Regenerate the SDL and run the full suite**

```bash
npm run graphql:schema -w app/server
npm test -w app/server
```

Expected: the artifact gains `type User implements Node` and `Query.user`; all tests pass, including `node-scope.test.ts`, which now finds `User` in its walk.

- [ ] **Step 6: Commit**

```bash
git add app/server/graphql/schema/user app/server/graphql/schema/index.ts \
  app/server/graphql/schema.generated.graphql app/server/graphql/test-util.ts
git commit -m "feat(graphql): add the User node and admin-scoped Query.user"
```

---

### Task 5: `Library` and the ownership gate

This is the security centre of the read model. `Library` is backed by an `Owner`, and only two resolvers can mint one: `Viewer.library` (self, by construction) and `User.library` (scope-checked). Every field beneath a `Library` then reads the owner off its parent, so ownership is decided in one place rather than per field.

**Files:**
- Create: `app/server/graphql/schema/library/{index,model}.ts`, `library/query/{viewer-library,user-library}.ts`
- Test: `app/server/graphql/schema/library/query/user-library.test.ts`
- Modify: `app/server/graphql/schema/viewer/model.ts`, `app/server/graphql/schema/index.ts`

**Interfaces:**
- Consumes: `builder`, `Owner`, `User` model, `loadOwner`
- Produces: `model` — a `builder.objectRef<Owner>('Library')` implementing `Node`; every later task registers its fields onto this ref via `builder.objectField`

- [ ] **Step 1: Write the failing test**

Create `app/server/graphql/schema/library/query/user-library.test.ts`:

```ts
import { createHarness, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const LIB = 'query ($id: ID!) { user(id: $id) { library { id user { username } } } }';

describe('Library ownership', () => {
  it('an admin can traverse to any user library', async () => {
    const result = await harness.execute(LIB, {
      viewer: harness.adminViewer,
      variables: { id: harness.aliceGlobalId },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.user?.library?.user?.username).toBe('alice');
  });

  it('viewer.library is the viewer own library', async () => {
    const result = await harness.execute('{ viewer { library { user { username } } } }', {
      viewer: harness.aliceViewer,
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.viewer?.library?.user?.username).toBe('alice');
  });

  it('viewer.library is null for the config admin, which owns no library', async () => {
    const result = await harness.execute('{ viewer { library { id } } }', {
      viewer: harness.adminViewer,
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.viewer?.library ?? null).toBeNull();
  });

  it('a non-admin cannot reach Query.user at all, so cannot traverse to another library', async () => {
    const result = await harness.execute(LIB, {
      viewer: harness.bobViewer,
      variables: { id: harness.aliceGlobalId },
    });

    expect(result.errors?.[0].extensions?.code).toBe('FORBIDDEN');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w app/server -- graphql/schema/library
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the model and the two entry points**

Create `app/server/graphql/schema/library/model.ts`:

```ts
import type { Owner } from '../../../types';
import { builder } from '../builder';
import * as user from '../user';

/**
 * A Library is backed by an Owner, and only two resolvers can mint one:
 * Viewer.library (self, by construction) and User.library (ownerOf-gated).
 * Every field registered onto this ref therefore trusts its parent — ownership
 * is decided once, at the point the Owner is created, rather than per field.
 */
export const model = builder.objectRef<Owner>('Library');

model.implement({
  interfaces: [], // Node is attached below via builder.node
  fields: (t) => ({
    user: t.field({
      type: user.model,
      resolve: (owner, _args, context) =>
        context.prisma.user.findUniqueOrThrow({ where: { id: owner.userId } }),
    }),
  }),
});

builder.node(model, {
  id: { resolve: (owner) => owner.userId },
  loadOne: async (id, context) => {
    const viewer = context.viewer;
    if (viewer === null) return null;
    if (!viewer.isAdmin && viewer.userId !== id) return null;
    return context.loadOwner(id);
  },
});
```

`Library` is 1:1 with a `User`, so its global ID is the user id under a different type name. `loadOne` carries the same ownership rule as `User.library` — `node(id:)` must not become a second, ungated door to the same object.

Create `app/server/graphql/schema/library/query/viewer-library.ts`:

```ts
import { builder } from '../../builder';
import { model as viewer } from '../../viewer';
import { model as library } from '../index';

builder.objectField(viewer, 'library', (t) =>
  t.field({
    type: library,
    nullable: true,
    // Null for the config-based admin, which has no user row and owns no library.
    resolve: (v, _args, context) =>
      v.userId === null ? null : context.loadOwner(v.userId),
  })
);
```

Create `app/server/graphql/schema/library/query/user-library.ts`:

```ts
import { builder } from '../../builder';
import { model as user } from '../../user';
import { model as library } from '../index';

builder.objectField(user, 'library', (t) =>
  t.field({
    type: library,
    authScopes: (parent) => ({ ownerOf: parent.id }),
    resolve: (parent) => ({ userId: parent.id, username: parent.username }),
  })
);
```

The `ownerOf` scope receives the parsed parent row, so `parent.id` is the raw user id — this is why the plugin order puts Relay before ScopeAuth.

Create `app/server/graphql/schema/library/index.ts`:

```ts
export { model } from './model';

import './query/user-library';
import './query/viewer-library';
```

Register `import './library';` in `schema/index.ts`.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -w app/server -- graphql/schema/library
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Regenerate the SDL, run the full suite and lint**

```bash
npm run graphql:schema -w app/server
npm test -w app/server
npm run lint
```

Expected: all green. `node-scope.test.ts` now walks `User` and `Library`.

- [ ] **Step 6: Commit**

```bash
git add app/server/graphql/schema/library app/server/graphql/schema/viewer \
  app/server/graphql/schema/index.ts app/server/graphql/schema.generated.graphql
git commit -m "feat(graphql): add the Library node and its ownership gate"
```

---

### Task 6: `Book` node

The centrepiece, and the first type to use the Task 3 guard. Four columns arrive as JSON strings and go through `derive.ts`; binary assets are exposed as URLs pointing at the untouched REST endpoints.

**Files:**
- Create: `app/server/graphql/schema/book/{index,model,node-loader}.ts`, `book/query/get.ts`
- Test: `app/server/graphql/schema/book/model.test.ts`
- Modify: `app/server/graphql/schema/index.ts`

**Interfaces:**
- Consumes: `builder`, `ownerScopedFindUnique`, `derive.ts`, `Library` model
- Produces: `model` (the `Book` node ref), consumed by `Series.books`, `LibraryEntry`, `Validation`, `PendingFix`

- [ ] **Step 1: Write the failing test**

Create `app/server/graphql/schema/book/model.test.ts`:

```ts
import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.book.create({
    data: {
      userId: harness.aliceOwner.userId,
      id: 'a'.repeat(32),
      title: 'Dune',
      author: 'Frank Herbert',
      size: 1234,
      mtime: 1_700_000_000_000,
      addedAt: 1_700_000_000_000,
      pageCount: 412,
      chapterCount: 3,
      identifiers: '[{"scheme":"ISBN","value":"9780441013593"}]',
      subjects: '["Fantasy","Epic"]',
      chapterSpineMap: '[0,3,7]',
      chapterNames: '["One","Two","Three"]',
      coverMime: 'image/jpeg',
    },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

const BOOK = `{
  viewer { library { book(id: "${'a'.repeat(32)}") {
    id title author size pageCount
    subjects identifiers { scheme value }
    chapterSpineMap chapterNames
    hasCover coverUrl downloadUrl thumbnailUrl(width: 200)
    mtime addedAt
  } } }
}`;

describe('Book', () => {
  it('parses the JSON-string columns into real fields', async () => {
    const result = await harness.execute(BOOK, { viewer: harness.aliceViewer });

    expect(result.errors).toBeUndefined();
    const book = (result.data as { viewer: { library: { book: Record<string, unknown> } } }).viewer
      .library.book;
    expect(book.subjects).toEqual(['Fantasy', 'Epic']);
    expect(book.identifiers).toEqual([{ scheme: 'ISBN', value: '9780441013593' }]);
    expect(book.chapterSpineMap).toEqual([0, 3, 7]);
    expect(book.chapterNames).toEqual(['One', 'Two', 'Three']);
  });

  it('derives hasCover from the stored mime type and exposes REST URLs', async () => {
    const result = await harness.execute(BOOK, { viewer: harness.aliceViewer });
    const book = (result.data as { viewer: { library: { book: Record<string, unknown> } } }).viewer
      .library.book;

    expect(book.hasCover).toBe(true);
    expect(book.coverUrl).toContain('a'.repeat(32));
    expect(book.downloadUrl).toContain('a'.repeat(32));
    expect(book.thumbnailUrl).toContain('200');
  });

  it('converts epoch-millisecond columns to DateTime', async () => {
    const result = await harness.execute(BOOK, { viewer: harness.aliceViewer });
    const book = (result.data as { viewer: { library: { book: { mtime: string } } } }).viewer.library
      .book;

    expect(book.mtime).toBe('2023-11-14T22:13:20.000Z');
  });

  it('returns null for a book in another user library', async () => {
    const result = await harness.execute(BOOK, { viewer: harness.bobViewer });

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { book: unknown } } }).viewer.library.book ?? null
    ).toBeNull();
  });
});
```

The last test is the traversal half of the tenant guard; Task 3's generic suite covers the `node(id:)` half.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w app/server -- graphql/schema/book
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the node loader**

Create `app/server/graphql/schema/book/node-loader.ts`:

```ts
import type { Prisma } from '@prisma/client';

import { ownerScopedFindUnique } from '../node-scope';

/**
 * Book's owner-scoped lookup. Without this, prismaNode takes the userId half of
 * the compound key from the caller's own global ID — a cross-tenant read for any
 * authenticated user. See the spec's resolved open question #1.
 */
export const findUnique = ownerScopedFindUnique<Prisma.BookWhereUniqueInput>((userId, id) => ({
  userId_id: { userId, id },
}));
```

- [ ] **Step 4: Write the model**

Create `app/server/graphql/schema/book/model.ts`:

```ts
import {
  epochToDate,
  parseIdentifiers,
  parseNullableStringArray,
  parseNumberArray,
  parseStringArray,
} from '../../derive';
import { builder } from '../builder';
import { findUnique } from './node-loader';

const identifier = builder.objectRef<{ scheme: string; value: string }>('Identifier').implement({
  fields: (t) => ({
    scheme: t.exposeString('scheme'),
    value: t.exposeString('value'),
  }),
});

export const model = builder.prismaNode('Book', {
  id: { field: 'userId_id' },
  findUnique,
  nullable: true,
  fields: (t) => ({
    title: t.exposeString('title'),
    titleSort: t.exposeString('titleSort'),
    author: t.exposeString('author'),
    authorSort: t.exposeString('authorSort'),
    description: t.exposeString('description'),
    publisher: t.exposeString('publisher'),
    publishDate: t.exposeString('publishDate'),
    seriesIndex: t.exposeFloat('seriesIndex'),
    size: t.exposeInt('size'),
    pageCount: t.exposeInt('pageCount'),
    chapterCount: t.exposeInt('chapterCount'),

    subjects: t.field({ type: ['String'], resolve: (book) => parseStringArray(book.subjects) }),
    identifiers: t.field({
      type: [identifier],
      resolve: (book) => parseIdentifiers(book.identifiers),
    }),
    chapterSpineMap: t.field({
      type: ['Int'],
      resolve: (book) => parseNumberArray(book.chapterSpineMap),
    }),
    chapterNames: t.field({
      type: ['String'],
      nullable: true,
      resolve: (book) => parseNullableStringArray(book.chapterNames),
    }),

    mtime: t.field({ type: 'DateTime', resolve: (book) => epochToDate(book.mtime) }),
    addedAt: t.field({ type: 'DateTime', resolve: (book) => epochToDate(book.addedAt) }),

    hasCover: t.boolean({ resolve: (book) => book.coverMime !== null }),
    coverUrl: t.string({ resolve: (book) => `/api/books/${book.id}/cover` }),
    downloadUrl: t.string({ resolve: (book) => `/api/books/${book.id}/download` }),
    thumbnailUrl: t.string({
      args: { width: t.arg.int({ required: true }) },
      resolve: (book, args) => `/api/books/${book.id}/cover?width=${args.width}`,
    }),
  }),
});
```

`nullable: true` is required: without it `prismaNode` uses `findUniqueOrThrow` and a denied lookup raises instead of resolving to null. **Check the real cover/thumbnail REST routes in `routes/ui.ts` and match their exact shapes** rather than trusting the strings above — they must be URLs the existing client and `use-authorized-src` already serve.

Create `app/server/graphql/schema/book/query/get.ts`:

```ts
import { builder } from '../../builder';
import { model as library } from '../../library';
import { model } from '../index';

builder.objectField(library, 'book', (t) =>
  t.prismaField({
    type: model,
    nullable: true,
    args: { id: t.arg.string({ required: true }) },
    resolve: (query, owner, args, context) =>
      context.prisma.book.findUnique({
        ...query,
        where: { userId_id: { userId: owner.userId, id: args.id } },
      }),
  })
);
```

`Library.book` takes a **raw** book id, not a global ID — it is already scoped by its parent `Library`, and the client addresses books by their content hash everywhere else.

Create `app/server/graphql/schema/book/index.ts`:

```ts
export { model } from './model';

import './query/get';
```

Register `import './book';` in `schema/index.ts`.

- [ ] **Step 5: Run the tests, regenerate the SDL, run the full suite**

```bash
npm test -w app/server -- graphql/schema/book
npm run graphql:schema -w app/server
npm test -w app/server
```

Expected: 4 book tests pass; `node-scope.test.ts` now walks `Book` too and must stay green — if it fails, `findUnique` is not wired.

- [ ] **Step 6: Commit**

```bash
git add app/server/graphql/schema/book app/server/graphql/schema/index.ts \
  app/server/graphql/schema.generated.graphql
git commit -m "feat(graphql): add the Book node with owner-scoped lookups"
```

---

### Task 7: `Series`

**Files:**
- Create: `app/server/graphql/schema/series/{index,model,node-loader}.ts`, `series/query/{get,get-all,next-index}.ts`
- Test: `app/server/graphql/schema/series/model.test.ts`
- Modify: `app/server/graphql/schema/book/model.ts` (add `series`)

**Interfaces:**
- Consumes: `builder`, `ownerScopedFindUnique`, `Book` model, `Library` model
- Produces: `model` (the `Series` node ref), consumed by `LibraryEntry` and `Book.series`

- [ ] **Step 1: Write the failing test**

Create `app/server/graphql/schema/series/model.test.ts`:

```ts
import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.series.create({
    data: {
      id: 'series-1',
      userId: harness.aliceOwner.userId,
      name: 'The Expanse',
      sortKey: 'expanse',
      bookCount: 2,
      author: 'James S. A. Corey',
      subjects: '["Sci-Fi"]',
    },
  });
  for (const [i, id] of ['b'.repeat(32), 'c'.repeat(32)].entries()) {
    await harness.prisma.book.create({
      data: {
        userId: harness.aliceOwner.userId,
        id,
        title: `Book ${i + 1}`,
        seriesId: 'series-1',
        seriesIndex: i + 1,
        size: 1,
        mtime: 1,
        addedAt: 1,
      },
    });
  }
});

afterEach(async () => {
  await harness.cleanup();
});

describe('Series', () => {
  it('exposes a series with its member books in index order', async () => {
    const result = await harness.execute(
      '{ viewer { library { seriesByName(name: "The Expanse") { name bookCount books { title seriesIndex } } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const series = (
      result.data as {
        viewer: { library: { seriesByName: { books: { title: string }[] } } };
      }
    ).viewer.library.seriesByName;
    expect(series.books.map((b) => b.title)).toEqual(['Book 1', 'Book 2']);
  });

  it('links a book back to its series', async () => {
    const result = await harness.execute(
      `{ viewer { library { book(id: "${'b'.repeat(32)}") { series { name } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { book: { series: { name: string } } } } }).viewer.library
        .book.series.name
    ).toBe('The Expanse');
  });

  it('returns the next free index for an existing series', async () => {
    const result = await harness.execute(
      '{ viewer { library { seriesNextIndex(name: "The Expanse") } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { seriesNextIndex: number } } }).viewer.library
        .seriesNextIndex
    ).toBe(3);
  });

  it('returns a first index for a series that does not exist yet', async () => {
    const result = await harness.execute(
      '{ viewer { library { seriesNextIndex(name: "Brand New") } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { seriesNextIndex: number } } }).viewer.library
        .seriesNextIndex
    ).toBe(1);
  });

  it('does not expose another user series', async () => {
    const result = await harness.execute(
      '{ viewer { library { seriesByName(name: "The Expanse") { name } } } }',
      { viewer: harness.bobViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { seriesByName: unknown } } }).viewer.library
        .seriesByName ?? null
    ).toBeNull();
  });
});
```

The fourth test is why `seriesNextIndex` lives on `Library` and not on `Series` — the client asks for it while assigning a book to a series that does not exist yet, so there is no `Series` to hang it on.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w app/server -- graphql/schema/series
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the node loader and model**

`Series` has a plain `@id` but is still tenant-owned via `userId`, so its guard compares the row's owner rather than parsing a compound id. Create `app/server/graphql/schema/series/node-loader.ts`:

```ts
import type { Prisma } from '@prisma/client';

import type { Context } from '../../context';
import { NO_MATCH_USER_ID } from '../node-scope';

/**
 * Series ids are opaque and unique globally, so the global ID carries no userId
 * to compare. The guard therefore constrains the lookup by the viewer's own
 * userId (or leaves it unconstrained for an admin), which yields null rather
 * than another user's row.
 */
export const findUnique = (id: string, context: Context): Prisma.SeriesWhereUniqueInput => {
  const viewer = context.viewer;
  if (viewer === null) return { id, userId: NO_MATCH_USER_ID } as Prisma.SeriesWhereUniqueInput;
  if (viewer.isAdmin) return { id };
  return { id, userId: viewer.userId ?? NO_MATCH_USER_ID } as Prisma.SeriesWhereUniqueInput;
};
```

**Import `NO_MATCH_USER_ID` — do not re-declare the literal.** The plan's own rule in Task 3 is one shared point of truth for this constant; a second copy that drifts is a breach, not a bug.

**Verify this typechecks against the generated Prisma types.** `SeriesWhereUniqueInput` may not accept `userId` alongside `id`; if it does not, use `findFirst`-style scoping via a custom `loadOne` on `builder.node` instead, and record which you used.

Create `app/server/graphql/schema/series/model.ts`:

```ts
import { parseStringArray } from '../../derive';
import { builder } from '../builder';
import * as book from '../book';
import { findUnique } from './node-loader';

export const model = builder.prismaNode('Series', {
  id: { field: 'id' },
  findUnique,
  nullable: true,
  fields: (t) => ({
    name: t.exposeString('name'),
    author: t.exposeString('author'),
    publisher: t.exposeString('publisher'),
    bookCount: t.exposeInt('bookCount'),
    totalPages: t.exposeInt('totalPages'),
    totalSize: t.exposeInt('totalSize'),
    subjects: t.field({ type: ['String'], resolve: (series) => parseStringArray(series.subjects) }),
    books: t.relation('books', {
      query: { orderBy: { seriesIndex: 'asc' } },
    }),
  }),
});

builder.objectField(book.model, 'series', (t) => t.relation('seriesRel', { nullable: true }));
```

`Book.series` is exposed as the **relation**, not the denormalized `series` string column — the column stays in the database for OPDS and the import pipeline.

Create `series/query/get.ts` (`Library.seriesByName`), `series/query/get-all.ts` (`Library.series`) and `series/query/next-index.ts` (`Library.seriesNextIndex`), each registering onto the `Library` ref:

```ts
// series/query/next-index.ts
import { builder } from '../../builder';
import { model as library } from '../../library';

builder.objectField(library, 'seriesNextIndex', (t) =>
  t.float({
    args: { name: t.arg.string({ required: true }) },
    resolve: (owner, args, context) => context.stores.book.getSeriesNextIndex(owner, args.name),
  })
);
```

`getSeriesNextIndex(owner, name): Promise<number>` already handles the not-yet-existing case — do not reimplement it.

- [ ] **Step 4: Run the tests, regenerate, full suite**

```bash
npm test -w app/server -- graphql/schema/series
npm run graphql:schema -w app/server
npm test -w app/server
```

Expected: 5 series tests pass; `node-scope.test.ts` now covers `Series`.

- [ ] **Step 5: Commit**

```bash
git add app/server/graphql/schema/series app/server/graphql/schema/book/model.ts \
  app/server/graphql/schema/index.ts app/server/graphql/schema.generated.graphql
git commit -m "feat(graphql): add the Series node and link books to it"
```

---

### Task 8: `Validation` and `ValidationMessage`

**Files:**
- Create: `app/server/graphql/schema/validation/{index,model}.ts`
- Test: `app/server/graphql/schema/validation/model.test.ts`
- Modify: `app/server/graphql/schema/book/model.ts` (add `validation`)

**Interfaces:**
- Consumes: `builder`, `Book` model
- Produces: `model` (a `prismaObject`, **not** a node)

- [ ] **Step 1: Write the failing test**

Create `app/server/graphql/schema/validation/model.test.ts`:

```ts
import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;
const BOOK_ID = 'd'.repeat(32);

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.book.create({
    data: {
      userId: harness.aliceOwner.userId,
      id: BOOK_ID,
      title: 'Broken',
      size: 1,
      mtime: 1,
      addedAt: 1,
    },
  });
  await harness.prisma.validation.create({
    data: {
      userId: harness.aliceOwner.userId,
      bookId: BOOK_ID,
      valid: false,
      threshold: 'ERROR',
      validatedAt: 1_700_000_000_000,
      messages: {
        create: [
          { userId: harness.aliceOwner.userId, seq: 0, code: 'RSC-005', severity: 'ERROR', message: 'bad', path: 'OEBPS/x.xhtml', line: 4, column: 2 },
        ],
      },
    },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

describe('Book.validation', () => {
  it('exposes the stored validation with its messages', async () => {
    const result = await harness.execute(
      `{ viewer { library { book(id: "${BOOK_ID}") { validation { valid threshold validatedAt messages { code severity message path line column } } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const validation = (
      result.data as {
        viewer: { library: { book: { validation: { valid: boolean; messages: unknown[] } } } };
      }
    ).viewer.library.book.validation;
    expect(validation.valid).toBe(false);
    expect(validation.messages).toEqual([
      { code: 'RSC-005', severity: 'ERROR', message: 'bad', path: 'OEBPS/x.xhtml', line: 4, column: 2 },
    ]);
  });

  it('is null for a book that has never been validated', async () => {
    await harness.prisma.book.create({
      data: { userId: harness.aliceOwner.userId, id: 'e'.repeat(32), title: 'Fresh', size: 1, mtime: 1, addedAt: 1 },
    });

    const result = await harness.execute(
      `{ viewer { library { book(id: "${'e'.repeat(32)}") { validation { valid } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { book: { validation: unknown } } } }).viewer.library.book
        .validation ?? null
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w app/server -- graphql/schema/validation
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the models**

Create `app/server/graphql/schema/validation/model.ts`:

```ts
import { epochToDate } from '../../derive';
import { builder } from '../builder';
import * as book from '../book';

const message = builder.prismaObject('ValidationMessage', {
  fields: (t) => ({
    seq: t.exposeInt('seq'),
    code: t.exposeString('code'),
    severity: t.exposeString('severity'),
    message: t.exposeString('message'),
    path: t.exposeString('path', { nullable: true }),
    line: t.exposeInt('line', { nullable: true }),
    column: t.exposeInt('column', { nullable: true }),
  }),
});

/**
 * Deliberately a prismaObject, not a prismaNode. A Validation is only ever
 * reached through its Book, so giving it a global ID would add a second,
 * separately-guarded door to tenant-owned data for no client benefit —
 * Houdini normalizes it under its parent.
 */
export const model = builder.prismaObject('Validation', {
  fields: (t) => ({
    valid: t.exposeBoolean('valid'),
    threshold: t.exposeString('threshold'),
    validatedAt: t.field({
      type: 'DateTime',
      resolve: (validation) => epochToDate(validation.validatedAt),
    }),
    messages: t.relation('messages', { query: { orderBy: { seq: 'asc' } } }),
  }),
});

builder.objectField(book.model, 'validation', (t) =>
  t.relation('validation', { nullable: true })
);
```

Note the Prisma field is `column` mapped to `column_num`; expose it as `column`.

- [ ] **Step 4: Run the tests, regenerate, full suite**

```bash
npm test -w app/server -- graphql/schema/validation
npm run graphql:schema -w app/server
npm test -w app/server
```

Expected: 2 validation tests pass. `node-scope.test.ts` must NOT pick these up — they are not nodes.

- [ ] **Step 5: Commit**

```bash
git add app/server/graphql/schema/validation app/server/graphql/schema/book/model.ts \
  app/server/graphql/schema/index.ts app/server/graphql/schema.generated.graphql
git commit -m "feat(graphql): expose stored validation on books"
```

---

### Task 9: `Progress`

`Progress` rows are keyed by KOReader `document` hash. A book's document is normally its own id, but `linkDocument` and id-history mean a book can carry progress under a previous id too. This task replaces a join the client currently does by hand.

**Files:**
- Create: `app/server/graphql/schema/progress/{index,model}.ts`, `progress/query/get-all.ts`
- Test: `app/server/graphql/schema/progress/model.test.ts`
- Modify: `app/server/graphql/schema/book/model.ts` (add `progress`)

**Interfaces:**
- Consumes: `builder`, `Book`/`Library` models, `context.stores.book.getBookLineage`
- Produces: `model` (a `prismaObject`)

- [ ] **Step 1: Write the failing test**

Create `app/server/graphql/schema/progress/model.test.ts`:

```ts
import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;
const BOOK_ID = 'f'.repeat(32);

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.book.create({
    data: { userId: harness.aliceOwner.userId, id: BOOK_ID, title: 'Read Me', size: 1, mtime: 1, addedAt: 1 },
  });
  await harness.prisma.progress.create({
    data: {
      userId: harness.aliceOwner.userId,
      document: BOOK_ID,
      progress: '/body/DocFragment[3]',
      percentage: 0.42,
      device: 'Kobo',
      deviceId: 'dev-1',
      timestamp: 1_700_000_000,
    },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

describe('Progress', () => {
  it('lists the library progress records', async () => {
    const result = await harness.execute(
      '{ viewer { library { progress { document percentage device } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { progress: unknown[] } } }).viewer.library.progress
    ).toEqual([{ document: BOOK_ID, percentage: 0.42, device: 'Kobo' }]);
  });

  it('resolves a book progress as a field, replacing the client-side join', async () => {
    const result = await harness.execute(
      `{ viewer { library { book(id: "${BOOK_ID}") { progress { percentage } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { book: { progress: { percentage: number } } } } }).viewer
        .library.book.progress.percentage
    ).toBe(0.42);
  });

  it('is null for a book with no progress', async () => {
    await harness.prisma.book.create({
      data: { userId: harness.aliceOwner.userId, id: '0'.repeat(32), title: 'Unread', size: 1, mtime: 1, addedAt: 1 },
    });

    const result = await harness.execute(
      `{ viewer { library { book(id: "${'0'.repeat(32)}") { progress { percentage } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { book: { progress: unknown } } } }).viewer.library.book
        .progress ?? null
    ).toBeNull();
  });

  it('does not leak another user progress', async () => {
    const result = await harness.execute('{ viewer { library { progress { document } } } }', {
      viewer: harness.bobViewer,
    });

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { progress: unknown[] } } }).viewer.library.progress
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w app/server -- graphql/schema/progress
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the model**

Create `app/server/graphql/schema/progress/model.ts`:

```ts
import { builder } from '../builder';
import * as book from '../book';

export const model = builder.prismaObject('Progress', {
  fields: (t) => ({
    document: t.exposeString('document'),
    progress: t.exposeString('progress'),
    percentage: t.exposeFloat('percentage'),
    device: t.exposeString('device'),
    deviceId: t.exposeString('deviceId'),
    timestamp: t.exposeInt('timestamp'),
  }),
});

builder.objectField(book.model, 'progress', (t) =>
  t.prismaField({
    type: model,
    nullable: true,
    resolve: (query, parent, _args, context) =>
      context.prisma.progress.findUnique({
        ...query,
        where: { userId_document: { userId: parent.userId, document: parent.id } },
      }),
  })
);
```

**Two things to verify while implementing.** First, whether the book→progress lookup should also consider ids from `BookIdHistory` — `getBookLineage(owner, id)` returns them, and a book edited after being read carries progress under its old id. Decide and record which semantics you implemented. Second, whether this N+1s across a page of books: fetch a connection of 20 books each selecting `progress` and count the queries. If it does, add a request-scoped loader beside `loadOwner` rather than leaving it.

Create `progress/query/get-all.ts` registering `Library.progress` via `context.stores.user.getUserProgress(owner.userId)`, or a direct Prisma query scoped to `owner.userId` — either is fine; prefer Prisma for selection-driven fields.

- [ ] **Step 4: Run the tests, regenerate, full suite**

```bash
npm test -w app/server -- graphql/schema/progress
npm run graphql:schema -w app/server
npm test -w app/server
```

Expected: 4 progress tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/server/graphql/schema/progress app/server/graphql/schema/book/model.ts \
  app/server/graphql/schema/index.ts app/server/graphql/schema.generated.graphql
git commit -m "feat(graphql): expose reading progress on books and libraries"
```

---

### Task 10: `PendingFix`

**Files:**
- Create: `app/server/graphql/schema/pending-fix/{index,model}.ts`, `pending-fix/query/get-all.ts`
- Test: `app/server/graphql/schema/pending-fix/model.test.ts`
- Modify: `app/server/graphql/schema/book/model.ts` (add `pendingFix`)

**Interfaces:**
- Consumes: `builder`, `Book`/`Library` models, `context.stores.book.getPendingFixes`
- Produces: `model` (a `prismaObject`)

- [ ] **Step 1: Write the failing test**

Create `app/server/graphql/schema/pending-fix/model.test.ts`:

```ts
import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;
const BOOK_ID = '1'.repeat(32);

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.book.create({
    data: { userId: harness.aliceOwner.userId, id: BOOK_ID, title: 'Needs Fixing', size: 1, mtime: 1, addedAt: 1 },
  });
  await harness.prisma.pendingFix.create({
    data: {
      userId: harness.aliceOwner.userId,
      bookId: BOOK_ID,
      fileName: 'needs-fixing.epub',
      fileSize: 2048,
      state: '{"proposals":[]}',
      updatedAt: 1_700_000_000_000,
    },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

describe('PendingFix', () => {
  it('exposes a pending fix on its book', async () => {
    const result = await harness.execute(
      `{ viewer { library { book(id: "${BOOK_ID}") { pendingFix { fileName fileSize } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { book: { pendingFix: unknown } } } }).viewer.library.book
        .pendingFix
    ).toEqual({ fileName: 'needs-fixing.epub', fileSize: 2048 });
  });

  it('lists the library pending fixes', async () => {
    const result = await harness.execute(
      '{ viewer { library { pendingFixes { fileName } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { pendingFixes: unknown[] } } }).viewer.library
        .pendingFixes
    ).toEqual([{ fileName: 'needs-fixing.epub' }]);
  });

  it('is empty for another user', async () => {
    const result = await harness.execute('{ viewer { library { pendingFixes { fileName } } } }', {
      viewer: harness.bobViewer,
    });

    expect(
      (result.data as { viewer: { library: { pendingFixes: unknown[] } } }).viewer.library
        .pendingFixes
    ).toEqual([]);
  });
});
```

- [ ] **Step 2–5: implement, verify, regenerate, commit**

Run `npm test -w app/server -- graphql/schema/pending-fix` and confirm it fails on the missing module. Then create `pending-fix/model.ts` as a `prismaObject` exposing `fileName`, `fileSize`, `state`, `createdAt`/`updatedAt` (both epoch-millisecond Floats through `epochToDate`), plus `builder.objectField(book.model, 'pendingFix', (t) => t.relation('pendingFix', { nullable: true }))`. Register `Library.pendingFixes` onto the `Library` ref, delegating to `context.stores.book.getPendingFixes(owner)` — that method already shapes the DTO the client expects. Then:

```bash
npm test -w app/server -- graphql/schema/pending-fix
npm run graphql:schema -w app/server
npm test -w app/server
git add app/server/graphql/schema/pending-fix app/server/graphql/schema/book/model.ts \
  app/server/graphql/schema/index.ts app/server/graphql/schema.generated.graphql
git commit -m "feat(graphql): expose pending metadata fixes"
```

`state` is a JSON string column. Decide whether to expose it raw or parse it into a typed shape, and record the choice — the client's fix-review UI reads it, so match what `getPendingFixes` already returns.

---

### Task 11: `LibraryEntry` union and the `entries` connection

The one read that does **not** use the Prisma plugin. `bookStore.listBooksPage` already interleaves series and standalone rows behind a composite base64 cursor, and it is covered by the existing store tests — this task wraps it, it does not reimplement it.

**Files:**
- Create: `app/server/graphql/schema/library-entry.ts`, `app/server/graphql/schema/book/query/get-all.ts`
- Test: `app/server/graphql/schema/book/query/get-all.test.ts`

**Interfaces:**
- Consumes: `Book` and `Series` models, `context.stores.book.listBooksPage`
- Produces: `libraryEntry` union ref and `Library.entries`

**Store contract (already exists — do not change):**

```ts
listBooksPage(owner: Owner, cursor: PageCursor | null, take: number, filters?: BookListFilters):
  Promise<{
    items: Array<{ type: 'series'; seriesName: string } | { type: 'standalone'; bookId: string }>;
    books: BookSummary[];
    nextCursor: string | null;   // already base64-encoded
  }>
```

- [ ] **Step 1: Write the failing test**

Create `app/server/graphql/schema/book/query/get-all.test.ts`:

```ts
import { createHarness, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.series.create({
    data: { id: 's-1', userId: harness.aliceOwner.userId, name: 'Expanse', sortKey: 'expanse', bookCount: 1 },
  });
  await harness.prisma.book.create({
    data: { userId: harness.aliceOwner.userId, id: '2'.repeat(32), title: 'In Series', seriesId: 's-1', seriesIndex: 1, size: 1, mtime: 1, addedAt: 1 },
  });
  await harness.prisma.book.create({
    data: { userId: harness.aliceOwner.userId, id: '3'.repeat(32), title: 'Standalone', size: 1, mtime: 1, addedAt: 1 },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

const ENTRIES = `{
  viewer { library { entries(first: 10) {
    edges { node { __typename ... on Book { title } ... on Series { name } } }
    pageInfo { hasNextPage endCursor }
  } } }
}`;

describe('Library.entries', () => {
  it('interleaves series and standalone books as a union', async () => {
    const result = await harness.execute(ENTRIES, { viewer: harness.aliceViewer });

    expect(result.errors).toBeUndefined();
    const edges = (
      result.data as {
        viewer: { library: { entries: { edges: { node: { __typename: string } }[] } } };
      }
    ).viewer.library.entries.edges;
    expect(edges.map((e) => e.node.__typename).sort()).toEqual(['Book', 'Series']);
  });

  it('reports no next page when the whole library fits on one page', async () => {
    const result = await harness.execute(ENTRIES, { viewer: harness.aliceViewer });

    expect(
      (result.data as { viewer: { library: { entries: { pageInfo: { hasNextPage: boolean } } } } })
        .viewer.library.entries.pageInfo.hasNextPage
    ).toBe(false);
  });

  it('paginates with the store cursor', async () => {
    type EntriesResult = {
      viewer: {
        library: { entries: { pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
      };
    };

    const first = await harness.execute(
      '{ viewer { library { entries(first: 1) { edges { node { __typename } } pageInfo { hasNextPage endCursor } } } } }',
      { viewer: harness.aliceViewer }
    );
    const pageInfo = (first.data as EntriesResult).viewer.library.entries.pageInfo;

    expect(pageInfo.hasNextPage).toBe(true);
    expect(pageInfo.endCursor).not.toBeNull();

    const second = await harness.execute(
      'query ($after: String) { viewer { library { entries(first: 1, after: $after) { edges { node { __typename } } } } } }',
      { viewer: harness.aliceViewer, variables: { after: pageInfo.endCursor } }
    );

    expect(second.errors).toBeUndefined();
    expect(
      (second.data as { viewer: { library: { entries: { edges: unknown[] } } } }).viewer.library
        .entries.edges
    ).toHaveLength(1);
  });

  it('shows an empty feed for a user with no books', async () => {
    const result = await harness.execute(ENTRIES, { viewer: harness.bobViewer });

    expect(
      (result.data as { viewer: { library: { entries: { edges: unknown[] } } } }).viewer.library
        .entries.edges
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w app/server -- graphql/schema/book/query/get-all
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the union and the connection**

Create `app/server/graphql/schema/library-entry.ts`:

```ts
import { builder } from './builder';
import * as book from './book';
import * as series from './series';

type Entry =
  | { kind: 'book'; id: string; userId: string }
  | { kind: 'series'; id: string; userId: string };

export const libraryEntry = builder.unionType('LibraryEntry', {
  types: [book.model, series.model],
  resolveType: (value) => ((value as { kind: string }).kind === 'series' ? 'Series' : 'Book'),
});
```

**The `resolveType` discriminator must match what your connection resolver actually returns.** If you resolve entries into real Prisma rows, discriminate on a property those rows genuinely have (`seriesId`/`sortKey`) rather than inventing a `kind` tag; adjust both sides together and keep them in one file so they cannot drift.

Create `app/server/graphql/schema/book/query/get-all.ts` registering `Library.entries` as a `t.connection` whose resolver:

1. decodes `args.after` (base64 JSON) into a `PageCursor`, or `null`,
2. calls `context.stores.book.listBooksPage(owner, cursor, first, filters)`,
3. maps `items` to entities — `standalone` entries to `Book` rows, `series` entries to `Series` rows fetched by name within the owner,
4. returns `edges` plus `pageInfo` with `endCursor: nextCursor` and `hasNextPage: nextCursor !== null`.

Add a `LibraryFilter` input mirroring `BookListFilters` exactly: `query`, `author`, `seriesName`, `status` (`not-started | in-progress | completed`), `subjects: [String!]`, `entryType` (`series | standalone`).

- [ ] **Step 4: Run the tests, regenerate, full suite**

```bash
npm test -w app/server -- graphql/schema/book
npm run graphql:schema -w app/server
npm test -w app/server
```

Expected: all book tests pass, including the four new connection tests.

- [ ] **Step 5: Commit**

```bash
git add app/server/graphql/schema/library-entry.ts app/server/graphql/schema/book \
  app/server/graphql/schema/index.ts app/server/graphql/schema.generated.graphql
git commit -m "feat(graphql): add the interleaved library entries connection"
```

---

### Task 12: `Library.searchSuggestions`

**Files:**
- Create: `app/server/graphql/schema/book/query/search-suggestions.ts`
- Test: `app/server/graphql/schema/book/query/search-suggestions.test.ts`

**Store contract (already exists):** `getSearchSuggestions(owner, { q, filter: { author?, seriesName?, activeSubjects? } }): Promise<SearchSuggestionsResponse>` where the response is `{ groups: Array<{ type: 'author'|'series'|'book'|'subject'; items: Array<{ label, value, matchStart, matchLength }> }> }`.

- [ ] **Step 1: Write the failing test**

```ts
import { createHarness, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.book.create({
    data: { userId: harness.aliceOwner.userId, id: '4'.repeat(32), title: 'Dune', author: 'Frank Herbert', size: 1, mtime: 1, addedAt: 1 },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

describe('Library.searchSuggestions', () => {
  it('returns grouped suggestions with match offsets', async () => {
    const result = await harness.execute(
      '{ viewer { library { searchSuggestions(query: "Dun") { type items { label value matchStart matchLength } } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const groups = (
      result.data as { viewer: { library: { searchSuggestions: { type: string }[] } } }
    ).viewer.library.searchSuggestions;
    expect(groups.some((g) => g.type === 'book')).toBe(true);
  });

  it('returns no groups for a blank query', async () => {
    const result = await harness.execute(
      '{ viewer { library { searchSuggestions(query: "  ") { type } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(
      (result.data as { viewer: { library: { searchSuggestions: unknown[] } } }).viewer.library
        .searchSuggestions
    ).toEqual([]);
  });

  it('does not suggest from another user library', async () => {
    const result = await harness.execute(
      '{ viewer { library { searchSuggestions(query: "Dun") { items { label } } } } }',
      { viewer: harness.bobViewer }
    );

    expect(
      (result.data as { viewer: { library: { searchSuggestions: unknown[] } } }).viewer.library
        .searchSuggestions
    ).toEqual([]);
  });
});
```

- [ ] **Steps 2–5:** confirm RED, then register `Library.searchSuggestions` onto the `Library` ref with a `SuggestionGroup` object type (`type: String!`, `items: [Suggestion!]!`) and a `Suggestion` type (`label`, `value`, `matchStart`, `matchLength`). The blank-query case is already handled inside the store — mirror it rather than duplicating the check. Then regenerate, run the full suite, and commit with `feat(graphql): add library search suggestions`.

---

### Task 13: `Book.lineage`

**Files:**
- Create: `app/server/graphql/schema/book/query/lineage.ts`
- Test: `app/server/graphql/schema/book/query/lineage.test.ts`

**Store contract (already exists):** `getBookLineage(owner, id): Promise<{ currentId: string; entries: { oldId: string; newId: string; timestamp: number; type: string }[] } | null>`.

- [ ] **Step 1: Write the failing test**

```ts
import { createHarness, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

let harness: Harness;
const BOOK_ID = '5'.repeat(32);

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.book.create({
    data: { userId: harness.aliceOwner.userId, id: BOOK_ID, title: 'Edited', size: 1, mtime: 1, addedAt: 1 },
  });
  await harness.prisma.bookIdHistory.create({
    data: { userId: harness.aliceOwner.userId, oldId: '6'.repeat(32), currentId: BOOK_ID, timestamp: 1_700_000_000_000, type: 'edit' },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

describe('Book.lineage', () => {
  it('lists the ids this book has previously had', async () => {
    const result = await harness.execute(
      `{ viewer { library { book(id: "${BOOK_ID}") { lineage { oldId newId type timestamp } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const lineage = (
      result.data as { viewer: { library: { book: { lineage: { oldId: string }[] } } } }
    ).viewer.library.book.lineage;
    expect(lineage).toHaveLength(1);
    expect(lineage[0].oldId).toBe('6'.repeat(32));
  });

  it('is empty for a book that has never been re-imported', async () => {
    await harness.prisma.book.create({
      data: { userId: harness.aliceOwner.userId, id: '7'.repeat(32), title: 'Untouched', size: 1, mtime: 1, addedAt: 1 },
    });

    const result = await harness.execute(
      `{ viewer { library { book(id: "${'7'.repeat(32)}") { lineage { oldId } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(
      (result.data as { viewer: { library: { book: { lineage: unknown[] } } } }).viewer.library.book
        .lineage
    ).toEqual([]);
  });
});
```

- [ ] **Steps 2–5:** confirm RED, then add a `LinkedDocument` object type (`oldId`, `newId`, `type`, `timestamp: DateTime!`) and register `Book.lineage` returning `entries` from `getBookLineage`, or `[]` when the store returns null. `Book.lineage` needs the owner; take it from the parent row's `userId` rather than threading a `Library` down. Regenerate, run the full suite, commit with `feat(graphql): expose book id lineage`.

---

### Task 14: `Device`

Devices are global rather than per-library — a device is a physical e-reader, and users are enabled on it. This is the last read type and the only one that does not hang off `Library`.

**Files:**
- Create: `app/server/graphql/schema/device/{index,model}.ts`, `device/query/get-all.ts`
- Test: `app/server/graphql/schema/device/model.test.ts`
- Modify: `app/server/graphql/schema/viewer/model.ts` (add `devices`)

- [ ] **Step 1: Write the failing test**

```ts
import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.device.create({
    data: { id: 'dev-1', name: 'Kobo Clara', slug: 'kobo-clara', coverWidth: 1072, coverHeight: 1448, coverFit: 'contain', bwCover: true, simplify: false },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

describe('Viewer.devices', () => {
  it('lists devices for an admin', async () => {
    const result = await harness.execute(
      '{ viewer { devices { id name slug coverWidth coverHeight coverFit bwCover simplify } } }',
      { viewer: harness.adminViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { devices: { name: string }[] } }).viewer.devices[0].name
    ).toBe('Kobo Clara');
  });

  it('refuses a non-admin', async () => {
    const result = await harness.execute('{ viewer { devices { name } } }', {
      viewer: harness.aliceViewer,
    });

    expect(result.errors?.[0].extensions?.code).toBe('FORBIDDEN');
  });
});
```

**Confirm the admin scope against the REST behaviour before writing it.** `routes/devices.ts` uses `adminAuth` for management but `GET /:id/users` and the list may be reachable by regular users; match whatever REST does today rather than tightening or loosening it here.

- [ ] **Steps 2–5:** confirm RED, then add a `Device` prismaNode (plain `@id`, globally unique, not tenant-owned — so no owner-scoped `findUnique` is needed, but say so in a comment so the Task 3 rule is not assumed to have been forgotten) exposing `name`, `slug`, `coverWidth`, `coverHeight`, `coverFit`, `bwCover`, `simplify`, `createdAt`/`updatedAt` via `epochToDate`. Register `Viewer.devices` with the scope REST uses. Regenerate, run the full suite and repo-root lint, commit with `feat(graphql): add the Device node`.

---

## Definition of done

**Met.** The fourteen tasks left six spec'd fields unbuilt — no task owned them, so no
per-task review could see the gap — plus four REST reads with no GraphQL equivalent. All ten
landed in the final fix wave (`71bedc3e..`); see
`.superpowers/sdd/2026-07-31-graphql-read-model/final-fix-report.md`.

- **The full read surface from the spec's schema section answers over GraphQL.** Every REST
  read has a GraphQL equivalent, with one deliberate permanent exception
  (`GET /api/public-config`, fetched pre-auth by the login page) and one deferral
  (`Library.scanStatus`, which belongs with the scan-progress step). Verified field by field
  against the routers, not against this plan's briefs — which were wrong thirteen times.
- Every type implementing `Node` that is tenant-owned uses `ownerScopedFindUnique`, proven by
  the generic test in Task 3 — which now walks `Query.nodes` as well as `Query.node`.
- `library.entries` paginates with the same cursor semantics as `GET /api/books`, and
  `library.progress` with the same as `GET /api/my/progress`. Both are exercised through a
  per-edge cursor as well as `pageInfo.endCursor`.
- Both input types are covered field by field, so a swapped `author`/`seriesName` pair fails
  rather than returning plausible wrong results.
- Every existing REST test still passes; `app/client/` is untouched.
- `schema.generated.graphql` is regenerated and committed; `npm run lint` passes from the
  repo root.

Two schema-shape corrections shipped in the same wave, both breaking changes that are free
now and expensive once phase 2's Houdini fragments exist: `Book.bookId` exposes the raw
content hash the client routes on, and `Progress.timestamp` is a `DateTime` rather than a
bare `Int` of seconds.

## Handoff to the mutations plan

- Input validation runs **inside resolvers**, returning `InvalidInputError` as a union member — see the spec's resolved open question #2. Do not use the validation plugin's declarative arg option; it requires `unsafelyHandleInputErrors`, which bypasses auth.
- `userChangePassword` must carry `skipTypeScopes` (spec open question #6), or the type-level `authenticated` scope will block the very user it exists for.
- `root-auth.test.ts` executes root fields with no arguments; the first root field with a required argument will fail it on argument coercion rather than authorization (spec open question #5). Fix the test when adding the first such mutation.
