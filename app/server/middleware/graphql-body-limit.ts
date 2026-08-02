import { NextFunction, Request, Response } from 'express';

import { logger } from '../logger';

// A distinct namespace from yoga.ts's own `logger('GraphQL')` (its internal
// diagnostic bridge) — same reasoning yoga-plugins.ts gives for
// `'GraphQL:operations'`: a rejection line here must be distinguishable
// from a yoga-internal line by grep, not just by luck.
const log = logger('GraphQL:bodyLimit');

/**
 * Rejects an oversized (or unboundable) `/graphql` request body before
 * yoga — and so before any resolver — ever sees it.
 *
 * Mounted ahead of `graphqlHandler` on the SAME `/graphql` path in
 * server.ts. It must never read the body itself: yoga reads the raw request
 * stream directly (server.ts's own comment on why `/graphql` is mounted
 * ahead of `express.json()` — a parser that consumed the stream first would
 * leave yoga nothing to read), so this checks only headers, never
 * `req.body`.
 *
 * TWO checks, not one (task-3 review, C-3 — the single-check version this
 * replaced was a real, proven bypass):
 *
 * 1. A POST with NO `Content-Length` header gets `411 Length Required`,
 *    full stop. Node's HTTP layer decodes `Transfer-Encoding: chunked`
 *    transparently regardless of anything this middleware does — a missing
 *    `Content-Length` is NOT "no body", it is "a body of unknown size",
 *    and yoga will read every byte of it into memory before this
 *    middleware's sibling check ever gets a number to compare. The review
 *    measured a 50MB unauthenticated chunked POST sail through the old
 *    length-check-only version at HTTP 200, +126.7MB heap, fully executed.
 *    Every legitimate caller (the SPA's fetch, Apollo, curl, supertest)
 *    sends `Content-Length` on a POST body; nothing in this app streams an
 *    upload into `/graphql`. GET (GraphiQL's own page load — see
 *    `yoga.test.ts`'s "serves GraphiQL" test) never carries a body and is
 *    unaffected; this check is POST-only.
 * 2. A POST WITH `Content-Length` over `maxBytes` gets `413`, same as
 *    before — this arm is unchanged and was already correct (Node's HTTP
 *    parser ends the message at the declared length regardless of how much
 *    the client actually sends, so a request cannot lie its way past this
 *    by UNDER-declaring length either — verified in this file's own test).
 */
export function graphqlBodyLimit(maxBytes: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers['content-length'];
    if (header === undefined) {
      if (req.method === 'POST') {
        log.warn(
          `Rejecting POST ${req.originalUrl}: no Content-Length header (chunked or otherwise unbounded body)`
        );
        res.status(411).json({ error: 'Content-Length required' });
        return;
      }
      next();
      return;
    }
    const length = Number(header);
    if (Number.isFinite(length) && length > maxBytes) {
      log.warn(
        `Rejecting POST ${req.originalUrl}: body ${length} bytes exceeds the ${maxBytes}-byte limit`
      );
      res.status(413).json({ error: 'Request body too large' });
      return;
    }
    next();
  };
}
