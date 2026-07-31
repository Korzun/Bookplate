import cookieParser from 'cookie-parser';
import express, { NextFunction, Request, RequestHandler, Response } from 'express';

import { logger } from './logger';
import { jwtAuth } from './middleware/auth';
import { requestLog } from './middleware/request-log';
import { requestTimeout } from './middleware/timeout';
import { createDevicesRouter } from './routes/devices';
import { createKosyncRouter } from './routes/kosync';
import { createOpdsRouter } from './routes/opds';
import { createUiRouter } from './routes/ui';
import { createUsersRouter } from './routes/users';
import { BookStore } from './services/book-store';
import { DeviceStore } from './services/device-store';
import { EditionStore } from './services/edition-store';
import type { ScanJobStore } from './services/scan-job-store';
import { ThumbnailQueue } from './services/thumbnail-queue';
import { TokenStore } from './services/token-store';
import { UserStore } from './services/user-store';
import { ValidationStore } from './services/validation-store';
import { AppConfig } from './types';

const log = logger('Server');

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
  const server = express();

  // Respond with a clean 503 before Cloudflare's ~100s proxy timeout (524).
  server.use(requestTimeout(90_000));

  // Log method/path/status/duration for every request as it finishes.
  server.use(requestLog());

  // Mounted ahead of express.json(): yoga reads the raw request body itself,
  // and a body already consumed by a parser upstream would leave it with
  // nothing to read. requestTimeout and requestLog still apply — they run
  // before this and do not touch the body. requestTimeout's 503 cannot fire on
  // a subscription stream, because it bails out once headers are sent and SSE
  // sends them immediately.
  server.use('/graphql', graphqlHandler);

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
  server.use(
    '/api/devices',
    createDevicesRouter(deviceStore, editionStore, userStore, jwtAuth(jwtSecret))
  );
  server.use(
    '/',
    createUiRouter(
      bookStore,
      userStore,
      config,
      thumbnailQueue,
      tokenStore,
      jwtSecret,
      scanJobStore,
      validationStore
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
