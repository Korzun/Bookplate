import { Request, Response, NextFunction } from 'express';

import { logger } from '../logger';

const log = logger('Timeout');

/**
 * Sends 503 if a response has not been sent within `ms`. Guards against
 * Cloudflare's ~100s proxy timeout (error 524): we respond first with a clean
 * error the client can handle. The timer is cleared once the response finishes
 * or the connection closes, and the 503 is suppressed if headers were already
 * sent (the handler won the race).
 */
export function requestTimeout(ms: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const timer = setTimeout(() => {
      if (res.headersSent) return;
      log.warn(`Request exceeded ${ms}ms — responding 503: ${req.method} ${req.path}`);
      res.status(503).json({ error: 'Request timed out' });
    }, ms);
    const clear = (): void => clearTimeout(timer);
    res.on('finish', clear);
    res.on('close', clear);
    next();
  };
}
