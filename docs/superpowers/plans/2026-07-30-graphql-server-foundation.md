# GraphQL Server Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an authenticated GraphQL endpoint at `POST /graphql` answering `{ viewer { username isAdmin } }`, with the Pothos builder, scope-auth, context and SDL artifact in place — while every REST route and its tests keep working untouched.

**Architecture:** graphql-yoga mounts as an Express handler ahead of the JSON body parser. A Pothos v4 builder configured with the scope-auth, Prisma, Relay, errors and validation plugins builds a schema whose every field requires an authenticated viewer. The viewer is derived from the existing `Authorization: Bearer` JWT by a pure function; stores and Prisma reach resolvers through the GraphQL context rather than through constructors.

**Tech Stack:** TypeScript, graphql 16, graphql-yoga 5, Pothos 4 (`core`, `plugin-scope-auth`, `plugin-prisma`, `plugin-relay`, `plugin-errors`, `plugin-validation`), Prisma 7 + better-sqlite3, Vitest, oxlint/oxfmt.

**Source spec:** `docs/superpowers/specs/2026-07-30-graphql-server-design.md`

**Scope:** This plan covers delivery steps 1–2 of the spec (spike + foundation). Steps 3–5 (read model, 23 mutations, scan subscription) get their own plan, written once Task 1's spike outcome is known — because a negative result there changes how every model in step 3 is declared.

## Global Constraints

- `graphql` is pinned to `^16`. graphql-yoga 5's peer range is `^15.2.0 || ^16.0.0`; it does not accept 17.
- **No classes in new code** under `app/server/graphql/`. Modules of exported functions; dependencies arrive as arguments.
- **No in-place mutation.** Derive new values rather than modifying existing ones.
- **No `any`.** `typescript/no-explicit-any` is an *error* in `app/server/.oxlintrc.json`. Use `unknown` plus narrowing, or a concrete `as` cast.
- **Unused identifiers must be prefixed `_`** — `no-unused-vars` is configured with `argsIgnorePattern: "^_"`.
- **Existing store classes are consumed as-is.** `BookStore`, `UserStore`, `DeviceStore`, `EditionStore`, `ValidationStore`, `ScanJobStore` and `ThumbnailQueue` stay classes and are not refactored.
- **REST stays untouched and green.** No edits to `routes/ui.ts`, `routes/users.ts`, `routes/devices.ts`, `routes/opds.ts`, `routes/kosync.ts` or their tests. `server.ts` and `index.ts` are modified only to mount the new handler.
- **No client changes.** Nothing under `app/client/` is touched.
- **One exemption from the functional rule:** Pothos's builder is side-effectful by design. `builder.*` calls at module scope and the side-effect imports in `schema/**/index.ts` are the framework's registration model and are exempt.
- Tests: `npm test -w app/server` (from the repo root).
- Lint: `npm run lint` **from the repo root only** — the repo has two workspaces and running lint inside one silently skips the other.
- Commit messages follow the existing convention: `feat(scope): lowercase summary`, `chore: ...`, `fix(scope): ...`.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `app/server/graphql/context.ts` | `Viewer`/`Stores`/`Context` types, `viewerFromHeader`, `requireViewer`, `createContext` |
| `app/server/graphql/context.test.ts` | Pure tests for `viewerFromHeader` and `createContext` |
| `app/server/graphql/prisma-node.spike.test.ts` | Proves `prismaNode` round-trips `Book`'s compound primary key |
| `app/server/graphql/schema/builder.ts` | The Pothos `SchemaBuilder`: plugins, scalars, auth scopes, defaults |
| `app/server/graphql/schema/index.ts` | Side-effect imports every entity, exports the built `schema` |
| `app/server/graphql/schema/viewer/index.ts` | Re-exports `model`, side-effect imports its fields |
| `app/server/graphql/schema/viewer/model.ts` | The `Viewer` object type |
| `app/server/graphql/schema/viewer/query/current.ts` | `Query.viewer` |
| `app/server/graphql/schema/viewer/query/current.test.ts` | Schema-level tests for `Query.viewer` |
| `app/server/graphql/test-util.ts` | Test harness: temp SQLite + migrations + real stores + `execute()` |
| `app/server/graphql/yoga.ts` | `createGraphqlHandler` — yoga wiring and Express handler |
| `app/server/graphql/yoga.test.ts` | HTTP-level tests: bearer parsing, 401s, masking |
| `app/server/graphql/print-schema.ts` | Writes / checks `schema.generated.graphql` |
| `app/server/graphql/schema.generated.graphql` | Committed SDL artifact |

**Modified:**

| Path | Change |
|---|---|
| `app/server/prisma/schema.prisma` | Add the `generator pothos` block |
| `app/server/package.json` | Add dependencies and the `graphql:schema` / `graphql:schema:check` scripts; extend `lint` |
| `app/server/server.ts:25-82` | Accept a `graphqlHandler` parameter and mount it |
| `app/server/index.ts:47-57` | Build the handler and pass it to `createServer` |
| `.gitignore` | Ignore the generated Pothos types |

**Deviation from the spec, deliberate:** the spec's layout sketch has `schema/index.ts` call `print()` at module scope. This plan puts printing in a standalone script instead — writing a file as a side effect of importing the schema would fire on every test run and on production startup. Same artifact, no import-time I/O.

**Refinement of the spec's layout:** `Viewer` lives in `schema/viewer/`, not `schema/user/`. The spec's own reasoning is why — the config-based admin has no `User` row, so `Viewer` is not a `User` and does not belong in that entity's directory.

---

### Task 1: Dependencies, Prisma generator, and the compound-id spike

The spike question: can `builder.prismaNode` encode *and* decode a global ID for `Book`, whose primary key is the composite `@@id([userId, id])`? If it can't, every model declaration in the next plan changes shape, so this is resolved before anything else is written.

