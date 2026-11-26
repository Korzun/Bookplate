// app/middleware/auth.ts
import { createHash } from 'crypto';

import type { PrismaClient } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';

import { logger } from '../logger';
import { verifyAccessToken, AuthUser } from '../services/jwt';
import { authenticate, hashSyncPassword } from '../services/password';
import { resolveLoginClientIp } from '../utils/client-ip';
import { addressHint, sendLocked, type LoginLimiter } from './login-limiter';

export type { AuthUser };

const log = logger('Auth');

export type SyncAuthDeps = {
  /** Per client address AND username, so one stale device cannot lock another user behind it. */
  syncLimiter: LoginLimiter;
  /** Per client address alone, so a stream of made-up usernames is still capped. */
  syncIpLimiter: LoginLimiter;
  trustProxyHops: number;
};

/** A username for a log line: capped, and JSON-quoted so a CR/LF cannot forge a line. */
function logName(username: string): string {
  return JSON.stringify(username.slice(0, 64));
}

/**
 * Runs a sync credential check under both lockouts. Resolves to the check's
 * result, or null when a lock refused the request (the 429 is already sent).
 * A refusal by the user bucket is not counted against the address.
 */
async function checkSyncCredential(
  req: Request,
  res: Response,
  deps: SyncAuthDeps,
  username: string,
  check: () => Promise<string | false>
): Promise<string | false | null> {
  const ip = resolveLoginClientIp(req, deps.trustProxyHops);
  const ipLockedMs = deps.syncIpLimiter.lockedForMs(ip);
  if (ipLockedMs !== null) {
    sendLocked(res, ipLockedMs);
    return null;
  }
  // Hashed so a huge username cannot bloat the key.
  const key = `${ip}\u0000${createHash('sha256').update(username).digest('hex')}`;
  const userLockedMs = deps.syncLimiter.lockedForMs(key);
  if (userLockedMs !== null) {
    sendLocked(res, userLockedMs);
    return null;
  }
  const hint = addressHint(ip);
  const attempts = [
    deps.syncIpLimiter.begin(ip, ip, hint),
    deps.syncLimiter.begin(key, `${ip} user ${logName(username)}`, hint),
  ];
  let userId: string | false;
  try {
    userId = await check();
  } catch (err) {
    for (const attempt of attempts) attempt.cancelled();
    throw err;
  }
  if (userId) for (const attempt of attempts) attempt.succeeded();
  return userId;
}

/**
 * HTTP Basic Auth for OPDS — validates against the KOSync credentials.
 * OPDS clients send the password as plaintext (just Base64-encoded per RFC 7617),
 * so we hash it with MD5 before comparing against the stored key.
 */
export function opdsAuth(prisma: PrismaClient, realm: string, deps: SyncAuthDeps) {
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
      const userId = await checkSyncCredential(req, res, deps, username, () =>
        authenticate(prisma, username, hashSyncPassword(password))
      );
      if (userId === null) return;
      if (!userId) {
        log.warn(`OPDS auth failed for user ${logName(username)}`);
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
export function kosyncAuth(prisma: PrismaClient, deps: SyncAuthDeps) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const username = req.headers['x-auth-user'];
      const key = req.headers['x-auth-key'];
      if (typeof username !== 'string' || typeof key !== 'string') {
        log.warn('KOSync auth failed — missing x-auth-user or x-auth-key headers');
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }
      const userId = await checkSyncCredential(req, res, deps, username, () =>
        authenticate(prisma, username, key)
      );
      if (userId === null) return;
      if (!userId) {
        log.warn(`KOSync auth failed for user ${logName(username)}`);
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
      req.path.startsWith('/api/auth/') ||
      // The unauthenticated reset flow — a viewer with a pending forced change
      // may legitimately be resetting their password by email.
      req.path.startsWith('/api/password/')
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

/**
 * Blocks API access while an address is outstanding. A SIBLING of
 * `passwordChangeGate`, not a branch inside it: each gate answers one question,
 * and mounting them in order (password first) makes the precedence explicit
 * rather than an `if`/`else` reading.
 *
 * Same shape as its sibling for the same reasons — it runs before route-level
 * `jwtAuth`, so it verifies the token itself and lets a request WITHOUT a valid
 * one pass through for `jwtAuth` to reject. `/api/password/*` is exempt
 * alongside login and refresh: those routes are the unauthenticated reset flow
 * and must stay reachable regardless of any token a caller happens to present.
 */
export function emailSetupGate(secret: Buffer) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (
      !req.path.startsWith('/api/') ||
      req.path === '/api/login' ||
      req.path.startsWith('/api/auth/') ||
      req.path.startsWith('/api/password/')
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
    if (user?.mustSetEmail) {
      res.status(403).json({ error: 'Email required' });
      return;
    }
    next();
  };
}
