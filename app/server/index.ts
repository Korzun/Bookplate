import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from './config';
import { UserStore } from './services/user-store';
import { BookStore } from './services/book-store';
import { TokenStore } from './services/token-store';
import { ThumbnailQueue } from './services/thumbnail-queue';
import { createServer } from './server';
import { logger } from './logger';
import { runMigrations } from './db/migrate';
import { createPrismaClient } from './db/client';
import packageJson from '../../package.json';

const version: string = packageJson.version;

const log = logger('Server');
const config = loadConfig();

fs.mkdirSync(config.booksDir, { recursive: true });
fs.mkdirSync(config.dataDir, { recursive: true });

(async () => {
  const dbPath = path.join(config.dataDir, 'db.sqlite');
  const prisma = createPrismaClient(`file:${dbPath}`);
  await runMigrations(prisma, config.booksDir);

  const userStore = new UserStore(prisma);
  const bookStore = new BookStore(config.booksDir, prisma);
  const thumbnailQueue = new ThumbnailQueue(bookStore, config.thumbnailWidths);
  const tokenStore = new TokenStore(prisma);
  const jwtSecret = await tokenStore.getOrCreateJwtSecret();

  const server = createServer(config, userStore, bookStore, thumbnailQueue, tokenStore, jwtSecret);

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
      `HASS-ODPS v${version} starting — port: ${config.port}, booksDir: ${config.booksDir}, dataDir: ${config.dataDir}`
    );
    log.info(`Web UI:  http://localhost:${config.port}/`);
    log.info(`OPDS:    http://localhost:${config.port}/opds/`);
    log.info(`KOSync:  http://localhost:${config.port}/kosync/`);
  });
})().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