**Files:**
- Modify: `app/server/prisma/schema.prisma` (add generator block after the existing `generator client`, lines 1-3)
- Modify: `app/server/package.json` (dependencies)
- Modify: `.gitignore`
- Test: `app/server/graphql/prisma-node.spike.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: the `PrismaTypes` type at `app/server/graphql/generated/pothos-types.ts`, imported as `import type PrismaTypes from '../generated/pothos-types'` by Task 3's builder. Also produces the **spike verdict**, recorded as a comment in the test file, which Task 3 and the next plan depend on.

- [ ] **Step 1: Install the dependencies**

Run from the repo root (this is an npm workspace):

```bash
npm install -w app/server \
  graphql@^16 \
  graphql-yoga@^5 \
  graphql-scalars@^1 \
  zod@^4 \
  @pothos/core@^4 \
  @pothos/plugin-scope-auth@^4 \
  @pothos/plugin-prisma@^4 \
  @pothos/plugin-relay@^4 \
  @pothos/plugin-errors@^4 \
  @pothos/plugin-validation@^4
```

- [ ] **Step 2: Add the Pothos generator to the Prisma schema**

In `app/server/prisma/schema.prisma`, directly after the existing `generator client` block:

```prisma
generator pothos {
  provider = "prisma-pothos-types"
  output   = "../graphql/generated/pothos-types.ts"
}
```

An explicit `output` is used rather than the default: the default writes inside `node_modules/@pothos/plugin-prisma/`, which is wiped by `npm ci` and invisible in review.

- [ ] **Step 3: Ignore the generated types**

Append to `.gitignore`:

```
/app/server/graphql/generated/
```

They are regenerated by `npm run prisma:generate`, which already runs on `postinstall`.

- [ ] **Step 4: Generate and verify the types exist**

```bash
npm run prisma:generate -w app/server
ls app/server/graphql/generated/pothos-types.ts
```

Expected: the file exists.

**If `prisma generate` fails to resolve the `prisma-pothos-types` provider**, this is the Prisma 7 incompatibility the spike exists to find. Record it (Step 7) and stop — the fallback in Step 7 does not need the generator, but the whole "Prisma plugin for reads" decision needs revisiting with the user before the next plan is written.

- [ ] **Step 5: Write the spike test**

Create `app/server/graphql/prisma-node.spike.test.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import SchemaBuilder from '@pothos/core';
import PrismaPlugin from '@pothos/plugin-prisma';
import RelayPlugin from '@pothos/plugin-relay';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { graphql } from 'graphql';

import { runMigrations } from '../db/migrate';
import { UserStore } from '../services/user-store';
import type PrismaTypes from './generated/pothos-types';

vi.mock('../logger');

type SpikeContext = { prisma: PrismaClient };

let prisma: PrismaClient;
let booksDir: string;
let dbPath: string;
let aliceId: string;

