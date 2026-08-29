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
import { pruneThumbnails } from './services/book-assets';
import { scan } from './services/book-lifecycle';
import { getStagingDir } from './services/book-paths';
import { createReplaceStaging } from './services/replace-staging';
import { ScanJobStore } from './services/scan-job-store';
import { ThumbnailQueue } from './services/thumbnail-queue';
import { getOrCreateJwtSecret } from './services/token';

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

  const editionsRoot = path.join(config.dataDir, 'editions');
  const thumbnailQueue = new ThumbnailQueue(prisma, config.thumbnailWidths);
  const jwtSecret = await getOrCreateJwtSecret(prisma);

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
  const replaceStaging = createReplaceStaging({ stagingDir: getStagingDir(config.booksDir) });
  const graphqlHandler = createGraphqlHandler({
    prisma,
    stores: {
      // No production code reaches this any more — see `Stores.book`'s doc
      // comment in `graphql/context.ts` for why it's still here at all.
      book: {},
      scanJob: scanJobStore,
      thumbnail: thumbnailQueue,
      replaceStaging,
    },
    editionsRoot,
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
    thumbnailQueue,
    jwtSecret,
    editionsRoot,
    prisma,
    graphqlHandler,
    replaceStaging
  );

  // Startup scan: per user — create missing folders, import untracked EPUBs,
  // clean up stale DB entries.
  try {
    // Single-statement `findMany`, one production caller — inlined under
    // the placement rule. No unit test covers this directly (it runs only
    // as part of server startup); `graphql/schema/viewer/users.test.ts`'s
    // "lists every user ... ordered by username" test covers the identical
    // shape (`findMany` + `orderBy: { username: 'asc' }`) for the separate
    // `Viewer.users` resolver, which is the closest existing coverage.
    const ownerRows = await prisma.user.findMany({
      select: { id: true, username: true },
      orderBy: { username: 'asc' },
    });
    const owners = ownerRows.map((r) => ({ userId: r.id, username: r.username }));
    let scanned = 0;
    let imported = 0;
    let removed = 0;
    for (const owner of owners) {
      // The config-based admin owns no library; a legacy DB row bearing its
      // username must not materialize one.
      if (owner.username === config.username) continue;
      fs.mkdirSync(path.join(config.booksDir, owner.username), { recursive: true });
      const scanResult = await scan(prisma, config.booksDir, owner);
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
    const deleted = await pruneThumbnails(prisma, []);
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
