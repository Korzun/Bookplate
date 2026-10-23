import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from '../db/client';
import { runMigrations } from '../db/migrate';
import {
  ACCESS_TOKEN_TTL_MS,
  createOAuthGrant,
  deleteMcpConnection,
  getOAuthClient,
  listMcpConnections,
  oauthGrantIsLive,
  refreshOAuthGrant,
  REFRESH_TOKEN_TTL_MS,
  registerOAuthClient,
  verifyOAuthAccessToken,
} from './mcp-oauth';

vi.mock('../logger');

let tmpDir: string;
let prisma: PrismaClient;
const ALICE = 'user-alice';
const BOB = 'user-bob';
const RESOURCE = 'http://nas.local:3000/mcp';

const client = (name?: string) =>
  registerOAuthClient(prisma, {
    redirect_uris: ['http://localhost:7777/callback'],
    ...(name !== undefined ? { client_name: name } : {}),
  });

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-oauth-'));
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

describe('clients', () => {
  it('round-trips a registered client, naming it after itself or its redirect host', async () => {
    const named = await client('Claude');
    expect(await getOAuthClient(prisma, named.client_id)).toEqual(named);

    const anonymous = await client();
    const [row] = await prisma.oAuthClient.findMany({ where: { id: anonymous.client_id } });
    expect(row.name).toBe('localhost:7777');
    expect(await getOAuthClient(prisma, 'nope')).toBeUndefined();
  });
});

describe('grants', () => {
  it('resolves an access token to its reader until it expires', async () => {
    const { client_id } = await client();
    const tokens = await createOAuthGrant(prisma, {
      userId: ALICE,
      clientId: client_id,
      resource: RESOURCE,
      now: 1000,
    });

    expect(await verifyOAuthAccessToken(prisma, tokens.access_token, 2000)).toMatchObject({
      userId: ALICE,
      username: 'alice',
      clientId: client_id,
      scope: 'library',
      resource: RESOURCE,
    });
    expect(
      await verifyOAuthAccessToken(prisma, tokens.access_token, 1000 + ACCESS_TOKEN_TTL_MS)
    ).toBeNull();
    // A refresh token is not an access token.
    expect(await verifyOAuthAccessToken(prisma, tokens.refresh_token!, 2000)).toBeNull();
  });

  it('refuses a grant that points at the config admin', async () => {
    await prisma.user.create({ data: { id: 'adm', username: 'admin', isConfigAdmin: true } });
    const { client_id } = await client();
    const tokens = await createOAuthGrant(prisma, {
      userId: 'adm',
      clientId: client_id,
      resource: RESOURCE,
    });
    expect(await verifyOAuthAccessToken(prisma, tokens.access_token)).toBeNull();
  });

  it('refreshes only for the client it was issued to, and not once lapsed', async () => {
    const mine = await client();
    const theirs = await client();
    const tokens = await createOAuthGrant(prisma, {
      userId: ALICE,
      clientId: mine.client_id,
      resource: RESOURCE,
      now: 0,
    });
    const refresh = (clientId: string, now: number) =>
      refreshOAuthGrant(prisma, { clientId, refreshToken: tokens.refresh_token!, now });

    expect(await refresh(theirs.client_id, 1)).toBeNull();
    expect(await refresh(mine.client_id, REFRESH_TOKEN_TTL_MS)).toBeNull();
    expect(await refresh(mine.client_id, 1)).not.toBeNull();
  });

  it('slides the refresh expiry forward on every refresh', async () => {
    const { client_id } = await client();
    let tokens = await createOAuthGrant(prisma, {
      userId: ALICE,
      clientId: client_id,
      resource: RESOURCE,
      now: 0,
    });
    const later = REFRESH_TOKEN_TTL_MS - 1;
    tokens = (await refreshOAuthGrant(prisma, {
      clientId: client_id,
      refreshToken: tokens.refresh_token!,
      now: later,
    }))!;
    // Past the original lapse, but within the window the refresh renewed.
    expect(
      await refreshOAuthGrant(prisma, {
        clientId: client_id,
        refreshToken: tokens.refresh_token!,
        now: later + REFRESH_TOKEN_TTL_MS - 1,
      })
    ).not.toBeNull();
  });

  it('records use at most once a minute', async () => {
    const { client_id } = await client();
    const tokens = await createOAuthGrant(prisma, {
      userId: ALICE,
      clientId: client_id,
      resource: RESOURCE,
      now: 0,
    });
    const lastUsed = async () => (await prisma.oAuthGrant.findFirstOrThrow()).lastUsedAt;

    await verifyOAuthAccessToken(prisma, tokens.access_token, 10_000);
    expect(await lastUsed()).toBe(10_000);
    await verifyOAuthAccessToken(prisma, tokens.access_token, 30_000);
    expect(await lastUsed()).toBe(10_000);
    await verifyOAuthAccessToken(prisma, tokens.access_token, 70_000);
    expect(await lastUsed()).toBe(70_000);
  });
});

describe("the reader's connections", () => {
  it('lists live connections by client name and disconnects only the owner’s', async () => {
    const claude = await client('Claude');
    await createOAuthGrant(prisma, {
      userId: ALICE,
      clientId: claude.client_id,
      resource: RESOURCE,
      now: 5,
    });
    await createOAuthGrant(prisma, { userId: BOB, clientId: claude.client_id, resource: RESOURCE });

    const [connection] = await listMcpConnections(prisma, ALICE, 10);
    expect(connection).toMatchObject({ clientName: 'Claude', createdAt: 5, lastUsedAt: null });
    // A grant whose refresh token lapsed is no longer listed.
    expect(await listMcpConnections(prisma, ALICE, 5 + REFRESH_TOKEN_TTL_MS)).toEqual([]);

    expect(await deleteMcpConnection(prisma, { userId: BOB, id: connection.id })).toBe(false);
    expect(await oauthGrantIsLive(prisma, { grantId: connection.id, userId: ALICE })).toBe(true);
    expect(await oauthGrantIsLive(prisma, { grantId: connection.id, userId: BOB })).toBe(false);

    expect(await deleteMcpConnection(prisma, { userId: ALICE, id: connection.id })).toBe(true);
    expect(await oauthGrantIsLive(prisma, { grantId: connection.id, userId: ALICE })).toBe(false);
  });
});
