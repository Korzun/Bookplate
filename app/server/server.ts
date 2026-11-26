import * as path from 'path';

import type { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import express, { NextFunction, Request, RequestHandler, Response, Router } from 'express';

import { logger } from './logger';
import { graphqlBodyLimit } from './middleware/graphql-body-limit';
import { createLoginLimiter, SYNC_IP_LOCKOUT, SYNC_LOCKOUT } from './middleware/login-limiter';
import { requestLog } from './middleware/request-log';
import { securityHeaders } from './middleware/security-headers';
import { requestTimeout } from './middleware/timeout';
import { createKosyncRouter } from './routes/kosync';
import { createOpdsRouter } from './routes/opds';
import { createUiRouter } from './routes/ui';
import type { Mailer } from './services/mailer';
import type { ReplaceStaging } from './services/replace-staging';
import { ThumbnailQueue } from './services/thumbnail-queue';
import { AppConfig } from './types';

const log = logger('Server');

/**
 * Fail safe: hardening is the default and dev mode must be opted into. Nothing
 * in the shipped image sets NODE_ENV, so `=== 'production'` would leave every
 * real deployment in dev mode; the `dev` npm script sets it to `development`.
 */
export const isProductionEnv = (): boolean => process.env.NODE_ENV !== 'development';

export type CreateServerDeps = {
  config: AppConfig;
  thumbnailQueue: ThumbnailQueue;
  jwtSecret: Buffer;
  prisma: PrismaClient;
  graphqlHandler: RequestHandler;
  replaceStaging: ReplaceStaging;
  mailer: Mailer | null;
  /**
   * `createMcpRouter`'s router, or null when `public_url` does not allow MCP
   * (`mcp/base-url.ts`). Mounted ahead of `express.json()` below because
   * `POST /mcp` carries its own, larger body limit — see `mcp/index.ts`.
   */
  mcpRouter: Router | null;
};

export function createServer({
  config,
  thumbnailQueue,
  jwtSecret,
  prisma,
  graphqlHandler,
  replaceStaging,
  mailer,
  mcpRouter,
}: CreateServerDeps): express.Express {
  // `path.join(config.dataDir, 'editions')` — see `index.ts`'s identical
  // wiring and `graphql/context.ts`'s `Context.editionsRoot` doc comment.
  // Always this value in production; there is no second caller (no
  // `server.test.ts` exists) that could need a different one, so it is
  // derived here rather than threaded through as its own parameter.
  const editionsRoot = path.join(config.dataDir, 'editions');

  const server = express();
  server.disable('x-powered-by');

  // First, so every response (including early 503s and errors) carries them.
  server.use(securityHeaders({ isProduction: isProductionEnv() }));

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

  // Before the global parser for the reason `CreateServerDeps.mcpRouter`
  // gives; the OAuth endpoints it carries parse form bodies themselves.
  if (mcpRouter !== null) server.use(mcpRouter);

  server.use(express.json());
  server.use(express.urlencoded({ extended: false }));
  server.use(cookieParser());

  // Shared by OPDS and KOSync: a sync password guessed across both surfaces
  // counts against the same lockouts.
  const syncLimiter = createLoginLimiter({ ...SYNC_LOCKOUT, label: 'Sync' });
  const syncIpLimiter = createLoginLimiter({ ...SYNC_IP_LOCKOUT, label: 'Sync IP' });
  const trustProxyHops = config.trustProxyHops ?? 0;

  server.use(
    '/opds',
    createOpdsRouter({
      booksRoot: config.booksDir,
      prisma,
      thumbnailWidths: config.thumbnailWidths,
      libraryName: config.libraryName,
      editionsRoot,
      validationThreshold: config.validationThreshold,
      syncLimiter,
      syncIpLimiter,
      trustProxyHops,
    })
  );
  server.use('/sync', createKosyncRouter(prisma, { syncLimiter, syncIpLimiter, trustProxyHops }));
  server.use(
    '/',
    createUiRouter({
      editionsRoot,
      config,
      thumbnailQueue,
      jwtSecret,
      prisma,
      replaceStaging,
      mailer,
    })
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