beforeEach(async () => {
  booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookplate-spike-'));
  dbPath = path.join(
    os.tmpdir(),
    `spike-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksDir);

  const userStore = new UserStore(prisma);
  await userStore.createUser('alice', await UserStore.hashLoginPassword('alicepass'));
  aliceId = (await userStore.getUserIdByUsername('alice'))!;

  await prisma.book.create({
    data: {
      userId: aliceId,
      id: 'a'.repeat(32),
      title: 'Dune',
      size: 1234,
      mtime: Date.now(),
      addedAt: Date.now(),
    },
  });
});

afterEach(async () => {
  await prisma.$disconnect();
  try {
    fs.unlinkSync(dbPath);
  } catch {
    /* best-effort cleanup */
  }
  fs.rmSync(booksDir, { recursive: true });
});

const buildSpikeSchema = () => {
  const builder = new SchemaBuilder<{
    Context: SpikeContext;
    PrismaTypes: PrismaTypes;
  }>({
    plugins: [PrismaPlugin, RelayPlugin],
    prisma: { client: (context: SpikeContext) => context.prisma },
    relay: {},
  });

  const Book = builder.prismaNode('Book', {
    id: { field: 'userId_id' },
    fields: (t) => ({
      title: t.exposeString('title'),
    }),
  });

  builder.queryType({
    fields: (t) => ({
      firstBook: t.prismaField({
        type: Book,
        nullable: true,
        resolve: (query, _parent, _args, context) => context.prisma.book.findFirst({ ...query }),
      }),
    }),
  });

  return builder.toSchema();
};

it('encodes a global ID for a model with a composite primary key', async () => {
  const result = await graphql({
    schema: buildSpikeSchema(),
    source: '{ firstBook { id title } }',
    contextValue: { prisma },
  });

  expect(result.errors).toBeUndefined();
  const firstBook = (result.data as { firstBook: { id: string; title: string } }).firstBook;
  expect(firstBook.title).toBe('Dune');
  expect(firstBook.id.length).toBeGreaterThan(0);
});

it('decodes that global ID back to the same row through Query.node', async () => {
  const schema = buildSpikeSchema();

  const first = await graphql({
    schema,
    source: '{ firstBook { id } }',
    contextValue: { prisma },
  });
  const globalId = (first.data as { firstBook: { id: string } }).firstBook.id;

  const result = await graphql({
    schema,
    source: 'query ($id: ID!) { node(id: $id) { ... on Book { title } } }',
    contextValue: { prisma },
    variableValues: { id: globalId },
  });

  expect(result.errors).toBeUndefined();
  expect(result.data).toEqual({ node: { title: 'Dune' } });
});
```

The second test is the one that matters. Encoding a composite id is easy; decoding it back into a two-column `findUnique` is where the plugin either supports compound keys or doesn't.

- [ ] **Step 6: Run the spike**

```bash
npm test -w app/server -- prisma-node.spike
```

Expected on success: both tests PASS.

- [ ] **Step 7: Record the verdict**

Add a comment at the top of `app/server/graphql/prisma-node.spike.test.ts` stating the outcome and the installed versions, so the decision is discoverable in the repo rather than only in this plan:

```ts
// Spike: does @pothos/plugin-prisma's prismaNode support Book's composite
// @@id([userId, id]) under Prisma 7?
// VERDICT: <PASS|FAIL> — @pothos/plugin-prisma@<version>, prisma@<version>.
// Kept as a regression test: if a Prisma or Pothos upgrade breaks compound-key
// global IDs, this fails before the whole schema does.
```

**If either test FAILED**, the fallback is `builder.prismaObject` plus an explicit `builder.node`, which does the encode/decode by hand:

```ts
const Book = builder.prismaObject('Book', {
  fields: (t) => ({
    title: t.exposeString('title'),
  }),
});

builder.node(Book, {
  id: { resolve: (book) => `${book.userId}:${book.id}` },
  loadOne: (id, context) => {
    const separator = id.indexOf(':');
    const userId = id.slice(0, separator);
    const bookId = id.slice(separator + 1);
    return context.prisma.book.findUnique({ where: { userId_id: { userId, id: bookId } } });
  },
});
```

Rewrite the spike test to use this form, confirm it passes, and record `VERDICT: FAIL — using explicit builder.node fallback` in the comment. Report the outcome before starting the next plan: it changes every model declaration in delivery step 3.

- [ ] **Step 8: Run the full suite to confirm nothing regressed**

```bash
npm test -w app/server
```

Expected: PASS. Adding a generator block and dependencies must not affect any existing test.

- [ ] **Step 9: Commit**

```bash
git add app/server/package.json app/server/prisma/schema.prisma \
  app/server/graphql/prisma-node.spike.test.ts .gitignore package-lock.json
git commit -m "chore(graphql): add pothos + yoga deps and prove compound-key global IDs"
```

---

### Task 2: The GraphQL context

**Files:**
- Create: `app/server/graphql/context.ts`
- Test: `app/server/graphql/context.test.ts`

**Interfaces:**
- Consumes: `verifyAccessToken` from `app/server/services/jwt.ts`; `AppConfig` from `app/server/types.ts`; the seven store classes as type-only imports
- Produces:
  - `type Viewer = { userId: string | null; username: string; isAdmin: boolean; mustChangePassword: boolean }`
  - `type Stores = { book: BookStore; user: UserStore; device: DeviceStore; edition: EditionStore; validation: ValidationStore; scanJob: ScanJobStore; thumbnail: ThumbnailQueue }`
  - `type Context = { viewer: Viewer | null; prisma: PrismaClient; stores: Stores; config: AppConfig }`
  - `type ContextDeps = { prisma: PrismaClient; stores: Stores; config: AppConfig; jwtSecret: Buffer }`
  - `viewerFromHeader(secret: Buffer, header: string | undefined): Viewer | null`
  - `requireViewer(context: Context): Viewer`
  - `createContext(deps: ContextDeps): (params: { request: Request }) => Context`

- [ ] **Step 1: Write the failing test**

Create `app/server/graphql/context.test.ts`:

```ts
import { signAccessToken } from '../services/jwt';
import { viewerFromHeader } from './context';

const secret = Buffer.from('a'.repeat(64), 'hex');

describe('viewerFromHeader', () => {
  it('returns null when there is no header', () => {
    expect(viewerFromHeader(secret, undefined)).toBeNull();
  });

  it('returns null when the header is not a Bearer token', () => {
    expect(viewerFromHeader(secret, 'Basic YWxpY2U6cGFzcw==')).toBeNull();
  });

  it('returns null when the token does not verify', () => {
    expect(viewerFromHeader(secret, 'Bearer not-a-real-token')).toBeNull();
  });

  it('returns null when the token was signed with a different secret', () => {
    const otherSecret = Buffer.from('b'.repeat(64), 'hex');
    const token = signAccessToken(otherSecret, {
      userId: 'user-1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });
    expect(viewerFromHeader(secret, `Bearer ${token}`)).toBeNull();
  });

  it('maps a user token to a viewer carrying its userId', () => {
    const token = signAccessToken(secret, {
      userId: 'user-1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });
    expect(viewerFromHeader(secret, `Bearer ${token}`)).toEqual({
      userId: 'user-1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });
  });

  it('maps the config admin token, which has no subject claim, to a null userId', () => {
    const token = signAccessToken(secret, {
      username: 'admin',
      isAdmin: true,
      mustChangePassword: false,
    });
    expect(viewerFromHeader(secret, `Bearer ${token}`)).toEqual({
      userId: null,
      username: 'admin',
      isAdmin: true,
      mustChangePassword: false,
    });
  });

  it('preserves the mustChangePassword claim', () => {
    const token = signAccessToken(secret, {
      userId: 'user-1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: true,
    });
    expect(viewerFromHeader(secret, `Bearer ${token}`)?.mustChangePassword).toBe(true);
  });
});
```

The config-admin case is the important one: `signAccessToken` omits the `subject` claim when `userId` is undefined, and every downstream owner check depends on that becoming `userId: null` rather than `undefined`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w app/server -- graphql/context
```

Expected: FAIL — `Cannot find module './context'`.

- [ ] **Step 3: Write the implementation**

Create `app/server/graphql/context.ts`:

```ts
import type { PrismaClient } from '@prisma/client';

import type { BookStore } from '../services/book-store';
import type { DeviceStore } from '../services/device-store';
import type { EditionStore } from '../services/edition-store';
import { verifyAccessToken } from '../services/jwt';
import type { ScanJobStore } from '../services/scan-job-store';
import type { ThumbnailQueue } from '../services/thumbnail-queue';
import type { UserStore } from '../services/user-store';
import type { ValidationStore } from '../services/validation-store';
import type { AppConfig } from '../types';

/**
 * The authenticated identity behind a request. `userId` is null for the
 * config-based admin, which has no row in the users table.
 */
export type Viewer = {
  userId: string | null;
  username: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
};

export type Stores = {
  book: BookStore;
  user: UserStore;
  device: DeviceStore;
  edition: EditionStore;
  validation: ValidationStore;
  scanJob: ScanJobStore;
  thumbnail: ThumbnailQueue;
};

export type Context = {
  viewer: Viewer | null;
  prisma: PrismaClient;
  stores: Stores;
  config: AppConfig;
};

export type ContextDeps = {
  prisma: PrismaClient;
  stores: Stores;
  config: AppConfig;
  jwtSecret: Buffer;
};

/** Derives the viewer from an Authorization header. Pure. */
export const viewerFromHeader = (secret: Buffer, header: string | undefined): Viewer | null => {
  if (header === undefined || !header.startsWith('Bearer ')) return null;
  const user = verifyAccessToken(secret, header.slice(7));
  if (user === null) return null;
  return {
    userId: user.userId ?? null,
    username: user.username,
    isAdmin: user.isAdmin,
    mustChangePassword: user.mustChangePassword,
  };
};

/**
 * Asserts the `authenticated` scope already ran. This is an invariant check,
 * not error handling: every field in the schema carries that scope, so a null
 * viewer here means the builder was misconfigured, not that a request failed.
 */
export const requireViewer = (context: Context): Viewer => {
  if (context.viewer === null) {
    throw new Error('requireViewer called without an authenticated viewer');
  }
  return context.viewer;
};

export const createContext =
  (deps: ContextDeps) =>
  ({ request }: { request: Request }): Context => ({
    viewer: viewerFromHeader(deps.jwtSecret, request.headers.get('authorization') ?? undefined),
    prisma: deps.prisma,
    stores: deps.stores,
    config: deps.config,
  });
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -w app/server -- graphql/context
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Add a test for `createContext` reading the header off a Fetch Request**

Append to `app/server/graphql/context.test.ts`:

```ts
import type { PrismaClient } from '@prisma/client';

import type { AppConfig } from '../types';
import { createContext, type Stores } from './context';

describe('createContext', () => {
  const prisma = {} as PrismaClient;
  const stores = {} as Stores;
  const config = {} as AppConfig;

  it('derives the viewer from the request Authorization header', () => {
    const token = signAccessToken(secret, {
      userId: 'user-1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });
    const context = createContext({ prisma, stores, config, jwtSecret: secret })({
      request: new Request('http://localhost/graphql', {
        headers: { authorization: `Bearer ${token}` },
      }),
    });

    expect(context.viewer?.username).toBe('alice');
    expect(context.prisma).toBe(prisma);
    expect(context.stores).toBe(stores);
    expect(context.config).toBe(config);
  });

  it('yields a null viewer when the request carries no Authorization header', () => {
    const context = createContext({ prisma, stores, config, jwtSecret: secret })({
      request: new Request('http://localhost/graphql'),
    });

    expect(context.viewer).toBeNull();
  });
});
```

Merge the new imports into the existing import block at the top of the file rather than leaving duplicates — `oxfmt` sorts imports and will reformat them.

- [ ] **Step 6: Run the tests**

```bash
npm test -w app/server -- graphql/context
```

Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```bash
git add app/server/graphql/context.ts app/server/graphql/context.test.ts
git commit -m "feat(graphql): add request context with viewer derived from the access token"
```

---

### Task 3: Builder, scopes, `Query.viewer`, and the test harness

**Files:**
- Create: `app/server/graphql/schema/builder.ts`
- Create: `app/server/graphql/schema/index.ts`
- Create: `app/server/graphql/schema/viewer/index.ts`
- Create: `app/server/graphql/schema/viewer/model.ts`
- Create: `app/server/graphql/schema/viewer/query/current.ts`
- Create: `app/server/graphql/test-util.ts`
- Test: `app/server/graphql/schema/viewer/query/current.test.ts`

**Interfaces:**
- Consumes: `Context`, `Viewer`, `Stores`, `requireViewer` from Task 2; `PrismaTypes` from Task 1
- Produces:
  - `builder` — the configured `SchemaBuilder`, imported by every later field file
  - `schema` — the built `GraphQLSchema`, from `app/server/graphql/schema/index.ts`
  - `createHarness(): Promise<Harness>` where
    `Harness = { execute: (document: string, options?: { viewer?: Viewer | null; variables?: Record<string, unknown> }) => Promise<ExecutionResult>; prisma: PrismaClient; stores: Stores; config: AppConfig; aliceOwner: Owner; aliceViewer: Viewer; adminViewer: Viewer; cleanup: () => Promise<void> }`

- [ ] **Step 1: Confirm the installed plugin option names**

Pothos moved several options between v3 and v4 (`relayOptions` → `relay`, scope-auth options under `scopeAuth`). Before writing the builder, check the installed versions rather than trusting this plan:

```bash
grep -n "scopeAuth\|authScopes" app/server/node_modules/@pothos/plugin-scope-auth/README.md | head -20
grep -n "relay:\|clientMutationId" app/server/node_modules/@pothos/plugin-relay/README.md | head -20
```

If an option name differs from the code below, use the installed version's name. `tsc --noEmit` in Step 8 will catch anything missed.

- [ ] **Step 2: Write the failing test**

Create `app/server/graphql/schema/viewer/query/current.test.ts`:

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

describe('Query.viewer', () => {
  it('returns the authenticated user', async () => {
    const result = await harness.execute('{ viewer { username isAdmin mustChangePassword } }');

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      viewer: { username: 'alice', isAdmin: false, mustChangePassword: false },
    });
  });

  it('returns the config admin, which has no user row', async () => {
    const result = await harness.execute('{ viewer { username isAdmin } }', {
      viewer: harness.adminViewer,
    });

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ viewer: { username: 'admin', isAdmin: true } });
  });

  it('refuses an unauthenticated request', async () => {
    const result = await harness.execute('{ viewer { username } }', { viewer: null });

    expect(result.errors).toBeDefined();
    expect(result.data?.viewer ?? null).toBeNull();
  });
});
```

The third test is the load-bearing one: it proves the builder-level `authenticated` scope actually gates a field, rather than the field happening to work because a viewer was present.

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm test -w app/server -- graphql/schema/viewer
```

