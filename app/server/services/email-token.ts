/**
 * Single-use codes for confirming an address and for resetting a password.
 *
 * Only the sha256 of a code is ever persisted — the same rule
 * `services/token.ts` applies to refresh tokens, for the same reason: a
 * database read must not yield a usable credential.
 *
 * There is at most ONE token per (user, purpose), which is the primary key. No
 * consumption path needs to look a token up BY its hash — confirming is
 * authenticated, and resetting submits the address — so a guessed code is
 * useless unless the guesser also names the right account. It also makes
 * "resend" an upsert that invalidates the code it replaces, instead of leaving a
 * trail of simultaneously-valid ones.
 *
 * `now` is injected on every function (defaulting to `Date.now`) so expiry,
 * cooldown and window-rollover tests need no fake timers — the same shape
 * `createLoginRateLimit` and `ReplaceStagingDeps.now` use.
 */
import * as crypto from 'crypto';

import { PrismaClient } from '@prisma/client';

export type EmailTokenPurpose = 'verify' | 'reset';

/**
 * 24h for a new address: the user may not be at their inbox, and the cost of a
 * long window is low because the token grants nothing except confirming an
 * address they already control. 1h for a reset, which DOES grant account access
 * and is always acted on immediately.
 */
export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;

export const RESEND_COOLDOWN_MS = 60 * 1000;
/**
 * A ROLLING WINDOW, not a per-token-lifetime cap. A lifetime cap would strand a
 * user whose first five messages went to spam for the token's whole 24-hour TTL;
 * an hour-long window bounds abuse just as tightly and always recovers on its
 * own.
 */
export const SEND_WINDOW_MS = 60 * 60 * 1000;
export const MAX_SENDS_PER_WINDOW = 5;

/**
 * Crockford base32 minus the letters that are misread when a human retypes a
 * code from their phone: I and L (look like 1), O (looks like 0), U (looks like
 * V). 8 characters over 32 symbols is exactly 40 bits, which is far past
 * guessable given a code is bound to one account, expires, and sits behind an
 * IP limiter.
 */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;

export function generateEmailCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Normalizes before hashing, so a user who types lowercase or pastes with
 * surrounding whitespace still matches. Normalizing here rather than at each
 * call site means the transformation cannot drift between issue and consume.
 */
export function hashEmailCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

function ttlFor(purpose: EmailTokenPurpose): number {
  return purpose === 'verify' ? VERIFY_TTL_MS : RESET_TTL_MS;
}

export type IssueResult =
  | { ok: true; code: string }
  | { ok: false; reason: 'cooldown' | 'send_cap'; retryAfterMs: number };

export async function issueEmailToken(
  prisma: PrismaClient,
  args: { userId: string; purpose: EmailTokenPurpose; email: string; now?: number }
): Promise<IssueResult> {
  const now = args.now ?? Date.now();
  const key = { userId_purpose: { userId: args.userId, purpose: args.purpose } };
  const existing = await prisma.emailToken.findUnique({ where: key });

  // Window start is the row's `createdAt`, which is preserved across resends and
  // reset when the window rolls over — so `sendCount` always counts sends since
  // `createdAt`, and the two fields cannot disagree.
  const windowOpen = existing !== null && now - existing.createdAt < SEND_WINDOW_MS;

  if (existing !== null) {
    const sinceLastSend = now - existing.sentAt;
    if (sinceLastSend < RESEND_COOLDOWN_MS) {
      return {
        ok: false,
        reason: 'cooldown',
        retryAfterMs: RESEND_COOLDOWN_MS - sinceLastSend,
      };
    }
    if (windowOpen && existing.sendCount >= MAX_SENDS_PER_WINDOW) {
      return {
        ok: false,
        reason: 'send_cap',
        retryAfterMs: existing.createdAt + SEND_WINDOW_MS - now,
      };
    }
  }

  const code = generateEmailCode();
  const data = {
    tokenHash: hashEmailCode(code),
    email: args.email,
    expiresAt: now + ttlFor(args.purpose),
    sentAt: now,
  };
  await prisma.emailToken.upsert({
    where: key,
    create: {
      userId: args.userId,
      purpose: args.purpose,
      createdAt: now,
      sendCount: 1,
      ...data,
    },
    update: windowOpen
      ? { ...data, sendCount: { increment: 1 } }
      : { ...data, createdAt: now, sendCount: 1 },
  });
  return { ok: true, code };
}

/**
 * Validates and deletes in one step. A WRONG code is rejected without touching
 * the stored row — otherwise a stranger who knew an account's address could
 * destroy its outstanding token at will; brute force is bounded by the IP
 * limiter on the routes instead.
 */
export async function consumeEmailToken(
  prisma: PrismaClient,
  args: { userId: string; purpose: EmailTokenPurpose; code: string; now?: number }
): Promise<{ email: string } | null> {
  const now = args.now ?? Date.now();
  const row = await prisma.emailToken.findUnique({
    where: { userId_purpose: { userId: args.userId, purpose: args.purpose } },
  });
  if (row === null) return null;
  if (row.expiresAt <= now) {
    await prisma.emailToken.deleteMany({
      where: { userId: args.userId, purpose: args.purpose, tokenHash: row.tokenHash },
    });
    return null;
  }
  if (row.tokenHash !== hashEmailCode(args.code)) return null;

  // Guarded by the hash so that of two concurrent presentations of the same
  // code exactly one wins, the same one-winner property `consumeRefreshToken`
  // gets from DELETE ... RETURNING.
  const { count } = await prisma.emailToken.deleteMany({
    where: { userId: args.userId, purpose: args.purpose, tokenHash: row.tokenHash },
  });
  return count === 1 ? { email: row.email } : null;
}

export async function invalidateEmailTokens(
  prisma: PrismaClient,
  userId: string,
  purpose?: EmailTokenPurpose
): Promise<void> {
  await prisma.emailToken.deleteMany({
    where: { userId, ...(purpose === undefined ? {} : { purpose }) },
  });
}

export async function deleteExpiredEmailTokens(
  prisma: PrismaClient,
  now: number = Date.now()
): Promise<void> {
  await prisma.emailToken.deleteMany({ where: { expiresAt: { lte: now } } });
}
