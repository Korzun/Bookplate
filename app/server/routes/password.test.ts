import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';

import { runMigrations } from '../db/migrate';
import { ensureAdminUser } from '../services/admin-account';
import { getStagingDir } from '../services/book-paths';
import { markEmailVerified, setUserEmail } from '../services/email';
import { hashEmailCode, RESET_TTL_MS } from '../services/email-token';
import { signAccessToken } from '../services/jwt';
import type { Mailer, MailMessage, SendResult } from '../services/mailer';
import { hashLoginPassword } from '../services/password';
import { createReplaceStaging, type ReplaceStaging } from '../services/replace-staging';
import { ThumbnailQueue } from '../services/thumbnail-queue';
import { createUser } from '../services/user';
import { AppConfig, MailConfig } from '../types';
import { createUiRouter } from './ui';

vi.mock('../logger');

const config: AppConfig = {
  libraryName: 'Bookplate',
  username: 'admin',
  password: 'pass',
  booksDir: '',
  dataDir: '/tmp',
  port: 3000,
  maxConcurrentUploads: 3,
  thumbnailWidths: [86, 160],
  validationThreshold: 'ERROR',
};

const MAIL_CONFIG: MailConfig = {
  accountId: 'acct',
  apiToken: 'tok',
  from: 'lib@example.com',
  fromName: 'Bookplate',
};

const mockThumbnailQueue = {
  enqueue: vi.fn(),
  reconcile: vi.fn(),
} as unknown as ThumbnailQueue;

/**
 * A `Mailer` that never touches the network — same shape as `graphql/test-
 * util.ts`'s `FakeMailer` (not imported from there: that one isn't exported,
 * and this file's `PrismaClient`/`booksDir` are independent of that harness's).
 */
type FakeMailer = Mailer & { sent: MailMessage[]; nextResult?: SendResult };

function createFakeMailer(): FakeMailer {
  return {
    sent: [],
    nextResult: undefined,
    async send(message: MailMessage): Promise<SendResult> {
      this.sent.push(message);
      return this.nextResult ?? { ok: true };
    },
  };
}

let booksDir: string;
let editionsRoot: string;
let prisma: PrismaClient;
let replaceStaging: ReplaceStaging;
let dbPath: string;
const jwtSecret = crypto.randomBytes(32);

beforeEach(async () => {
  booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookplate-password-'));
  editionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookplate-password-editions-'));
  dbPath = path.join(
    os.tmpdir(),
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksDir);
  replaceStaging = createReplaceStaging({ stagingDir: getStagingDir(booksDir) });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.$disconnect();
  try {
    fs.unlinkSync(dbPath);
  } catch {
    /* best-effort cleanup */
  }
  fs.rmSync(booksDir, { recursive: true });
  fs.rmSync(editionsRoot, { recursive: true });
});

/**
 * Builds a fresh app (with the full `createUiRouter`, since the password
 * routes are mounted inside it) against this test's `prisma`/`booksDir`. A
 * `mail` override of `MAIL_CONFIG` wires a `FakeMailer` in; `null` (or
 * omitted) leaves mail unconfigured, matching `createMailer` returning `null`
 * for an unconfigured install.
 */
