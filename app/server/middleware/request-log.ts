import { Request, Response, NextFunction } from 'express';

import { logger } from '../logger';

const log = logger('Request');

/**
 * Logs every request once its response finishes: method, path, status, and
 * duration. Diagnostic visibility into which requests arrive and how they
 * resolve — a 4xx/5xx that a handler returns without logging is otherwise
 * invisible server-side.
 *
 * To keep the default output focused, successful reads (2xx GET/HEAD) log at
 * debug; everything else (mutations, and any non-2xx) logs at info.
 */
export function requestLog() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      const line = `${req.method} ${req.originalUrl} → ${res.statusCode} (${ms}ms)`;
      const isRead = req.method === 'GET' || req.method === 'HEAD';
      if (res.statusCode < 400 && isRead) {
        log.debug(line);
      } else {
        log.info(line);
      }
    });
    next();
  };
}
