import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { encodeGlobalID } from '@pothos/plugin-relay';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { graphql, type ExecutionResult } from 'graphql';

import { runMigrations } from '../db/migrate';
import { BookStore } from '../services/book-store';
import { DeviceStore } from '../services/device-store';
import { EditionStore } from '../services/edition-store';
import { createReplaceStaging } from '../services/replace-staging';
import { ScanJobStore } from '../services/scan-job-store';
import { ThumbnailQueue } from '../services/thumbnail-queue';
import { TokenStore } from '../services/token-store';
import { UserStore } from '../services/user-store';
import { ValidationStore } from '../services/validation-store';
import type { AppConfig, Owner } from '../types';
import { createChapterSpineMapLoader } from './chapter-spine-map-loader';
import type { Context, Stores, Viewer } from './context';
import { createOwnerLoader } from './owner';
import { createPendingFixLoader } from './pending-fix-loader';
import { createProgressLoader } from './progress-loader';
import { createScanPubSub } from './pubsub';
import { schema } from './schema';
import { createSeriesProgressLoader } from './series-progress-loader';

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

const testConfig = (booksDir: string, dataDir: string): AppConfig => ({
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
    // Same real `ScanPubSub` a subscription resolver reads from
    // (`schema/library/subscription/scan-progress.ts`, via
    // `context.stores.scanJob.subscribe`) — not the class's own default,
    // throwaway instance, or a test starting/completing a job through this
    // store would never be observed by a `subscribe()` call against `schema`
    // in the same test. Mirrors `index.ts`'s identical wiring.
    scanJob: new ScanJobStore(createScanPubSub()),
    // Constructed but never started: start() would leave a timer running past
    // the test. `enqueue()` itself is inert either way — it only pushes onto
    // an in-memory array (`services/thumbnail-queue.ts:53-57`); nothing reads
    // that array without a running `processLoop`. Task 3b's staged-cover
    // tests DO call `enqueue()` (via `bookUpdateMetadata`) and assert on it
    // with `vi.spyOn` — safe precisely because it's inert here.
    thumbnail: new ThumbnailQueue(book, config.thumbnailWidths),
    replaceStaging: createReplaceStaging({ stagingDir: book.getStagingDir() }),
    token: new TokenStore(prisma),
  };

  await user.createUser('alice', await UserStore.hashLoginPassword('alicepass'));
  const aliceId = (await user.getUserIdByUsername('alice'))!;
  const aliceGlobalId = encodeGlobalID('User', aliceId);
  fs.mkdirSync(path.join(booksDir, 'alice'), { recursive: true });

  await user.createUser('bob', await UserStore.hashLoginPassword('bobpass'));
  const bobId = (await user.getUserIdByUsername('bob'))!;
  fs.mkdirSync(path.join(booksDir, 'bob'), { recursive: true });

  const aliceViewer: Viewer = {
    userId: aliceId,
    username: 'alice',
    isAdmin: false,
    mustChangePassword: false,
  };
  const bobViewer: Viewer = {
    userId: bobId,
    username: 'bob',
    isAdmin: false,
    mustChangePassword: false,
  };
  const adminViewer: Viewer = {
    userId: null,
    username: 'admin',
    isAdmin: true,
    mustChangePassword: false,
  };

  const execute = async (
    document: string,
    options: ExecuteOptions = {}
  ): Promise<ExecutionResult> => {
    const contextValue: Context = {
      viewer: options.viewer === undefined ? aliceViewer : options.viewer,
      prisma,
      stores,
      config,
      loadOwner: createOwnerLoader(prisma),
      loadProgress: createProgressLoader(prisma),
      loadPendingFix: createPendingFixLoader(prisma),
      loadChapterSpineMap: createChapterSpineMapLoader(prisma),
      loadSeriesProgress: createSeriesProgressLoader(prisma),
    };
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
    stores,
    config,
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
