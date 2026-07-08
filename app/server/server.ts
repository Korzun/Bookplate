import express, { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { AppConfig } from './types';
import { BookStore } from './services/book-store';
import { UserStore } from './services/user-store';
import { TokenStore } from './services/token-store';
import { ThumbnailQueue } from './services/thumbnail-queue';
import { DeviceStore } from './services/device-store';
import { EditionStore } from './services/edition-store';
import { jwtAuth } from './middleware/auth';
import { createOpdsRouter } from './routes/opds';
import { createKosyncRouter } from './routes/kosync';
import { createUsersRouter } from './routes/users';
import { createDevicesRouter } from './routes/devices';
import { createUiRouter } from './routes/ui';
import { requestTimeout } from './middleware/timeout';
import { requestLog } from './middleware/request-log';
import { ScanJobStore } from './services/scan-job-store';
import { logger } from './logger';

const log = logger('Server');

export function createServer(
  config: AppConfig,
  userStore: UserStore,
  bookStore: BookStore,
  thumbnailQueue: ThumbnailQueue,
  tokenStore: TokenStore,
  jwtSecret: Buffer,
  deviceStore: DeviceStore,
  editionStore: EditionStore
): express.Express {
  const server = express();

  // Respond with a clean 503 before Cloudflare's ~100s proxy timeout (524).
  server.use(requestTimeout(90_000));

  // Log method/path/status/duration for every request as it finishes.
  server.use(requestLog());

  server.use(express.json());
  server.use(express.urlencoded({ extended: false }));
  server.use(cookieParser());

  server.use(
    '/opds',
    createOpdsRouter(
      bookStore,
      userStore,
      config.thumbnailWidths,
      config.libraryName,
      deviceStore,
      editionStore,
      config.validationThreshold
    )
  );
  server.use('/sync', createKosyncRouter(userStore, bookStore));
  server.use(
    '/api/users',
    createUsersRouter(userStore, config.username, jwtAuth(jwtSecret), tokenStore, config.booksDir)
  );
  server.use('/api/devices', createDevicesRouter(deviceStore, editionStore, jwtAuth(jwtSecret)));
  const scanJobStore = new ScanJobStore();
  server.use(
    '/',
    createUiRouter(
      bookStore,
      userStore,
      config,
      thumbnailQueue,
      tokenStore,
      jwtSecret,
      scanJobStore
    )
  );

  server.use((err: unknown, _req: Request, res: Response, next: NextFunction): void => {
    if (err instanceof SyntaxError && 'body' in err) {
      log.warn(
        'Malformed request body — possible Cloudflare error page received as request (rejecting with 400)'
      );
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }
    if (res.headersSent) {
      next(err);
      return;
    }
    log.error(
      `Unhandled route error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
    );
    res.status(500).json({ error: 'Internal server error' });
  });

  return server;
}
