/**
 * The one place an address is turned into the key everything else matches on.
 *
 * `email` keeps what the user typed (it is what appears in a From/To line and on
 * their settings page); `emailKey` is the normalized form and is what every
 * lookup and the unique constraint use. Both are written together here so they
 * can never disagree — a row with a key that does not match its address would be
 * invisible to login while still occupying the address.
 */
import { PrismaClient } from '@prisma/client';

import { isPrismaError } from './prisma-errors';

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Deliberately conservative and deliberately not RFC 5322: one `@`, no spaces, a
 * dot-bearing domain, and a length bound. This is a typo filter, not an
 * authority on address syntax — Cloudflare's own bounce handling is what
 * ultimately decides whether an address exists, and a `bad_address` send result
 * reports that back. The length cap keeps an absurd value out of the database
 * and out of a log line.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const MAX_EMAIL_LENGTH = 254;

export function isValidEmail(value: string): boolean {
  const normalized = normalizeEmail(value);
  return normalized.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(normalized);
}

export type EmailAccount = {
  id: string;
  username: string;
  email: string | null;
  emailVerifiedAt: number | null;
  isConfigAdmin: boolean;
};

export type SetEmailResult = { ok: true } | { ok: false; reason: 'invalid' | 'in_use' };

/**
 * Always clears `emailVerifiedAt`: a verified flag that outlived the address it
 * described would let a user redirect their notifications and their reset mail
 * to an unconfirmed inbox.
 *
 * `P2002` (the `emailKey` unique constraint) comes back as an outcome rather
 * than an exception, the same convention `createUser` uses for a duplicate
 * username — a second account wanting the same address is an ordinary thing for
 * a caller to render, not a fault.
 */
export async function setUserEmail(
  prisma: PrismaClient,
  userId: string,
  raw: string
): Promise<SetEmailResult> {
  if (!isValidEmail(raw)) return { ok: false, reason: 'invalid' };
  const email = raw.trim();
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { email, emailKey: normalizeEmail(email), emailVerifiedAt: null },
    });
    return { ok: true };
  } catch (e) {
    if (isPrismaError(e, 'P2002')) return { ok: false, reason: 'in_use' };
    throw e;
  }
}

/**
 * Returns `null` for anything that is not a plausible address INSTEAD of
 * querying: the only callers are login and forgot-password, both reachable
 * unauthenticated, and there is no reason to spend a query on a value that
 * cannot be stored in the first place.
 */
export async function findUserByEmail(
  prisma: PrismaClient,
  raw: string
): Promise<EmailAccount | null> {
  if (!isValidEmail(raw)) return null;
  return prisma.user.findUnique({
    where: { emailKey: normalizeEmail(raw) },
    select: { id: true, username: true, email: true, emailVerifiedAt: true, isConfigAdmin: true },
  });
}

export async function markEmailVerified(
  prisma: PrismaClient,
  userId: string,
  now: number = Date.now()
): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: now } });
}
