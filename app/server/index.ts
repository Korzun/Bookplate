import * as fs from 'fs';
import * as path from 'path';

import packageJson from '../../package.json';
import { loadConfig } from './config';
import { createPrismaClient } from './db/client';
import { runMigrations } from './db/migrate';
import { createScanPubSub } from './graphql/pubsub';
import { createGraphqlHandler } from './graphql/yoga';
import { logger } from './logger';
import { createServer } from './server';
import { BookStore } from './services/book-store';
import { DeviceStore } from './services/device-store';
import { EditionStore } from './services/edition-store';
import { createReplaceStaging } from './services/replace-staging';
import { ScanJobStore } from './services/scan-job-store';
import { ThumbnailQueue } from './services/thumbnail-queue';
import { TokenStore } from './services/token-store';
import { UserStore } from './services/user-store';

const version: string = packageJson.version;

const log = logger('Server');

process.on('unhandledRejection', (reason) => {
  log.error(
    `Unhandled promise rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`
  );
});

const config = loadConfig();

fs.mkdirSync(config.booksDir, { recursive: true });
fs.mkdirSync(config.dataDir, { recursive: true });

(async () => {
  const dbPath = path.join(config.dataDir, 'db.sqlite');
  const prisma = createPrismaClient(`file:${dbPath}`);
  await runMigrations(prisma, config.booksDir);

  const editionStore = new EditionStore(path.join(config.dataDir, 'editions'), prisma);
  const userStore = new UserStore(prisma, editionStore);
  const bookStore = new BookStore(config.booksDir, prisma, editionStore);
  const deviceStore = new DeviceStore(prisma);
  const thumbnailQueue = new ThumbnailQueue(bookStore, config.thumbnailWidths);
  const tokenStore = new TokenStore(prisma);
  const jwtSecret = await tokenStore.getOrCreateJwtSecret();

  // Shared by REST's `POST /api/books/scan` and every GraphQL scan resolver
  // (`libraryScan`, `Subscription.scanProgress`, `Library.scanStatus`) — one
  // pubsub instance, handed to `ScanJobStore` below so a scan started through
  // either transport publishes onto the same per-user topic a GraphQL
  // subscriber reads. See `graphql/pubsub.ts`'s doc comment.
  const scanPubSub = createScanPubSub();
  const scanJobStore = new ScanJobStore(scanPubSub);
  // One instance shared by the REST staging route and the two GraphQL
  // mutations that consume it — see `graphql/context.ts`'s `Stores.
  // replaceStaging` doc comment for why a second instance would never see
  // the first one's staged files.
  const replaceStaging = createReplaceStaging({ stagingDir: bookStore.getStagingDir() });
  const graphqlHandler = createGraphqlHandler({
    prisma,
    stores: {
      book: bookStore,
      user: userStore,
      device: deviceStore,
      edition: editionStore,
      scanJob: scanJobStore,
      thumbnail: thumbnailQueue,
      replaceStaging,
      token: tokenStore,
    },
    config,
    jwtSecret,
    // Fail safe: hardening (no GraphiQL, masked errors, no introspection) is
    // the default and insecure mode must be opted into explicitly. Nothing in
    // the shipped image sets NODE_ENV — run.sh execs node directly and the
    // Dockerfile sets no env — so a `=== 'production'` test would leave every
    // real deployment running in dev mode. The server's `dev` npm script sets
    // NODE_ENV=development explicitly to keep GraphiQL locally.
    isProduction: process.env.NODE_ENV !== 'development',
  });

  const server = createServer(
    config,
    userStore,
    bookStore,
    thumbnailQueue,
    tokenStore,
    jwtSecret,
    deviceStore,
    editionStore,
    prisma,
    graphqlHandler,
    replaceStaging
  );

  // Startup scan: per user — create missing folders, import untracked EPUBs,
  // clean up stale DB entries.
  try {
    const owners = await userStore.listOwners();
    let scanned = 0;
    let imported = 0;
    let removed = 0;
    for (const owner of owners) {
      // The config-based admin owns no library; a legacy DB row bearing its
      // username must not materialize one.
      if (owner.username === config.username) continue;
      fs.mkdirSync(path.join(config.booksDir, owner.username), { recursive: true });
      const scanResult = await bookStore.scan(owner);
      scanned++;
      imported += scanResult.imported.length;
      removed += scanResult.removed.length;
    }
    log.info(`Startup scan (${scanned} user(s)): ${imported} imported, ${removed} removed`);
  } catch (err: unknown) {
    log.error(`Startup scan failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const regenRow = await prisma.setting.findUnique({ where: { key: 'regenerate_covers' } });
  if (!regenRow) {
    await prisma.setting.create({ data: { key: 'regenerate_covers', value: 'false' } });
  } else if (regenRow.value === 'true') {
    await prisma.setting.update({ where: { key: 'regenerate_covers' }, data: { value: 'false' } });
    const deleted = await bookStore.pruneThumbnails([]);
    log.info(`regenerate_covers: deleted ${deleted} thumbnail(s), queuing regeneration`);
  }

  await thumbnailQueue.start();

  const shutdown = async (): Promise<void> => {
    log.info('Server shutting down');
    thumbnailQueue.stop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  server.listen(config.port, () => {
    log.info(
      `Bookplate v${version} starting — port: ${config.port}, booksDir: ${config.booksDir}, dataDir: ${config.dataDir}`
    );
    log.info(`Web UI:  http://localhost:${config.port}/`);
    log.info(`OPDS:    http://localhost:${config.port}/opds/`);
    log.info(`KOSync:  http://localhost:${config.port}/sync/`);
  });
})().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
