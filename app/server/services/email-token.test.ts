import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import { runMigrations } from '../db/migrate';
import {
  consumeEmailToken,
  deleteExpiredEmailTokens,
  generateEmailCode,
  hashEmailCode,
  invalidateEmailTokens,
  issueEmailToken,
  MAX_SENDS_PER_WINDOW,
  RESEND_COOLDOWN_MS,
  RESET_TTL_MS,
  SEND_WINDOW_MS,
  VERIFY_TTL_MS,
} from './email-token';

vi.mock('../logger');

let prisma: PrismaClient;
let dbPath: string;

beforeEach(async () => {
  const booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-token-'));
  dbPath = path.join(
    os.tmpdir(),
    `email-token-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksDir);
});

afterEach(async () => {
  await prisma.$disconnect();
  try {
    fs.unlinkSync(dbPath);
  } catch {}
});

const T0 = 1_700_000_000_000;

describe('generateEmailCode', () => {
  it('is 8 characters from an unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateEmailCode()).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
    }
  });

  it('does not repeat across 500 draws', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateEmailCode()));
    expect(seen.size).toBe(500);
  });
});

describe('issueEmailToken', () => {
  beforeEach(async () => {
    await prisma.user.create({ data: { id: 'u1', username: 'ann' } });
  });

  it('stores only the hash of the code', async () => {
    const result = await issueEmailToken(prisma, {
      userId: 'u1',
      purpose: 'verify',
      email: 'ann@example.com',
      now: T0,
    });
    expect(result.ok).toBe(true);
    const code = (result as { ok: true; code: string }).code;
    const row = await prisma.emailToken.findUniqueOrThrow({
      where: { userId_purpose: { userId: 'u1', purpose: 'verify' } },
    });
    expect(row.tokenHash).toBe(hashEmailCode(code));
    expect(row.tokenHash).not.toContain(code);
    expect(row.email).toBe('ann@example.com');
    expect(row.expiresAt).toBe(T0 + VERIFY_TTL_MS);
    expect(row.sendCount).toBe(1);
  });

  it('gives a reset token the shorter TTL', async () => {
    await issueEmailToken(prisma, { userId: 'u1', purpose: 'reset', email: 'a@b.co', now: T0 });
    const row = await prisma.emailToken.findUniqueOrThrow({
      where: { userId_purpose: { userId: 'u1', purpose: 'reset' } },
    });
    expect(row.expiresAt).toBe(T0 + RESET_TTL_MS);
  });

  it('refuses a resend inside the cooldown and says how long to wait', async () => {
    await issueEmailToken(prisma, { userId: 'u1', purpose: 'verify', email: 'a@b.co', now: T0 });
    const second = await issueEmailToken(prisma, {
      userId: 'u1',
      purpose: 'verify',
      email: 'a@b.co',
      now: T0 + 30_000,
    });
    expect(second).toEqual({ ok: false, reason: 'cooldown', retryAfterMs: 30_000 });
  });

  it('replaces the previous code once the cooldown has passed, invalidating it', async () => {
    const first = await issueEmailToken(prisma, {
      userId: 'u1',
      purpose: 'verify',
      email: 'a@b.co',
      now: T0,
    });
    const firstCode = (first as { ok: true; code: string }).code;
    const second = await issueEmailToken(prisma, {
      userId: 'u1',
      purpose: 'verify',
      email: 'a@b.co',
      now: T0 + RESEND_COOLDOWN_MS,
    });
    expect(second.ok).toBe(true);
    expect(
      await consumeEmailToken(prisma, {
        userId: 'u1',
        purpose: 'verify',
        code: firstCode,
        now: T0 + RESEND_COOLDOWN_MS,
      })
    ).toBeNull();
  });

  it('caps sends within the rolling window', async () => {
    let now = T0;
    for (let i = 0; i < MAX_SENDS_PER_WINDOW; i++) {
      const r = await issueEmailToken(prisma, {
        userId: 'u1',
        purpose: 'verify',
        email: 'a@b.co',
        now,
      });
      expect(r.ok).toBe(true);
      now += RESEND_COOLDOWN_MS;
    }
    const capped = await issueEmailToken(prisma, {
      userId: 'u1',
      purpose: 'verify',
      email: 'a@b.co',
      now,
    });
    expect(capped).toMatchObject({ ok: false, reason: 'send_cap' });
  });

  it('lets the window roll over, restarting the count rather than resuming it', async () => {
    let now = T0;
    for (let i = 0; i < MAX_SENDS_PER_WINDOW; i++) {
      await issueEmailToken(prisma, { userId: 'u1', purpose: 'verify', email: 'a@b.co', now });
      now += RESEND_COOLDOWN_MS;
    }
    const rolloverNow = T0 + SEND_WINDOW_MS + 1;
    const after = await issueEmailToken(prisma, {
      userId: 'u1',
      purpose: 'verify',
      email: 'a@b.co',
      now: rolloverNow,
    });
    expect(after.ok).toBe(true);
    // A single `ok: true` here would also pass an implementation that resets
    // `createdAt` on rollover but forgets to reset `sendCount` back to 1 —
    // that mutant's `windowOpen` is false for THIS call regardless of what
    // `sendCount` holds, so the cap check never runs. A second send, past the
    // cooldown but still inside the freshly-started window, only succeeds if
    // the count genuinely restarted at 1 rather than resuming at 5.
    const second = await issueEmailToken(prisma, {
      userId: 'u1',
      purpose: 'verify',
      email: 'a@b.co',
      now: rolloverNow + RESEND_COOLDOWN_MS,
    });
    expect(second.ok).toBe(true);
  });

  it('keeps verify and reset tokens independent', async () => {
    await issueEmailToken(prisma, { userId: 'u1', purpose: 'verify', email: 'a@b.co', now: T0 });
    const reset = await issueEmailToken(prisma, {
      userId: 'u1',
      purpose: 'reset',
      email: 'a@b.co',
      now: T0,
    });
    expect(reset.ok).toBe(true);
  });
});

describe('consumeEmailToken', () => {
  beforeEach(async () => {
    await prisma.user.create({ data: { id: 'u1', username: 'ann' } });
  });

  const issue = async (now = T0, purpose: 'verify' | 'reset' = 'verify') => {
    const r = await issueEmailToken(prisma, { userId: 'u1', purpose, email: 'a@b.co', now });
    return (r as { ok: true; code: string }).code;
  };

  it('returns the address the code was sent to and deletes the row', async () => {
    const code = await issue();
    expect(
      await consumeEmailToken(prisma, { userId: 'u1', purpose: 'verify', code, now: T0 })
    ).toEqual({ email: 'a@b.co' });
    expect(await prisma.emailToken.count()).toBe(0);
  });

  it('is single-use', async () => {
    const code = await issue();
    await consumeEmailToken(prisma, { userId: 'u1', purpose: 'verify', code, now: T0 });
    expect(
      await consumeEmailToken(prisma, { userId: 'u1', purpose: 'verify', code, now: T0 })
    ).toBeNull();
  });

  it('rejects an expired code', async () => {
    const code = await issue();
    expect(
      await consumeEmailToken(prisma, {
        userId: 'u1',
        purpose: 'verify',
        code,
        now: T0 + VERIFY_TTL_MS + 1,
      })
    ).toBeNull();
  });

  it('rejects a wrong code WITHOUT destroying the valid one', async () => {
    const code = await issue();
    expect(
      await consumeEmailToken(prisma, {
        userId: 'u1',
        purpose: 'verify',
        code: 'WRONGONE',
        now: T0,
      })
    ).toBeNull();
    expect(
      await consumeEmailToken(prisma, { userId: 'u1', purpose: 'verify', code, now: T0 })
    ).toEqual({ email: 'a@b.co' });
  });

  it('will not accept a verify code for a reset', async () => {
    const code = await issue(T0, 'verify');
    expect(
      await consumeEmailToken(prisma, { userId: 'u1', purpose: 'reset', code, now: T0 })
    ).toBeNull();
  });

  it('will not accept another account’s code', async () => {
    await prisma.user.create({ data: { id: 'u2', username: 'bob' } });
    const code = await issue();
    expect(
      await consumeEmailToken(prisma, { userId: 'u2', purpose: 'verify', code, now: T0 })
    ).toBeNull();
  });

  it('is case-insensitive about the typed code', async () => {
    const code = await issue();
    expect(
      await consumeEmailToken(prisma, {
        userId: 'u1',
        purpose: 'verify',
        code: code.toLowerCase(),
        now: T0,
      })
    ).toEqual({ email: 'a@b.co' });
  });

  it('tolerates spaces a user pasted around the code', async () => {
    const code = await issue();
    expect(
      await consumeEmailToken(prisma, {
        userId: 'u1',
        purpose: 'verify',
        code: ` ${code} `,
        now: T0,
      })
    ).toEqual({ email: 'a@b.co' });
  });
});

describe('invalidateEmailTokens', () => {
  beforeEach(async () => {
    await prisma.user.create({ data: { id: 'u1', username: 'ann' } });
    await issueEmailToken(prisma, { userId: 'u1', purpose: 'verify', email: 'a@b.co', now: T0 });
    await issueEmailToken(prisma, { userId: 'u1', purpose: 'reset', email: 'a@b.co', now: T0 });
  });

  it('drops every purpose when none is named', async () => {
    await invalidateEmailTokens(prisma, 'u1');
    expect(await prisma.emailToken.count()).toBe(0);
  });

  it('drops only the named purpose', async () => {
    await invalidateEmailTokens(prisma, 'u1', 'reset');
    expect(await prisma.emailToken.count()).toBe(1);
  });
});

describe('deleteExpiredEmailTokens', () => {
  it('removes only tokens past their expiry', async () => {
    await prisma.user.create({ data: { id: 'u1', username: 'ann' } });
    await issueEmailToken(prisma, { userId: 'u1', purpose: 'reset', email: 'a@b.co', now: T0 });
    await deleteExpiredEmailTokens(prisma, T0 + RESET_TTL_MS - 1);
    expect(await prisma.emailToken.count()).toBe(1);
    await deleteExpiredEmailTokens(prisma, T0 + RESET_TTL_MS + 1);
    expect(await prisma.emailToken.count()).toBe(0);
  });
});
