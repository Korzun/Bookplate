import type { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import express, { NextFunction, Request, RequestHandler, Response } from 'express';

import { logger } from './logger';
import { graphqlBodyLimit } from './middleware/graphql-body-limit';
import { requestLog } from './middleware/request-log';
import { requestTimeout } from './middleware/timeout';
import { createKosyncRouter } from './routes/kosync';
import { createOpdsRouter } from './routes/opds';
import { createUiRouter } from './routes/ui';
import type { ReplaceStaging } from './services/replace-staging';
import { ThumbnailQueue } from './services/thumbnail-queue';
import { AppConfig } from './types';

const log = logger('Server');

export function createServer(
  config: AppConfig,
  thumbnailQueue: ThumbnailQueue,
  jwtSecret: Buffer,
  editionsRoot: string,
  prisma: PrismaClient,
  graphqlHandler: RequestHandler,
  replaceStaging: ReplaceStaging
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
  //
  // `graphqlBodyLimit` runs ahead of `graphqlHandler` for the same reason:
  // it reads only the `Content-Length` header (never the body), so it can
  // reject an oversized request before yoga's own body read — and so before
  // any resolver — without disturbing the raw-body contract above. 100kb
  // matches `express.json()`'s own default `limit` (body-parser's default,
  // applied below to every REST route); the largest legitimate GraphQL
  // operation is text-only (query + variables), never a file upload — those
  // go through REST's multer routes instead.
  server.use('/graphql', graphqlBodyLimit(100 * 1024), graphqlHandler);

  server.use(express.json());
  server.use(express.urlencoded({ extended: false }));
  server.use(cookieParser());

  server.use(
    '/opds',
    createOpdsRouter(
      config.booksDir,
      prisma,
      config.thumbnailWidths,
      config.libraryName,
      editionsRoot,
      config.validationThreshold
    )
  );
  server.use('/sync', createKosyncRouter(prisma));
  server.use(
    '/',
    createUiRouter(editionsRoot, config, thumbnailQueue, jwtSecret, prisma, replaceStaging)
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
