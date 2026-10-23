import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from '../db/client';
import { runMigrations } from '../db/migrate';
import {
  authenticateMcpToken,
  createMcpToken,
  deleteMcpToken,
  hashMcpToken,
  listMcpTokenRows,
  MAX_MCP_TOKENS_PER_USER,
  mcpTokenIsLive,
} from './mcp-token';

vi.mock('../logger');

let tmpDir: string;
let prisma: PrismaClient;
const ALICE = 'user-alice';
const BOB = 'user-bob';

const create = async (userId: string, label = 'Laptop', now = 1000) => {
  const result = await createMcpToken(prisma, { userId, label, now });
  if (result === null) throw new Error('expected createMcpToken to succeed');
  return result;
};

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-token-'));
  const booksDir = path.join(tmpDir, 'books');
  fs.mkdirSync(booksDir, { recursive: true });
  prisma = createPrismaClient(`file:${path.join(tmpDir, 'db.sqlite')}`);
  await runMigrations(prisma, booksDir);
  await prisma.user.create({ data: { id: ALICE, username: 'alice' } });
  await prisma.user.create({ data: { id: BOB, username: 'bob' } });
});

afterEach(async () => {
  await prisma.$disconnect();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('createMcpToken', () => {
  it('returns the plaintext once and stores only its hash', async () => {
    const { row, token } = await create(ALICE);

    expect(token).toMatch(/^bpmcp_[A-Za-z0-9_-]{43}$/);
    const stored = await prisma.mcpToken.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.tokenHash).toBe(hashMcpToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(row).toEqual({ id: row.id, label: 'Laptop', createdAt: 1000, lastUsedAt: null });
  });

  it('mints a different token every time', async () => {
    const a = await create(ALICE);
    const b = await create(ALICE);
    expect(a.token).not.toBe(b.token);
  });

  it('refuses a new token once the reader holds the maximum', async () => {
    for (let i = 0; i < MAX_MCP_TOKENS_PER_USER; i += 1) await create(ALICE, `t${i}`);

    expect(await createMcpToken(prisma, { userId: ALICE, label: 'one more' })).toBeNull();
    // The cap is per reader.
    expect(await createMcpToken(prisma, { userId: BOB, label: 'first' })).not.toBeNull();
  });
});

describe('authenticateMcpToken', () => {
  it('resolves a live token to its reader', async () => {
    const { row, token } = await create(ALICE);
    expect(await authenticateMcpToken(prisma, token, 5000)).toEqual({
      tokenId: row.id,
      userId: ALICE,
      username: 'alice',
    });
  });

  it('rejects an unknown, malformed or revoked token', async () => {
    const { row, token } = await create(ALICE);
    expect(await authenticateMcpToken(prisma, 'bpmcp_nope')).toBeNull();
    expect(await authenticateMcpToken(prisma, 'not-a-token')).toBeNull();

    await deleteMcpToken(prisma, { userId: ALICE, id: row.id });
    expect(await authenticateMcpToken(prisma, token)).toBeNull();
  });

  it('rejects a token attached to the config admin row', async () => {
    await prisma.user.create({ data: { id: 'adm', username: 'admin', isConfigAdmin: true } });
    const { token } = await create('adm');
    expect(await authenticateMcpToken(prisma, token)).toBeNull();
  });

  it('records use, at most once a minute', async () => {
    const { row, token } = await create(ALICE);
    const lastUsed = async () =>
      (await prisma.mcpToken.findUniqueOrThrow({ where: { id: row.id } })).lastUsedAt;

    await authenticateMcpToken(prisma, token, 10_000);
    expect(await lastUsed()).toBe(10_000);

    await authenticateMcpToken(prisma, token, 30_000);
    expect(await lastUsed()).toBe(10_000);

    await authenticateMcpToken(prisma, token, 70_000);
    expect(await lastUsed()).toBe(70_000);
  });
});

describe('listMcpTokenRows / deleteMcpToken / mcpTokenIsLive', () => {
  it("lists only the reader's own tokens, oldest first, without hashes", async () => {
    await create(ALICE, 'second', 2000);
    await create(ALICE, 'first', 1000);
    await create(BOB, 'bob', 1500);

    const rows = await listMcpTokenRows(prisma, ALICE);
    expect(rows.map((r) => r.label)).toEqual(['first', 'second']);
    expect(Object.keys(rows[0]).sort()).toEqual(['createdAt', 'id', 'label', 'lastUsedAt']);
  });

  it("cannot delete another reader's token", async () => {
    const { row } = await create(ALICE);
    expect(await deleteMcpToken(prisma, { userId: BOB, id: row.id })).toBe(false);
    expect(await mcpTokenIsLive(prisma, { tokenId: row.id, userId: ALICE })).toBe(true);

    expect(await deleteMcpToken(prisma, { userId: ALICE, id: row.id })).toBe(true);
    expect(await mcpTokenIsLive(prisma, { tokenId: row.id, userId: ALICE })).toBe(false);
  });

  it('treats a token as live only for its own reader', async () => {
    const { row } = await create(ALICE);
    expect(await mcpTokenIsLive(prisma, { tokenId: row.id, userId: BOB })).toBe(false);
  });
});
