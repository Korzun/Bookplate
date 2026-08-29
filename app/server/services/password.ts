/**
 * Two unrelated credential systems, co-located because they're both "user
 * passwords": argon2-hashed login passwords (the account password used to
 * sign in to Bookplate), and the sync password used by the KOSync wire
 * protocol. `hashSyncPassword`'s MD5 digest is that protocol's required
 * format — a KOSync client hashes its password with MD5 and sends the
 * digest, so the server must match it the same way — and must never be
 * used to hash or verify a login password.
 */
import * as crypto from 'crypto';

import { PrismaClient, Prisma } from '@prisma/client';
import argon2 from 'argon2';

import { WORDLIST } from './wordlist';

const LOGIN_PASSWORD_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const LOGIN_PASSWORD_LENGTH = 16;

export function generateSyncPassword(): string {
  let attempts = 0;
  while (attempts < 200) {
    const w1 = WORDLIST[crypto.randomInt(WORDLIST.length)];
    const w2 = WORDLIST[crypto.randomInt(WORDLIST.length)];
    if ((w1 + ' ' + w2).length <= 15) return `${w1} ${w2}`;
    attempts++;
  }
  return 'blue oak'; // all wordlist words are ≤7 chars so this is unreachable in practice
}

export function hashSyncPassword(syncPassword: string): string {
  return crypto.createHash('md5').update(syncPassword).digest('hex');
}

export async function hashLoginPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

async function verifyLoginPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function generateLoginPassword(): string {
  let password = '';
  for (let i = 0; i < LOGIN_PASSWORD_LENGTH; i++) {
    password += LOGIN_PASSWORD_CHARSET[crypto.randomInt(LOGIN_PASSWORD_CHARSET.length)];
  }
  return password;
}

export async function authenticate(
  prisma: PrismaClient,
  username: string,
  key: string
): Promise<string | false> {
  const row = await prisma.user.findUnique({
    where: { username },
    select: { id: true, syncPassword: true },
  });
  if (row === null || row.syncPassword === null) return false;
  if (hashSyncPassword(row.syncPassword) !== key) return false;
  return row.id;
}

export async function validateUser(
  prisma: PrismaClient,
  username: string,
  password: string
): Promise<string | false> {
  const row = await prisma.user.findUnique({
    where: { username },
    select: { id: true, passwordHash: true },
  });
  if (!row?.passwordHash) return false;
  const valid = await verifyLoginPassword(password, row.passwordHash);
  return valid ? row.id : false;
}

/**
 * A function, not inlined, despite being a single-statement lookup: it has
 * two production callers (`routes/ui.ts`'s login and refresh routes) and
 * doesn't fit the placement rule's existence-check exception — it isn't
 * checking whether the user exists (both callers already know the user
 * exists by the time they call this) and it doesn't return `id`, so
 * duplicating the query at both call sites would duplicate a *read of
 * account state*, the thing the two-caller clause protects.
 */
export async function getMustChangePassword(
  prisma: PrismaClient,
  username: string
): Promise<boolean> {
  const row = await prisma.user.findUnique({
    where: { username },
    select: { mustChangePassword: true },
  });
  return row?.mustChangePassword ?? false;
}

export async function changePassword(
  prisma: PrismaClient,
  username: string,
  passwordHash: string
): Promise<boolean> {
  try {
    await prisma.user.update({
      where: { username },
      data: { passwordHash, mustChangePassword: false },
    });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return false;
    }
    throw e;
  }
}

export async function resetPassword(
  prisma: PrismaClient,
  username: string
): Promise<string | null> {
  const password = generateLoginPassword();
  const passwordHash = await hashLoginPassword(password);
  try {
    await prisma.user.update({
      where: { username },
      data: { passwordHash, mustChangePassword: true },
    });
    return password;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return null;
    }
    throw e;
  }
}

export async function getSyncPassword(
  prisma: PrismaClient,
  username: string
): Promise<string | null> {
  const row = await prisma.user.findUnique({
    where: { username },
    select: { syncPassword: true },
  });
  if (row === null) return null;
  if (row.syncPassword !== null) return row.syncPassword;
  const generated = generateSyncPassword();
  await prisma.user.update({ where: { username }, data: { syncPassword: generated } });
  return generated;
}

export async function changeSyncPassword(
  prisma: PrismaClient,
  username: string,
  syncPassword: string
): Promise<boolean> {
  try {
    await prisma.user.update({ where: { username }, data: { syncPassword } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return false;
    }
    throw e;
  }
}
