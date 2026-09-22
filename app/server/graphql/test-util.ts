import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { encodeGlobalID } from '@pothos/plugin-relay';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { graphql, type ExecutionResult } from 'graphql';

import { runMigrations } from '../db/migrate';
import { getStagingDir } from '../services/book-paths';
import type { NotificationPoker } from '../services/notification-queue';
import { hashLoginPassword } from '../services/password';
import { createReplaceStaging, type ReplaceStaging } from '../services/replace-staging';
import { ThumbnailQueue } from '../services/thumbnail-queue';
import { createUser } from '../services/user';
import { createFakeMailer, MAIL_CONFIG, type FakeMailer } from '../test-support/mail';
import type { AppConfig, MailConfig, Owner } from '../types';
import type { Context, Viewer } from './context';
import {
  createBookByDocumentLoader,
  createDeviceEditionCountLoader,
  createLineageLoader,
  createOwnerLoader,
  createPendingFixLoader,
  createProgressLoader,
  createSeriesProgressLoader,
  createValidationCountsLoader,
  createViewerRowLoader,
} from './loaders';
import { schema } from './schema';

export type ExecuteOptions = {
  viewer?: Viewer | null;
  variables?: Record<string, unknown>;
};

// `FakeMailer` and `MAIL_CONFIG` live in `../test-support/mail` — shared with
// `routes/ui.test.ts` and `routes/password.test.ts` rather than declared
// separately in each. Re-exported here since downstream suites
// (`viewer/mutation/*.test.ts`) already import `MAIL_CONFIG` from this
// module.
export { MAIL_CONFIG };

export type CreateHarnessOptions = {
  /**
   * Passed through to `AppConfig.mail`. Omitted or `null` behaves like a real
   * unconfigured install — `isMailConfigured` is false and `harness.mailer`
   * (and `Context.mailer`) is `null`, exactly as `createMailer` would return
   * for an unconfigured install. Pass `MAIL_CONFIG` (or a custom value) to
   * get a `FakeMailer` wired into every context this harness builds.
   */
  mail?: MailConfig | null;
};

export type Harness = {
  execute: (document: string, options?: ExecuteOptions) => Promise<ExecutionResult>;
  /**
   * The exact `Context` `execute` builds, for the tests that call a resolver
   * (or subscribe) directly instead of going through `execute`. Exposed so the
   * `Context` shape is spelled out in exactly ONE place: three suites used to
   * hand-roll their own near-copy, and all three had silently fallen behind —
   * each was missing `editionsRoot`, `loadValidationCounts` and
   * `loadBookByDocument`, so any resolver reached through them would have hit
   * `undefined` where a dataloader belonged. Nothing caught it because test
   * files were not type-checked; `tsconfig.test.json` now checks them, and
   * routing every construction through here means a new `Context` field can
   * only be forgotten once.
   */
  contextFor: (viewer: Viewer | null) => Context;
  prisma: PrismaClient;
  thumbnails: ThumbnailQueue;
  replaceStaging: ReplaceStaging;
  config: AppConfig;
  /**
   * `null` unless `createHarness({ mail: ... })` was given a mail config —
   * the same instance every context this harness builds carries as
   * `Context.mailer`. Tests assert on `mailer.sent` / set `mailer.nextResult`.
   */
  mailer: FakeMailer | null;
  /**
   * The same recording poker every context this harness builds carries as
   * `Context.notifications` — exposed so a test wiring `createGraphqlHandler`
   * deps directly (rather than going through `contextFor`) can pass the
   * identical instance, the same reason `mailer` above is exposed.
   */
  notifications: NotificationPoker;
  /** How many times a resolver has poked the notification drain. */
  readonly pokes: number;
  /** `path.join(dataDir, 'editions')` — same value `Context.editionsRoot` carries. */
  editionsRoot: string;
  /** A real user row created by the harness, for owner-scoped assertions. */
  aliceOwner: Owner;
  aliceViewer: Viewer;
  /** Alice's `User` node, encoded the same way the schema itself would. */
  aliceGlobalId: string;
  /** A second real user, distinct from alice, for cross-tenant assertions. */
  bobOwner: Owner;
  bobViewer: Viewer;
  adminViewer: Viewer;
  /**
   * Inserts a minimal row owned by alice for the given `Node` type name and
   * returns its real global ID — encoded with `@pothos/plugin-relay`'s own
   * `encodeGlobalID`, the same function the schema itself uses (builder.ts's
   * `relay` config does not override it), rather than a hand-rolled base64
   * string — see node-scope.test.ts's generic cross-tenant suite, which this
   * exists for.
   *
   * Throws for a type with no seeding branch below rather than returning a
   * bogus id: a silent skip is how that suite would quietly stop covering a
   * type someone adds later without also adding a branch here.
   */
  seedNodeFor: (typeName: string) => Promise<string>;
  cleanup: () => Promise<void>;
};

