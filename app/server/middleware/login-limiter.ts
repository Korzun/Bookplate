import type { Response } from 'express';

import { logger } from '../logger';
import { isPrivateAddress } from '../utils/client-ip';

const log = logger('LoginLimiter');

const SWEEP_INTERVAL_MS = 1_000;

/** Default cap on entries per limiter; live locks may push past it, nothing else does. */
export const LIMITER_MAX_ENTRIES = 10_000;

export type LoginAttempt = {
  /** Credential accepted: clears this key's failures and any lock. */
  succeeded(): void;
  /** Not a credential failure after all (e.g. 403 password-not-set, busy): removes this one provisional failure; undoes a lock it alone started. */
  cancelled(): void;
};

export type LoginLimiter = {
  /** ms until the lock lifts, or null when not locked. Expired locks are cleared here. */
  lockedForMs(key: string): number | null;
  /**
   * Records a provisional failure now. If that reaches maxFailures, starts the
   * lock and logs one warn naming `who`, with `hint` appended when given.
   */
  begin(key: string, who: string, hint?: string): LoginAttempt;
  size(): number;
};

type Entry = { failures: number[]; lockedUntil: number | null };

export function createLoginLimiter(options: {
  now?: () => number;
  maxFailures: number;
  windowMs: number;
  lockMs: number;
  label: string;
  maxEntries?: number;
}): LoginLimiter {
  const { maxFailures, windowMs, lockMs, label } = options;
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? LIMITER_MAX_ENTRIES;
  // Evicting a tenth of the cap at once keeps a flood of new keys from paying
  // a full sweep on every insert.
  const lowWater = maxEntries - Math.max(1, Math.floor(maxEntries / 10));
  const entries = new Map<string, Entry>();
  let lastSweep = -Infinity;

  function prune(entry: Entry, at: number): void {
    entry.failures = entry.failures.filter((ts) => ts > at - windowMs);
  }

  function isLive(entry: Entry, at: number): boolean {
    return entry.failures.length > 0 || (entry.lockedUntil !== null && entry.lockedUntil > at);
  }

  function sweep(at: number): void {
    lastSweep = at;
    for (const [key, entry] of entries) {
      prune(entry, at);
      if (!isLive(entry, at)) entries.delete(key);
    }
  }

  /** Makes room for one new key. Oldest first (Map order); a live lock is never evicted. */
  function makeRoom(at: number): void {
    sweep(at);
    if (entries.size < maxEntries) return;
    for (const [key, entry] of entries) {
      if (entries.size <= lowWater) break;
      if (entry.lockedUntil === null || entry.lockedUntil <= at) entries.delete(key);
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

    begin(key, who, hint) {
      const at = now();
      if (at - lastSweep >= SWEEP_INTERVAL_MS) sweep(at);
      let entry = entries.get(key);
      if (entry?.lockedUntil != null && entry.lockedUntil <= at) {
        entries.delete(key);
        entry = undefined;
      }
      if (!entry) {
        if (entries.size >= maxEntries) makeRoom(at);
        entry = { failures: [], lockedUntil: null };
        entries.set(key, entry);
      }
      prune(entry, at);
      entry.failures.push(at);
      if (entry.lockedUntil === null && entry.failures.length >= maxFailures) {
        entry.lockedUntil = at + lockMs;
        log.warn(
          `${label} lockout: ${who} locked for ${lockMs / 60_000} min after ${maxFailures} failures${hint ?? ''}`
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
/** Per client address across every sync username, so random usernames cannot dodge the lockout. */
export const SYNC_IP_LOCKOUT = { maxFailures: 50, windowMs: 900_000, lockMs: 900_000 } as const;

/**
 * `begin` hint for a lock keyed on a loopback or private address: behind a
 * proxy with `TRUST_PROXY_HOPS` too low, every client resolves to it.
 */
export function addressHint(ip: string): string | undefined {
  return isPrivateAddress(ip)
    ? ' — every client may share this address; check TRUST_PROXY_HOPS'
    : undefined;
}

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