Expected: FAIL — `Cannot find module '../../../test-util'`. Steps 4–6 build what it needs.

- [ ] **Step 4: Write the builder**

Create `app/server/graphql/schema/builder.ts`:

```ts
import SchemaBuilder from '@pothos/core';
import ErrorsPlugin from '@pothos/plugin-errors';
import PrismaPlugin from '@pothos/plugin-prisma';
import RelayPlugin from '@pothos/plugin-relay';
import ScopeAuthPlugin from '@pothos/plugin-scope-auth';
import ValidationPlugin from '@pothos/plugin-validation';
import { DateTimeResolver } from 'graphql-scalars';

import type { Context } from '../context';
import type PrismaTypes from '../generated/pothos-types';

export const builder = new SchemaBuilder<{
  Context: Context;
  PrismaTypes: PrismaTypes;
  AuthScopes: {
    authenticated: boolean;
    admin: boolean;
    ownerOf: string;
  };
  // Pothos v4 defaults DefaultFieldNullability to TRUE (nullable). Both the
  // type param and the option below are required to get non-null fields; omit
  // either and the SDL emits `viewer: Viewer` instead of `viewer: Viewer!`.
  DefaultFieldNullability: false;
  DefaultInputFieldRequiredness: true;
  Scalars: {
    DateTime: { Input: Date; Output: Date };
  };
}>({
  // ScopeAuthPlugin must come first so its field wrapping runs outermost —
  // authorization has to reject before any other plugin's resolver logic runs.
  plugins: [ScopeAuthPlugin, PrismaPlugin, RelayPlugin, ErrorsPlugin, ValidationPlugin],
  defaultFieldNullability: false,
  defaultInputFieldRequiredness: true,
  scopeAuth: {
    authScopes: (context: Context) => ({
      authenticated: context.viewer !== null,
      admin: context.viewer?.isAdmin === true,
      ownerOf: (userId: string) =>
        context.viewer?.isAdmin === true || context.viewer?.userId === userId,
    }),
  },
  prisma: { client: (context: Context) => context.prisma },
  relay: { clientMutationId: 'omit', cursorType: 'String' },
});

builder.addScalarType('DateTime', DateTimeResolver);

// Every field requires an authenticated viewer, with no exceptions: login,
// token refresh and public-config all stay on REST, so no unauthenticated
// GraphQL field exists.
builder.queryType({ authScopes: { authenticated: true } });
```