const testConfig = (booksDir: string, dataDir: string, mail: MailConfig | null): AppConfig => ({
  libraryName: 'Test Library',
  username: 'admin',
  password: 'adminpass',
  booksDir,
  dataDir,
  port: 0,
  maxConcurrentUploads: 1,
  thumbnailWidths: [200],
  // ValidationThreshold values are upper-cased: FATAL | ERROR | WARNING | INFO
  // (see @korzun/epubcheck-ts and ui.test.ts's use of the same literal).
  validationThreshold: 'ERROR',
  mail,
});

/**
 * Builds the same real stack the REST route tests use — temp SQLite, real
 * migrations, the real `services/*` functions, temp books directory — and
 * executes operations
 * against the built schema without going over HTTP.
 */
export const createHarness = async (
  harnessOptions: CreateHarnessOptions = {}
): Promise<Harness> => {
  const booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookplate-gql-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookplate-gql-data-'));
  const dbPath = path.join(
    os.tmpdir(),
    `gql-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );

  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  const prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksDir);

  const config = testConfig(booksDir, dataDir, harnessOptions.mail ?? null);
  // One instance shared by every context this harness builds, exactly the way
  // `index.ts` constructs `createMailer(config.mail)` once and never per
  // request — see `Context.mailer`'s doc comment. `null` when no mail config
  // was given, matching `createMailer` returning `null` for an unconfigured
  // install.
  const mailer: FakeMailer | null = config.mail ? createFakeMailer() : null;
  // A recording poker, so a test can assert the resolver hinted the drain
  // without constructing a real queue. Counting rather than spying keeps the
  // assertion readable — see `book-request/mutation/create.test.ts`.
  let pokes = 0;
  const notifications: NotificationPoker = {
    poke: () => {
      pokes += 1;
    },
  };
  const editionsRoot = path.join(dataDir, 'editions');
  // Constructed but never started: start() would leave a timer running past
  // the test. `enqueue()` itself is inert either way — it only pushes onto
  // an in-memory array (`services/thumbnail-queue.ts`'s `enqueue`); nothing reads
  // that array without a running `processLoop`. Task 3b's staged-cover
  // tests DO call `enqueue()` (via `bookUpdateMetadata`) and assert on it
  // with `vi.spyOn` — safe precisely because it's inert here.
  const thumbnails = new ThumbnailQueue(prisma, config.thumbnailWidths);
  // `let`, not `const`: a handful of tests (e.g.
  // `book/mutation/replace.test.ts`'s expired-staging case) swap in a
  // short-TTL `ReplaceStaging` mid-test via the returned harness's
  // `replaceStaging` setter below, and `execute()` must see that
  // replacement on its next call rather than the original instance closed
  // over here.
  let replaceStaging = createReplaceStaging({ stagingDir: getStagingDir(booksDir) });

  await createUser(prisma, 'alice', await hashLoginPassword('alicepass'));
  const aliceId = (await prisma.user.findUnique({ where: { username: 'alice' } }))!.id;
  const aliceGlobalId = encodeGlobalID('User', aliceId);
  fs.mkdirSync(path.join(booksDir, 'alice'), { recursive: true });

  await createUser(prisma, 'bob', await hashLoginPassword('bobpass'));
  const bobId = (await prisma.user.findUnique({ where: { username: 'bob' } }))!.id;
  fs.mkdirSync(path.join(booksDir, 'bob'), { recursive: true });

  const aliceViewer: Viewer = {
    userId: aliceId,
    username: 'alice',
    isAdmin: false,
    mustChangePassword: false,
    mustSetEmail: false,
  };
  const bobViewer: Viewer = {
    userId: bobId,
    username: 'bob',
    isAdmin: false,
    mustChangePassword: false,
    mustSetEmail: false,
  };
  const adminViewer: Viewer = {
    userId: null,
    username: 'admin',
    isAdmin: true,
    mustChangePassword: false,
    mustSetEmail: false,
  };

  // Reads `replaceStaging` at call time, not at harness-construction time, so
  // a test that swaps `harness.replaceStaging` mid-test is seen by the next
  // context built — the same reason the harness exposes that field through an
  // accessor pair rather than a plain value.
  const contextFor = (viewer: Viewer | null): Context => ({
    viewer,
    prisma,
    thumbnails,
    replaceStaging,
    editionsRoot,
    config,
    mailer,
    notifications,
    loadLineage: createLineageLoader(prisma),
    loadOwner: createOwnerLoader(prisma),
    loadProgress: createProgressLoader(prisma),
    loadPendingFix: createPendingFixLoader(prisma),
    loadSeriesProgress: createSeriesProgressLoader(prisma),
    loadValidationCounts: createValidationCountsLoader(prisma),
    loadBookByDocument: createBookByDocumentLoader(prisma),
    loadDeviceEditionCount: createDeviceEditionCountLoader(prisma),
    loadViewerRow: createViewerRowLoader(prisma, viewer),
  });

  const execute = async (
    document: string,
    options: ExecuteOptions = {}
  ): Promise<ExecutionResult> => {
    const contextValue: Context = contextFor(
      options.viewer === undefined ? aliceViewer : options.viewer
    );
    const result = await graphql({
      schema,
      source: document,
      contextValue,
      variableValues: options.variables,
    });
    // `graphql()` completes leaf scalars but does not serialize the response
    // to JSON the way the real HTTP transport (graphql-yoga) always does. That
    // matters for `DateTime`: graphql-scalars' resolver leaves an already-Date
    // value as a `Date` instance from `serialize()` and only becomes an ISO
    // string once something calls `JSON.stringify` on it (`Date.prototype.toJSON`).
    // Round-tripping `data` here makes every test see exactly what a real
    // client receives over the wire, instead of a harness-only Date instance
    // no caller can ever actually get.
    //
    // Deliberately scoped to `data` only, not the whole `ExecutionResult`:
    // `errors` holds real `GraphQLError` instances, and `JSON.stringify` on a
    // `GraphQLError` with an empty `extensions` drops the `extensions` key
    // entirely (its `toJSON()` omits empty objects), plus a full round-trip
    // would discard `instanceof GraphQLError`, `originalError`, and class
    // identity for every error in every test using this harness. `data` holds
    // plain resolved values (or `Date` leaves), so a JSON round-trip there
    // loses nothing that matters.
    return {
      ...result,
      data: result.data && (JSON.parse(JSON.stringify(result.data)) as typeof result.data),
    };
  };

  // Inserts a minimal row owned by alice for `typeName` and returns its real
  // global ID, encoded the same way the schema itself would — see the Harness
  // type's doc comment for why. A later task adding a tenant-owned Node type
  // must add a branch here, or this throws instead of silently under-covering
  // node-scope.test.ts's generic suite.
  const seedNodeFor = async (typeName: string): Promise<string> => {
    switch (typeName) {
      // `User`'s row already exists (alice herself, created above) — nothing
      // to insert. Her own `User` global ID is "owned by alice" in the literal
      // sense: it *is* her account.
      case 'User':
        return aliceGlobalId;
      // Library is 1:1 with User — its global id is alice's userId under a
      // different type name, so nothing new to insert, only re-encode.
      case 'Library':
        return encodeGlobalID('Library', aliceId);
      // Book's id is compound (`userId_id`), so its global id is NOT a plain
      // `encodeGlobalID('Book', bookId)` — Pothos's compound-id serializer
      // encodes `JSON.stringify([userId, id])` as the local id (see
      // node-scope.ts's `parseCompoundId` doc comment). Rather than replicate
      // that encoding by hand for the RETURNED id, read it back through the
      // schema itself. `Library.book`'s own `id` arg (task 2's one-ID-dialect
      // bridge) now takes that same gid shape, so the INPUT side is built
      // with `encodeGlobalID` directly — the exact construction every book
      // mutation test already trusts (`bookGlobalId` in e.g.
      // `book/mutation/validate.test.ts`), not a fresh hand-roll.
      case 'Book': {
        const bookId = 'b'.repeat(32);
        await prisma.book.create({
          data: { userId: aliceId, id: bookId, title: 'Seed', size: 1, mtime: 0, addedAt: 0 },
        });
        const inputGlobalId = encodeGlobalID('Book', JSON.stringify([aliceId, bookId]));
        const seeded = await execute(
          `{ viewer { library { book(id: "${inputGlobalId}") { id } } } }`,
          { viewer: aliceViewer }
        );
        const data = seeded.data as {
          viewer: { library: { book: { id: string } | null } };
        } | null;
        const globalId = data?.viewer.library.book?.id;
        if (globalId === undefined) {
          throw new Error('seedNodeFor("Book") could not read back the seeded book global id');
        }
        return globalId;
      }
      // Series has a plain `@id`, so its global id IS a plain
      // `encodeGlobalID('Series', id)` — no compound-id decoding needed. Still
      // read it back through the schema rather than hand-encoding, to match
      // every other branch here and catch a drift in how the schema itself
      // encodes it.
      case 'Series': {
        const seriesId = 'seed-series-1';
        await prisma.series.create({
          data: { id: seriesId, userId: aliceId, name: 'Seed Series', sortKey: 'seed series' },
        });
        const seeded = await execute(
          `{ viewer { library { seriesByName(name: "Seed Series") { id } } } }`,
          { viewer: aliceViewer }
        );
        const data = seeded.data as {
          viewer: { library: { seriesByName: { id: string } | null } };
        } | null;
        const globalId = data?.viewer.library.seriesByName?.id;
        if (globalId === undefined) {
          throw new Error('seedNodeFor("Series") could not read back the seeded series global id');
        }
        return globalId;
      }
      // Compound id (`userId_id`), like Book — so the global id is
      // `JSON.stringify([userId, id])` as the local id, not a plain
      // `encodeGlobalID('BookRequest', id)`. Read it back through the schema
      // rather than hand-encoding, matching every other branch here.
      case 'BookRequest': {
        await prisma.bookRequest.create({
          data: {
            userId: aliceId,
            id: 'seed-request-1',
            title: 'Seed',
            author: 'Seed Author',
            dedupeKey: 'seed\0seed author',
          },
        });
        const seeded = await execute(
          `{ viewer { user { bookRequests(first: 1) { edges { node { id } } } } } }`,
          { viewer: aliceViewer }
        );
        const data = seeded.data as {
          viewer: { user: { bookRequests: { edges: { node: { id: string } }[] } } | null };
        } | null;
        const globalId = data?.viewer.user?.bookRequests.edges[0]?.node.id;
        if (globalId === undefined) {
          throw new Error(
            'seedNodeFor("BookRequest") could not read back the seeded request global id'
          );
        }
        return globalId;
      }
      default:
        throw new Error(
          `seedNodeFor has no seeding branch for Node type "${typeName}" — add one in test-util.ts when that type is registered as a prismaNode.`
        );
    }
  };

  // Every step is independent and best-effort: a failing $disconnect() must not
  // skip the directory removals, or a test run leaks temp dirs into /tmp.
  const cleanup = async (): Promise<void> => {
    try {
      await prisma.$disconnect();
    } catch {
      /* best-effort cleanup */
    }
    for (const target of [dbPath, booksDir, dataDir]) {
      try {
        fs.rmSync(target, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  };

  return {
    execute,
    prisma,
    thumbnails,
    // Accessors, not a plain field: they read/write the same `let` binding
    // `execute()` closes over above, so a test that reassigns
    // `harness.replaceStaging` mid-test (swapping in a short-TTL instance)
    // is seen by the very next `execute()` call — a plain field here would
    // only update this returned object's own copy.
    get replaceStaging() {
      return replaceStaging;
    },
    set replaceStaging(value: ReplaceStaging) {
      replaceStaging = value;
    },
    config,
    mailer,
    notifications,
    get pokes() {
      return pokes;
    },
    editionsRoot,
    contextFor,
    aliceOwner: { userId: aliceId, username: 'alice' },
    aliceViewer,
    aliceGlobalId,
    bobOwner: { userId: bobId, username: 'bob' },
    bobViewer,
    adminViewer,
    seedNodeFor,
    cleanup,
  };
};
