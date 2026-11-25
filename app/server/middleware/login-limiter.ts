import type { Response } from 'express';

import { logger } from '../logger';

const log = logger('LoginLimiter');

const SWEEP_THRESHOLD = 256;

export type LoginAttempt = {
  /** Credential accepted: clears this key's failures and any lock. */
  succeeded(): void;
  /** Not a credential failure after all (e.g. 403 password-not-set, busy): removes this one provisional failure; undoes a lock it alone started. */
  cancelled(): void;
};

export type LoginLimiter = {
  /** ms until the lock lifts, or null when not locked. Expired locks are cleared here. */
  lockedForMs(key: string): number | null;
  /** Records a provisional failure now. If that reaches maxFailures, starts the lock and logs one warn naming `who`. */
  begin(key: string, who: string): LoginAttempt;
  size(): number;
};

type Entry = { failures: number[]; lockedUntil: number | null };

export function createLoginLimiter(options: {
  now?: () => number;
  maxFailures: number;
  windowMs: number;
  lockMs: number;
  label: string;
}): LoginLimiter {
  const { maxFailures, windowMs, lockMs, label } = options;
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();

  function prune(entry: Entry, at: number): void {
    entry.failures = entry.failures.filter((ts) => ts > at - windowMs);
  }

  function isLive(entry: Entry, at: number): boolean {
    return entry.failures.length > 0 || (entry.lockedUntil !== null && entry.lockedUntil > at);
  }

  function sweep(at: number): void {
    for (const [key, entry] of entries) {
      prune(entry, at);
      if (!isLive(entry, at)) entries.delete(key);
    }
  }

  return {
    lockedForMs(key) {
      const entry = entries.get(key);
      if (!entry || entry.lockedUntil === null) return null;
      const at = now();
      if (entry.lockedUntil > at) return entry.lockedUntil - at;
      entries.delete(key);
      return null;
    },

    begin(key, who) {
      const at = now();
      if (entries.size > SWEEP_THRESHOLD) sweep(at);
      let entry = entries.get(key);
      if (entry?.lockedUntil != null && entry.lockedUntil <= at) {
        entries.delete(key);
        entry = undefined;
      }
      if (!entry) {
        entry = { failures: [], lockedUntil: null };
        entries.set(key, entry);
      }
      prune(entry, at);
      entry.failures.push(at);
      if (entry.lockedUntil === null && entry.failures.length >= maxFailures) {
        entry.lockedUntil = at + lockMs;
        log.warn(
          `${label} lockout: ${who} locked for ${lockMs / 60_000} min after ${maxFailures} failures`
        );
      }
      // The first of succeeded()/cancelled() wins; later calls are no-ops.
      let settled = false;
      return {
        succeeded() {
          if (settled) return;
          settled = true;
          entries.delete(key);
        },
        cancelled() {
          if (settled) return;
          settled = true;
          const current = entries.get(key);
          if (!current) return;
          const i = current.failures.indexOf(at);
          if (i !== -1) current.failures.splice(i, 1);
          prune(current, now());
          if (current.failures.length < maxFailures) current.lockedUntil = null;
          if (!isLive(current, now())) entries.delete(key);
        },
      };
    },

    size: () => entries.size,
  };
}

export const WEB_LOCKOUT = { maxFailures: 5, windowMs: 900_000, lockMs: 900_000 } as const;
export const SYNC_LOCKOUT = { maxFailures: 10, windowMs: 900_000, lockMs: 900_000 } as const;

export function sendLocked(res: Response, retryAfterMs: number): void {
  const minutes = Math.ceil(retryAfterMs / 60_000);
  res
    .status(429)
    .set('Retry-After', String(Math.ceil(retryAfterMs / 1000)))
    .json({ error: `Too many attempts. Try again in ${minutes} min.` });
}

export function sendBusy(res: Response, who: string, label: string): void {
  log.warn(`${label} busy: ${who} refused, all password check slots in use`);
  res.status(429).set('Retry-After', '60').json({ error: 'Server busy. Try again in a minute.' });
}
