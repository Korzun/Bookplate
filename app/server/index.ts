import * as fs from 'fs';
import * as path from 'path';

import packageJson from '../../package.json';
import { loadConfig } from './config';
import { createPrismaClient } from './db/client';
import { runMigrations } from './db/migrate';
import { createGraphqlHandler } from './graphql/yoga';
import { logger } from './logger';
import { createServer } from './server';
import { getStagingDir } from './services/book-paths';
import { createMailer } from './services/mailer';
import { createReplaceStaging } from './services/replace-staging';
import { ThumbnailQueue } from './services/thumbnail-queue';
import { getOrCreateJwtSecret } from './services/token';
import { startBookplate } from './startup';

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

  // One instance shared by the REST staging route and the two GraphQL
  // mutations that consume it — see `graphql/context.ts`'s `Context.
  // replaceStaging` doc comment for why a second instance would never see
  // the first one's staged files.
  const replaceStaging = createReplaceStaging({ stagingDir: getStagingDir(config.booksDir) });
  // One instance, constructed here and shared by GraphQL and `routes/ui.ts` —
  // never one per request. The Cloudflare driver latches its misconfiguration
  // warning per instance, so a per-request mailer would log that line on
  // every send (see `Context.mailer`'s doc comment).
  const mailer = createMailer(config.mail);
  const graphqlHandler = createGraphqlHandler({
    prisma,
    thumbnails: thumbnailQueue,
    replaceStaging,
    editionsRoot,
    config,
    mailer,
    jwtSecret,
    // Fail safe: hardening (no GraphiQL, masked errors, no introspection) is
    // the default and insecure mode must be opted into explicitly. Nothing in
    // the shipped image sets NODE_ENV — run.sh execs node directly and the
    // Dockerfile sets no env — so a `=== 'production'` test would leave every
    // real deployment running in dev mode. The server's `dev` npm script sets
    // NODE_ENV=development explicitly to keep GraphiQL locally.
    isProduction: process.env.NODE_ENV !== 'development',
  });

  const server = createServer({
    config,
    thumbnailQueue,
    jwtSecret,
    prisma,
    graphqlHandler,
    replaceStaging,
    mailer,
  });

  await startBookplate({ prisma, config, version, thumbnailQueue, server });
})().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