- [ ] **Step 5: Write the Viewer type and `Query.viewer`**

Create `app/server/graphql/schema/viewer/model.ts`:

```ts
import type { Viewer } from '../../context';
import { builder } from '../builder';

export const model = builder.objectRef<Viewer>('Viewer').implement({
  fields: (t) => ({
    username: t.exposeString('username'),
    isAdmin: t.exposeBoolean('isAdmin'),
    mustChangePassword: t.exposeBoolean('mustChangePassword'),
  }),
});
```

`syncPassword`, `user`, `library`, `users` and `devices` are deliberately absent — they belong to delivery step 3, which introduces the models they return.

Create `app/server/graphql/schema/viewer/query/current.ts`:

```ts
import { requireViewer } from '../../../context';
import { builder } from '../../builder';
import { model } from '../index';

builder.queryField('viewer', (t) =>
  t.field({
    type: model,
    resolve: (_parent, _args, context) => requireViewer(context),
  })
);
```

Create `app/server/graphql/schema/viewer/index.ts`:

```ts
export { model } from './model';

import './query/current';
```

The re-export must precede the side-effect import: `query/current.ts` imports `model` from this file, and the export has to be established before that module body runs. This mirrors the convention in `SplitSplit/api-service`.

Create `app/server/graphql/schema/index.ts`:

```ts
import './viewer';

import { builder } from './builder';

export const schema = builder.toSchema();
```

- [ ] **Step 6: Write the test harness**

