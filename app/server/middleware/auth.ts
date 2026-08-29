// app/middleware/auth.ts
import type { PrismaClient } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';

import { logger } from '../logger';
import { verifyAccessToken, AuthUser } from '../services/jwt';
import { authenticate, hashSyncPassword } from '../services/password';

export type { AuthUser };

const log = logger('Auth');

/**
 * HTTP Basic Auth for OPDS — validates against the KOSync credentials.
 * OPDS clients send the password as plaintext (just Base64-encoded per RFC 7617),
 * so we hash it with MD5 before comparing against the stored key.
 */
export function opdsAuth(prisma: PrismaClient, realm: string = 'Bookplate') {
  const safeRealm = realm.replace(/[\r\n"\\]/g, '');
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const header = req.headers.authorization;
      if (!header?.startsWith('Basic ')) {
        log.warn('OPDS auth failed — missing or malformed Authorization header');
        res.set('WWW-Authenticate', `Basic realm="${safeRealm}"`);
        res.status(401).send();
        return;
      }
      const decoded = Buffer.from(header.slice(6), 'base64').toString();
      const colonIndex = decoded.indexOf(':');
      const username = decoded.slice(0, colonIndex);
      const password = decoded.slice(colonIndex + 1);
      const userId = await authenticate(prisma, username, hashSyncPassword(password));
      if (!userId) {
        log.warn(`OPDS auth failed for user "${username}"`);
        res.set('WWW-Authenticate', `Basic realm="${safeRealm}"`);
        res.status(401).send();
        return;
      }
      req.opdsOwner = { userId, username };
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** KOSync header auth — validates x-auth-user + x-auth-key against stored credentials. */
export function kosyncAuth(prisma: PrismaClient) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const username = req.headers['x-auth-user'];
      const key = req.headers['x-auth-key'];
      if (typeof username !== 'string' || typeof key !== 'string') {
        log.warn('KOSync auth failed — missing x-auth-user or x-auth-key headers');
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }
      const userId = await authenticate(prisma, username, key);
      if (!userId) {
        log.warn(`KOSync auth failed for user "${username}"`);
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }
      req.kosyncUser = username;
      req.kosyncUserId = userId;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Bearer-JWT auth for the web UI/API. Attaches req.user on success. */
export function jwtAuth(secret: Buffer) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const user = verifyAccessToken(secret, header.slice(7));
    if (!user) {
      log.debug('JWT auth rejected — invalid or expired token');
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    req.user = user;
    next();
  };
}

/**
 * Blocks API access while a password change is pending. Runs before
 * route-level jwtAuth, so it verifies the token itself; requests without a
 * valid token pass through for jwtAuth to reject.
 */
export function passwordChangeGate(secret: Buffer) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (
      !req.path.startsWith('/api/') ||
      req.path === '/api/login' ||
      req.path.startsWith('/api/auth/')
    ) {
      next();
      return;
    }
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      next();
      return;
    }
    const user = verifyAccessToken(secret, header.slice(7));
    if (user?.mustChangePassword) {
      res.status(403).json({ error: 'Password change required' });
      return;
    }
    next();
  };
}
