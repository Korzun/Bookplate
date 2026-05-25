// app/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import { UserStore } from '../services/user-store';
import { logger } from '../logger';

const log = logger('Auth');

/**
 * HTTP Basic Auth for OPDS — validates against the KOSync UserStore.
 * OPDS clients send the password as plaintext (just Base64-encoded per RFC 7617),
 * so we hash it with MD5 before comparing against the stored key.
 */
export function opdsAuth(userStore: UserStore) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Basic ')) {
      log.warn('OPDS auth failed — missing or malformed Authorization header');
      res.set('WWW-Authenticate', 'Basic realm="HASS-ODPS"');
      res.status(401).send();
      return;
    }
    const decoded = Buffer.from(header.slice(6), 'base64').toString();
    const colonIndex = decoded.indexOf(':');
    const username = decoded.slice(0, colonIndex);
    const password = decoded.slice(colonIndex + 1);
    if (!userStore.authenticate(username, UserStore.hashPassword(password))) {
      log.warn(`OPDS auth failed for user "${username}"`);
      res.set('WWW-Authenticate', 'Basic realm="HASS-ODPS"');
      res.status(401).send();
      return;
    }
    next();
  };
}

/** KOSync header auth — validates x-auth-user + x-auth-key against UserStore. */
export function kosyncAuth(userStore: UserStore) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const username = req.headers['x-auth-user'];
    const key = req.headers['x-auth-key'];
    if (typeof username !== 'string' || typeof key !== 'string') {
      log.warn('KOSync auth failed — missing x-auth-user or x-auth-key headers');
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    if (!userStore.authenticate(username, key)) {
      log.warn(`KOSync auth failed for user "${username}"`);
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    req.kosyncUser = username;
    next();
  };
}

/** Session auth — redirects unauthenticated requests to /login. Used for web UI. */
export function sessionAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session.authenticated) {
    next();
  } else {
    log.debug('Session auth rejected — redirecting to /login');
    res.redirect('/login');
  }
}

/** Admin-only gate — must run after sessionAuth. Returns 403 for non-admin sessions. */
export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.isAdmin) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}