Create `app/server/graphql/test-util.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { graphql, type ExecutionResult } from 'graphql';

import { runMigrations } from '../db/migrate';
import { BookStore } from '../services/book-store';
import { DeviceStore } from '../services/device-store';
import { EditionStore } from '../services/edition-store';
import { ScanJobStore } from '../services/scan-job-store';
import { ThumbnailQueue } from '../services/thumbnail-queue';
import { UserStore } from '../services/user-store';
import { ValidationStore } from '../services/validation-store';
import type { AppConfig, Owner } from '../types';
import type { Context, Stores, Viewer } from './context';
import { schema } from './schema';

export type ExecuteOptions = {
  viewer?: Viewer | null;
  variables?: Record<string, unknown>;
};

export type Harness = {
  execute: (document: string, options?: ExecuteOptions) => Promise<ExecutionResult>;
  prisma: PrismaClient;
  stores: Stores;
  config: AppConfig;
  /** A real user row created by the harness, for owner-scoped assertions. */
  aliceOwner: Owner;
  aliceViewer: Viewer;
  adminViewer: Viewer;
  cleanup: () => Promise<void>;
};

const testConfig = (booksDir: string, dataDir: string): AppConfig => ({
  libraryName: 'Test Library',
  username: 'admin',
  password: 'adminpass',
  booksDir,
  dataDir,
  port: 0,
  maxConcurrentUploads: 1,
  thumbnailWidths: [200],
  // ValidationThreshold is ALL-UPPERCASE in the TypeScript type:
  // NONE | FATAL | ERROR | WARNING | INFO | USAGE
  // (@korzun/epubcheck-ts/dist/index.d.ts:30-38). config.yaml's
  // `list(Fatal|Error|Warning|Info)` is the addon-options vocabulary, which is
  // normalized before it reaches AppConfig — do not copy its casing.
  validationThreshold: 'ERROR',
});

/**
 * Builds the same real stack the REST route tests use — temp SQLite, real
 * migrations, real stores, temp books directory — and executes operations
 * against the built schema without going over HTTP.
 */
export const createHarness = async (): Promise<Harness> => {
  const booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookplate-gql-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookplate-gql-data-'));
  const dbPath = path.join(
    os.tmpdir(),
    `gql-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );

  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  const prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksDir);

  const config = testConfig(booksDir, dataDir);
  const edition = new EditionStore(path.join(dataDir, 'editions'), prisma);
  const user = new UserStore(prisma, edition);
  const book = new BookStore(booksDir, prisma, edition);
  const stores: Stores = {
    book,
    user,
    device: new DeviceStore(prisma),
    edition,
    validation: new ValidationStore(prisma),
    scanJob: new ScanJobStore(),
    // Constructed but never started: no test in this plan enqueues thumbnails,
    // and start() would leave a timer running past the test.
    thumbnail: new ThumbnailQueue(book, config.thumbnailWidths),
  };

  await user.createUser('alice', await UserStore.hashLoginPassword('alicepass'));
  const aliceId = (await user.getUserIdByUsername('alice'))!;
  fs.mkdirSync(path.join(booksDir, 'alice'), { recursive: true });

  const aliceViewer: Viewer = {
    userId: aliceId,
    username: 'alice',
    isAdmin: false,
    mustChangePassword: false,
  };
  const adminViewer: Viewer = {
    userId: null,
    username: 'admin',
    isAdmin: true,
    mustChangePassword: false,
  };

  const execute = (document: string, options: ExecuteOptions = {}): Promise<ExecutionResult> => {
    const contextValue: Context = {
      viewer: options.viewer === undefined ? aliceViewer : options.viewer,
      prisma,
      stores,
      config,
    };
    return graphql({
      schema,
      source: document,
      contextValue,
      variableValues: options.variables,
    });
  };

  const cleanup = async (): Promise<void> => {
    await prisma.$disconnect();
    try {
      fs.unlinkSync(dbPath);
    } catch {
      /* best-effort cleanup */
    }
    fs.rmSync(booksDir, { recursive: true });
    fs.rmSync(dataDir, { recursive: true });
  };

  return {
    execute,
    prisma,
    stores,
    config,
    aliceOwner: { userId: aliceId, username: 'alice' },
    aliceViewer,
    adminViewer,
    cleanup,
  };
};
```

`execute` defaults to `aliceViewer`, so tests only mention the viewer when it is the thing under test. Passing `viewer: null` exercises the unauthenticated path.

- [ ] **Step 7: Run the test to verify it passes**

```bash
npm test -w app/server -- graphql/schema/viewer
```

Expected: PASS, 3 tests.

- [ ] **Step 8: Typecheck and run the whole suite**

```bash
npx tsc --noEmit -p app/server/tsconfig.json
npm test -w app/server
```

Expected: no type errors; all tests PASS, including the untouched REST suites.

- [ ] **Step 9: Commit**

```bash
git add app/server/graphql/schema app/server/graphql/test-util.ts
git commit -m "feat(graphql): add pothos builder, auth scopes and Query.viewer"
```

---

### Task 4: Mount yoga on Express

**Files:**
- Create: `app/server/graphql/yoga.ts`
- Test: `app/server/graphql/yoga.test.ts`
- Modify: `app/server/server.ts:25-82`
- Modify: `app/server/index.ts:47-57`

**Interfaces:**
- Consumes: `schema` from Task 3; `createContext`, `ContextDeps`, `Stores` from Task 2
- Produces: `createGraphqlHandler(deps: ContextDeps & { isProduction: boolean }): RequestHandler` — an Express-compatible handler mounted at `/graphql`

- [ ] **Step 1: Write the failing test**

Create `app/server/graphql/yoga.test.ts`:

```ts
import express from 'express';
import request from 'supertest';

import { signAccessToken } from '../services/jwt';
import { createHarness, type Harness } from './test-util';
import { createGraphqlHandler } from './yoga';

vi.mock('../logger');

const jwtSecret = Buffer.from('c'.repeat(64), 'hex');

let harness: Harness;
let app: express.Express;

const buildApp = (isProduction: boolean): express.Express => {
  const server = express();
  server.use(
    '/graphql',
    createGraphqlHandler({
      prisma: harness.prisma,
      stores: harness.stores,
      config: harness.config,
      jwtSecret,
      isProduction,
    })
  );
  return server;
};

beforeEach(async () => {
  harness = await createHarness();
  app = buildApp(false);
});

afterEach(async () => {
  await harness.cleanup();
});

