import { NextFunction, Request, Response } from 'express';

import { logger } from '../logger';

const log = logger('GraphQL');

/**
 * Rejects an oversized `/graphql` request body before yoga — and so before
 * any resolver — ever sees it.
 *
 * Mounted ahead of `graphqlHandler` on the SAME `/graphql` path in
 * server.ts. It must never read the body itself: yoga reads the raw request
 * stream directly (server.ts's own comment on why `/graphql` is mounted
 * ahead of `express.json()` — a parser that consumed the stream first would
 * leave yoga nothing to read), so this checks only the `Content-Length`
 * header, never `req.body`. A request with no `Content-Length` header, or
 * one at or under the limit, passes through unchanged.
 */
export function graphqlBodyLimit(maxBytes: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers['content-length'];
    const length = header === undefined ? undefined : Number(header);
    if (length !== undefined && Number.isFinite(length) && length > maxBytes) {
      log.warn(
        `Rejecting POST ${req.originalUrl}: body ${length} bytes exceeds the ${maxBytes}-byte limit`
      );
      res.status(413).json({ error: 'Request body too large' });
      return;
    }
    next();
  };
}