function build(configOverrides: Partial<AppConfig> = {}): {
  app: express.Express;
  mailer: FakeMailer | null;
} {
  const mailer = configOverrides.mail ? createFakeMailer() : null;
  const testApp = express();
  testApp.use(express.json());
  testApp.use(express.urlencoded({ extended: false }));
  testApp.use(cookieParser());
  testApp.use(
    '/',
    createUiRouter({
      editionsRoot,
      config: { ...config, booksDir, ...configOverrides },
      thumbnailQueue: mockThumbnailQueue,
      jwtSecret,
      prisma,
      replaceStaging,
      mailer,
    })
  );
  testApp.use((_err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  return { app: testApp, mailer };
}

async function createReader(username: string, password: string): Promise<string> {
  await createUser(prisma, username, await hashLoginPassword(password));
  const { id } = (await prisma.user.findUnique({ where: { username } }))!;
  return id;
}

describe('POST /api/password/forgot', () => {
  it('sends a reset code to a verified address', async () => {
    const { app, mailer } = build({ mail: MAIL_CONFIG });
    const id = await createReader('ann', 'old-password');
    await setUserEmail(prisma, id, 'ann@example.com');
    await markEmailVerified(prisma, id);

    const res = await request(app).post('/api/password/forgot').send({ email: 'ann@example.com' });

    expect(res.status).toBe(204);
    expect(mailer!.sent).toHaveLength(1);
    expect(mailer!.sent[0].subject).toContain('Reset');
  });

  it('returns 204 with an empty body for an unknown address, and sends nothing', async () => {
    const { app, mailer } = build({ mail: MAIL_CONFIG });
    const res = await request(app).post('/api/password/forgot').send({ email: 'who@example.com' });
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(mailer!.sent).toHaveLength(0);
  });

  it('returns 204 for an UNVERIFIED address, and sends nothing', async () => {
    const { app, mailer } = build({ mail: MAIL_CONFIG });
    const id = await createReader('ann', 'old-password');
    await setUserEmail(prisma, id, 'ann@example.com'); // never verified
    const res = await request(app).post('/api/password/forgot').send({ email: 'ann@example.com' });
    expect(res.status).toBe(204);
    expect(mailer!.sent).toHaveLength(0);
  });

  it('returns 204 for the config admin, and sends nothing', async () => {
    const { app, mailer } = build({ mail: MAIL_CONFIG });
    const adminId = (await ensureAdminUser(prisma, 'admin'))!;
    await setUserEmail(prisma, adminId, 'boss@example.com');
    await markEmailVerified(prisma, adminId);

    const res = await request(app).post('/api/password/forgot').send({ email: 'boss@example.com' });

    // The admin's password is the add-on options value; a reset link would
    // promise something this app cannot deliver. Same 204 as every other case, so
    // the response reveals nothing.
    expect(res.status).toBe(204);
    expect(mailer!.sent).toHaveLength(0);
  });

  it('returns 204 for a malformed address', async () => {
    const { app } = build({ mail: MAIL_CONFIG });
    expect((await request(app).post('/api/password/forgot').send({ email: 'nope' })).status).toBe(
      204
    );
  });

  it('returns 404 when mail is unconfigured', async () => {
    const { app } = build({ mail: null });
    const res = await request(app).post('/api/password/forgot').send({ email: 'a@b.co' });
    expect(res.status).toBe(404);
  });

  it('rate-limits by IP', async () => {
    const { app } = build({ mail: MAIL_CONFIG });
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/password/forgot').send({ email: 'a@b.co' });
    }
    const res = await request(app).post('/api/password/forgot').send({ email: 'a@b.co' });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('POST /api/password/reset', () => {
  const primed = async () => {
    const built = build({ mail: MAIL_CONFIG });
    const id = await createReader('ann', 'old-password');
    await setUserEmail(prisma, id, 'ann@example.com');
    await markEmailVerified(prisma, id);
    await request(built.app).post('/api/password/forgot').send({ email: 'ann@example.com' });
    const code = /\b[0-9A-HJKMNP-TV-Z]{8}\b/.exec(built.mailer!.sent[0].text)![0];
    return { ...built, id, code };
  };

  it('sets the new password and lets the user log in with it', async () => {
    const { app, code } = await primed();

    const res = await request(app)
      .post('/api/password/reset')
      .send({ email: 'ann@example.com', code, newPassword: 'a-brand-new-password' });

    expect(res.status).toBe(204);
    const login = await request(app)
      .post('/api/login')
      .send({ username: 'ann', password: 'a-brand-new-password' });
    expect(login.status).toBe(200);
  });

  it('revokes every outstanding refresh token', async () => {
    const { app, id, code } = await primed();
    await request(app).post('/api/login').send({ username: 'ann', password: 'old-password' });
    expect(await prisma.refreshToken.count({ where: { userId: id } })).toBeGreaterThan(0);

    await request(app)
      .post('/api/password/reset')
      .send({ email: 'ann@example.com', code, newPassword: 'a-brand-new-password' });

    expect(await prisma.refreshToken.count({ where: { userId: id } })).toBe(0);
  });

  it('clears a pending forced password change', async () => {
    const { app, id, code } = await primed();
    await prisma.user.update({ where: { id }, data: { mustChangePassword: true } });

    await request(app)
      .post('/api/password/reset')
      .send({ email: 'ann@example.com', code, newPassword: 'a-brand-new-password' });

    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).mustChangePassword).toBe(false);
  });

  it('consumes the code', async () => {
    const { app, code } = await primed();
    const body = { email: 'ann@example.com', code, newPassword: 'a-brand-new-password' };
    expect((await request(app).post('/api/password/reset').send(body)).status).toBe(204);
    expect((await request(app).post('/api/password/reset').send(body)).status).toBe(400);
  });

  it('rejects a wrong code, an unknown address, and a too-short password with byte-identical 400 bodies', async () => {
    const { app, code } = await primed();

    const bodies: unknown[] = [];
    for (const override of [
      { code: 'WRONGONE' },
      { email: 'who@example.com' },
      { newPassword: 'short' },
    ]) {
      const res = await request(app)
        .post('/api/password/reset')
        .send({ email: 'ann@example.com', code, newPassword: 'a-brand-new-password', ...override });
      expect(res.status).toBe(400);
      bodies.push(res.body);
    }

    // The spec's property is that every failure is indistinguishable — in
    // body, not only status — so a future branch that adds a distinguishing
    // message for just one of these cases turns this red. Compared as
    // serialized JSON (not just deep-equality) so a key-order or extra-field
    // difference would be caught too.
    const serialized = bodies.map((body) => JSON.stringify(body));
    expect(new Set(serialized).size).toBe(1);
  });

  it('rejects a code whose address has since changed, with the same 400 body as every other failure', async () => {
    const { app, id, code } = await primed();
    await prisma.user.update({
      where: { id },
      data: { email: 'moved@example.com', emailKey: 'moved@example.com' },
    });
    const res = await request(app)
      .post('/api/password/reset')
      .send({ email: 'ann@example.com', code, newPassword: 'a-brand-new-password' });
    expect(res.status).toBe(400);

    const wrongCode = await request(app)
      .post('/api/password/reset')
      .send({ email: 'ann@example.com', code: 'WRONGONE', newPassword: 'a-brand-new-password' });
    expect(JSON.stringify(res.body)).toBe(JSON.stringify(wrongCode.body));
  });

  it('refuses to reset the config admin, and leaves the admin credential (the add-on options) untouched', async () => {
    const { app } = build({ mail: MAIL_CONFIG });
    const adminId = (await ensureAdminUser(prisma, config.username))!;
    await setUserEmail(prisma, adminId, 'boss@example.com');
    await markEmailVerified(prisma, adminId);

    // `forgot` never issues a code for the admin (see the forgot suite above),
    // so a real attacker could not reach this state — force a `reset`-purpose
    // token row directly to prove `reset` ALSO refuses the admin on its own,
    // not only by relying on `forgot` never having sent anything.
    const code = 'ADMINCOD';
    await prisma.emailToken.create({
      data: {
        userId: adminId,
        purpose: 'reset',
        tokenHash: hashEmailCode(code),
        email: 'boss@example.com',
        expiresAt: Date.now() + RESET_TTL_MS,
        createdAt: Date.now(),
        sentAt: Date.now(),
        sendCount: 1,
      },
    });

    const res = await request(app)
      .post('/api/password/reset')
      .send({ email: 'boss@example.com', code, newPassword: 'a-brand-new-password' });
    expect(res.status).toBe(400);

    // The admin's password is `config.password`, read from the add-on options —
    // nothing above could have changed it, so it must still work.
    const login = await request(app)
      .post('/api/login')
      .send({ username: config.username, password: config.password });
    expect(login.status).toBe(200);
  });
});

describe('mount order — /api/password/* is reachable regardless of pending gate claims', () => {
  // `routes/ui.ts` mounts `createPasswordRouter` BEFORE `passwordChangeGate`/
  // `emailSetupGate`, so a caller who owes a password change or an address can
  // still reach these routes — the two gates' own `/api/password/*` exemptions
  // (`middleware/auth.ts`, asserted against stub handlers in
  // `middleware/auth.test.ts`) are belt-and-braces, not the only thing keeping
  // this reachable. This test is the one place that end-to-end property is
  // pinned against the REAL mounted router, with a token that would otherwise
  // be refused by both gates.
  it('does not refuse a request carrying a bearer token with mustChangePassword: true', async () => {
    const { app } = build({ mail: MAIL_CONFIG });
    const token = signAccessToken(jwtSecret, {
      userId: 'someone',
      username: 'someone',
      isAdmin: false,
      mustChangePassword: true,
      mustSetEmail: false,
    });

    const res = await request(app)
      .post('/api/password/forgot')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'a@b.co' });

    // 204 (forgot's flat, unconditional response), never the gates' 403.
    expect(res.status).toBe(204);
  });

  it('does not refuse a request carrying a bearer token with mustSetEmail: true', async () => {
    const { app } = build({ mail: MAIL_CONFIG });
    const token = signAccessToken(jwtSecret, {
      userId: 'someone',
      username: 'someone',
      isAdmin: false,
      mustChangePassword: false,
      mustSetEmail: true,
    });

    const res = await request(app)
      .post('/api/password/forgot')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'a@b.co' });

    expect(res.status).toBe(204);
  });
});
