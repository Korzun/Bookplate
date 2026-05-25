import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { loadConfig } from './config';
import { UserStore } from './services/user-store';
import { BookStore } from './services/book-store';
import { ThumbnailQueue } from './services/thumbnail-queue';
import { createServer } from './server';
import { logger } from './logger';
import packageJson from '../package.json';

const version: string = packageJson.version;

const log = logger('Server');
const config = loadConfig();

fs.mkdirSync(config.booksDir, { recursive: true });
fs.mkdirSync(config.dataDir, { recursive: true });

const db = new Database(path.join(config.dataDir, 'db.sqlite'));
const userStore = new UserStore(db);
const bookStore = new BookStore(config.booksDir, db);
const thumbnailQueue = new ThumbnailQueue(bookStore, config.thumbnailWidths);

const server = createServer(config, userStore, bookStore, thumbnailQueue);

// Startup scan: import untracked EPUBs, clean up stale DB entries
try {
  const scanResult = bookStore.scan();
  log.info(
    `Startup scan: ${scanResult.imported.length} imported, ${scanResult.removed.length} removed`
  );
} catch (err: unknown) {
  log.error(`Startup scan failed: ${err instanceof Error ? err.message : String(err)}`);
}

thumbnailQueue.start();

const shutdown = (): void => {
  log.info('Server shutting down');
  thumbnailQueue.stop();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(config.port, () => {
  log.info(
    `HASS-ODPS v${version} starting — port: ${config.port}, booksDir: ${config.booksDir}, dataDir: ${config.dataDir}`
  );
  log.info(`Web UI:  http://localhost:${config.port}/`);
  log.info(`OPDS:    http://localhost:${config.port}/opds/`);
  log.info(`KOSync:  http://localhost:${config.port}/kosync/`);
});