describe('POST /graphql', () => {
  it('answers a viewer query for a valid bearer token', async () => {
    const token = signAccessToken(jwtSecret, {
      userId: harness.aliceOwner.userId,
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });

    const response = await request(app)
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: '{ viewer { username isAdmin } }' });

    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data).toEqual({ viewer: { username: 'alice', isAdmin: false } });
  });

  it('rejects a request with no Authorization header', async () => {
    const response = await request(app)
      .post('/graphql')
      .send({ query: '{ viewer { username } }' });

    expect(response.body.errors).toBeDefined();
    expect(response.body.data?.viewer ?? null).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = signAccessToken(Buffer.from('d'.repeat(64), 'hex'), {
      userId: harness.aliceOwner.userId,
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });

    const response = await request(app)
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: '{ viewer { username } }' });

    expect(response.body.errors).toBeDefined();
  });

  it('serves GraphiQL outside production', async () => {
    const response = await request(app).get('/graphql').set('Accept', 'text/html');

    expect(response.status).toBe(200);
    expect(response.text).toContain('graphiql');
  });

  it('does not serve GraphiQL in production', async () => {
    const response = await request(buildApp(true)).get('/graphql').set('Accept', 'text/html');

    expect(response.text ?? '').not.toContain('graphiql');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w app/server -- graphql/yoga
```

Expected: FAIL — `Cannot find module './yoga'`.

- [ ] **Step 3: Write the implementation**

Create `app/server/graphql/yoga.ts`:

```ts
import type { RequestHandler } from 'express';
import { createYoga } from 'graphql-yoga';

import { logger } from '../logger';
import { createContext, type ContextDeps } from './context';
import { schema } from './schema';

const log = logger('GraphQL');

export type GraphqlHandlerDeps = ContextDeps & { isProduction: boolean };

/**
 * Builds the yoga handler. Returned as an Express-compatible request handler
 * so server.ts can mount it without knowing anything about yoga or Prisma.
 *
 * The cast bridges yoga's Node request/response types to Express's. It is
 * structural only — yoga's instance is callable as (req, res) — but the two
 * declarations do not line up nominally. Drop the cast if it typechecks
 * without it on the installed version; do NOT reach for `any`, which is a
 * lint error in this workspace.
 */
export const createGraphqlHandler = ({
  isProduction,
  ...deps
}: GraphqlHandlerDeps): RequestHandler =>
  createYoga({
    schema,
    context: createContext(deps),
    graphqlEndpoint: '/graphql',
    graphiql: !isProduction,
    maskedErrors: isProduction,
    landingPage: false,
    logging: {
      debug: (...args) => log.debug(args.map(String).join(' ')),
      info: (...args) => log.info(args.map(String).join(' ')),
      warn: (...args) => log.warn(args.map(String).join(' ')),
      error: (...args) => log.error(args.map(String).join(' ')),
    },
  });
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -w app/server -- graphql/yoga
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Mount it in `server.ts`**

In `app/server/server.ts`, add `RequestHandler` to the express import and **two** parameters to `createServer`. Both go last so existing positional arguments keep their meaning:

```ts
import express, { NextFunction, Request, RequestHandler, Response } from 'express';
```

```ts
export function createServer(
  config: AppConfig,
  userStore: UserStore,
  bookStore: BookStore,
  thumbnailQueue: ThumbnailQueue,
  tokenStore: TokenStore,
  jwtSecret: Buffer,
  deviceStore: DeviceStore,
  editionStore: EditionStore,
  validationStore: ValidationStore,
  scanJobStore: ScanJobStore,
  graphqlHandler: RequestHandler
): express.Express {
```

`scanJobStore` becomes a parameter because the GraphQL context and the REST scan routes must share **one** instance — otherwise a scan started over REST is invisible to GraphQL. Delete the internal construction at `server.ts:69`:

```ts
  const scanJobStore = new ScanJobStore();   // <- DELETE this line
```

`createUiRouter` already receives `scanJobStore`; it now receives the injected one. The `import { ScanJobStore }` in `server.ts` becomes type-only — change it to `import type { ScanJobStore } from './services/scan-job-store';`.

Then mount the GraphQL handler immediately after `server.use(requestLog());` and **before** `server.use(express.json());`:

```ts
  // Mounted ahead of express.json(): yoga reads the raw request body itself,
  // and a body already consumed by a parser upstream would leave it with
  // nothing to read. requestTimeout and requestLog still apply — they run
  // before this and do not touch the body. requestTimeout's 503 cannot fire on
  // a subscription stream, because it bails out once headers are sent and SSE
  // sends them immediately.
  server.use('/graphql', graphqlHandler);
```

- [ ] **Step 6: Wire it up in `index.ts`**

In `app/server/index.ts`, after `const jwtSecret = await tokenStore.getOrCreateJwtSecret();` (line 45) and before `createServer`:

```ts
  const scanJobStore = new ScanJobStore();
  const graphqlHandler = createGraphqlHandler({
    prisma,
    stores: {
      book: bookStore,
      user: userStore,
      device: deviceStore,
      edition: editionStore,
      validation: validationStore,
      scanJob: scanJobStore,
      thumbnail: thumbnailQueue,
    },
    config,
    jwtSecret,
    isProduction: process.env.NODE_ENV === 'production',
  });
```

Pass `scanJobStore` and then `graphqlHandler` as the final two arguments to `createServer`, and add the imports:

```ts
import { createGraphqlHandler } from './graphql/yoga';
import { ScanJobStore } from './services/scan-job-store';
```

One `ScanJobStore` now serves both transports, so a scan started over REST is observable through GraphQL. This is what makes the scan subscription in delivery step 5 possible without rework.

- [ ] **Step 7: Typecheck and run the whole suite**

```bash
npx tsc --noEmit -p app/server/tsconfig.json
npm test -w app/server
```

Expected: no type errors; every test PASSES, including all REST suites.

- [ ] **Step 8: Verify the mount by hand**

```bash
npm run dev -w app/server
```

In another shell:

```bash
curl -s -X POST http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ viewer { username } }"}'
```

Expected: a JSON response containing an authorization error, not a 404 and not the SPA's HTML. A 404 or HTML both mean the handler was mounted after the SPA catch-all. Stop the dev server afterwards. (Port 3000 is the default from `config.yaml`.)

- [ ] **Step 9: Commit**

```bash
git add app/server/graphql/yoga.ts app/server/graphql/yoga.test.ts \
  app/server/server.ts app/server/index.ts
git commit -m "feat(graphql): mount graphql-yoga at POST /graphql"
```

---

### Task 5: The SDL artifact and its lint gate

Spec 2's Houdini codegen consumes a committed SDL file, and committing it makes every schema change reviewable as a diff. The lint gate makes it impossible to change the schema without updating the artifact.

**Files:**
- Create: `app/server/graphql/print-schema.ts`
- Create: `app/server/graphql/schema.generated.graphql`
- Test: `app/server/graphql/print-schema.test.ts`
- Modify: `app/server/package.json` (scripts)

**Interfaces:**
- Consumes: `schema` from Task 3
- Produces: `printSchemaToString(schema: GraphQLSchema): string`; the npm scripts `graphql:schema` and `graphql:schema:check`

- [ ] **Step 1: Write the failing test**

Create `app/server/graphql/print-schema.test.ts`:

```ts
import { buildSchema } from 'graphql';

import { printSchemaToString } from './print-schema';

describe('printSchemaToString', () => {
  it('sorts types and fields lexicographically so diffs stay stable', () => {
    const schema = buildSchema(`
      type Zebra { b: String, a: String }
      type Apple { d: String, c: String }
      type Query { zebra: Zebra, apple: Apple }
    `);

    const printed = printSchemaToString(schema);

    expect(printed.indexOf('type Apple')).toBeLessThan(printed.indexOf('type Zebra'));
    expect(printed.indexOf('a: String')).toBeLessThan(printed.indexOf('b: String'));
  });

  it('ends with exactly one trailing newline', () => {
    const schema = buildSchema('type Query { a: String }');

    const printed = printSchemaToString(schema);

    expect(printed.endsWith('\n')).toBe(true);
    expect(printed.endsWith('\n\n')).toBe(false);
  });
});
```

Sorting is what makes the gate useful: without it, unrelated field-declaration order changes produce noise diffs and the gate gets ignored.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w app/server -- graphql/print-schema
```

Expected: FAIL — `Cannot find module './print-schema'`.

- [ ] **Step 3: Write the implementation**

Create `app/server/graphql/print-schema.ts`:

```ts
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
    const existing = fs.existsSync(ARTIFACT_PATH)
      ? fs.readFileSync(ARTIFACT_PATH, 'utf-8')
      : '';
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -w app/server -- graphql/print-schema
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Add the npm scripts**

In `app/server/package.json`, add to `scripts`:

```json
"graphql:schema": "tsx graphql/print-schema.ts",
"graphql:schema:check": "tsx graphql/print-schema.ts --check",
```

and extend `lint` to run the check last, so a schema change without an artifact update fails the build:

```json
"lint": "oxlint && oxfmt --check \"**/*.ts\" && tsc --noEmit && npm run graphql:schema:check",
```

- [ ] **Step 6: Generate and inspect the artifact**

```bash
npm run graphql:schema -w app/server
cat app/server/graphql/schema.generated.graphql
```

Expected: SDL containing `type Query { viewer: Viewer! }` and `type Viewer` with `username`, `isAdmin` and `mustChangePassword`. Confirm `viewer` is non-null and the three `Viewer` fields are non-null — that is `defaultFieldNullability` behaving as configured.

- [ ] **Step 7: Prove the gate actually fails**

Temporarily add a field to `app/server/graphql/schema/viewer/model.ts`:

```ts
    canary: t.exposeString('username'),
```

Then:

```bash
npm run graphql:schema:check -w app/server
```

Expected: exits non-zero with "GraphQL schema artifact is out of date."

Remove the `canary` line and re-run — expected: exits zero. A gate that has never been seen to fail is not known to work.

- [ ] **Step 8: Run lint from the repo root and the full suite**

```bash
npm run lint
npm test -w app/server
```

Expected: both PASS. Run lint from the repo root, never from inside a workspace — the repo has two and running inside one silently skips the other.

- [ ] **Step 9: Commit**

```bash
git add app/server/graphql/print-schema.ts app/server/graphql/print-schema.test.ts \
  app/server/graphql/schema.generated.graphql app/server/package.json
git commit -m "feat(graphql): commit the SDL artifact and gate it in lint"
```

---

## Definition of done for this plan

- `POST /graphql` answers `{ viewer { username isAdmin mustChangePassword } }` for a valid bearer token and refuses everything else.
- The compound-key global ID question is answered, recorded in the repo, and covered by a regression test.
- `schema.generated.graphql` is committed and `npm run lint` fails when it drifts.
- Every existing REST test passes unchanged.
- No file under `app/client/` was modified.

## Handoff to the next plan

Report the Task 1 verdict before the next plan is written. It determines whether delivery step 3 declares models with `builder.prismaNode` or with `builder.prismaObject` + explicit `builder.node`, which affects every entity in the read model.

`ScanJobStore` is already unified: Task 4 hoists its construction into `index.ts` and injects the single instance into both `createServer` (for the REST scan routes) and the GraphQL context. Delivery step 5's subscription can observe a REST-initiated scan without further rework.

**`passwordChangeAllowed` scope — phase 4 must wire this up.** The builder's `authenticated` scope now means "signed in *and* no forced password change pending", mirroring REST's `passwordChangeGate` (`middleware/auth.ts`), which blocks every `/api/*` route except `/api/my/password` while a change is outstanding. A second scope, `passwordChangeAllowed` (signed in, ignoring the pending change), exists solely for the eventual `userChangePassword` mutation: that mutation MUST declare `authScopes: { passwordChangeAllowed: true }`, otherwise a user forced to change their password can never reach the mutation that lets them do it. No other field may use it. `graphql/schema/root-auth.test.ts` walks every root field and asserts it refuses a null viewer, so an ungated mutation added in phase 4 fails CI rather than shipping unauthenticated.

**Auth errors carry machine-readable codes.** Auth failures return `extensions.code` of `UNAUTHENTICATED` (HTTP 401, no viewer) or `FORBIDDEN` (HTTP 403, viewer present but refused), set by `unauthorizedError` in `graphql/schema/builder.ts`. Phase 2's Houdini client should branch on the code and reuse the REST client's existing 401-triggers-refresh path rather than string-matching messages.
