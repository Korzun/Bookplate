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
import { createOwnerLoader } from './owner';
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
      loadOwner: createOwnerLoader(prisma),
    };
    return graphql({
      schema,
      source: document,
      contextValue,
      variableValues: options.variables,
    });
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
    adminViewer,
    cleanup,
  };
};
