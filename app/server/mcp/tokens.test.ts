import { createHarness, type Harness } from '../graphql/test-util';
import { deleteUser } from '../services/user';
import {
  ACCESS_TOKEN_TTL_MS,
  CODE_TTL_MS,
  consumeAuthorizationCode,
  consumeRefreshToken,
  createAuthorizationCode,
  issueTokens,
  lookupAccessToken,
  peekAuthorizationCode,
  resolveGrantedScopes,
  revokeToken,
  sweepExpired,
  touchGrant,
  UNGRANTED_CLIENT_TTL_MS,
  upsertGrant,
} from './tokens';

vi.mock('../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const registerClient = (clientId: string, createdAt = Date.now()) =>
  harness.prisma.mcpClient.create({
    data: {
      clientId,
      clientIdIssuedAt: createdAt / 1000,
      metadata: JSON.stringify({ client_id: clientId, redirect_uris: ['https://c.example/cb'] }),
      createdAt,
    },
  });

describe('resolveGrantedScopes', () => {
  it('grants both scopes when nothing is requested', () => {
    expect(resolveGrantedScopes(undefined, false)).toEqual(['library:read', 'library:write']);
    expect(resolveGrantedScopes([], false)).toEqual(['library:read', 'library:write']);
  });
  it('keeps only known requested scopes', () => {
    expect(resolveGrantedScopes(['library:read'], false)).toEqual(['library:read']);
    expect(resolveGrantedScopes(['library:write', 'bogus'], false)).toEqual(['library:write']);
  });
  it('narrows to read when the reader chose read only', () => {
    expect(resolveGrantedScopes(['library:write'], true)).toEqual(['library:read']);
    expect(resolveGrantedScopes(undefined, true)).toEqual(['library:read']);
  });
  it('throws when nothing known was requested', () => {
    expect(() => resolveGrantedScopes(['bogus'], false)).toThrow(RangeError);
  });
});

describe('grants, codes and tokens', () => {
  it('upserting a grant keeps one row and invalidates its earlier tokens', async () => {
    await registerClient('c1');
    const first = await upsertGrant(harness.prisma, {
      userId: harness.aliceOwner.userId,
      clientId: 'c1',
      scopes: ['library:read', 'library:write'],
    });
    const tokens = await issueTokens(harness.prisma, first.id, ['library:read', 'library:write']);
    expect(await lookupAccessToken(harness.prisma, tokens.access_token)).toMatchObject({
      grantId: first.id,
      userId: harness.aliceOwner.userId,
      username: 'alice',
      scopes: ['library:read', 'library:write'],
    });

    const second = await upsertGrant(harness.prisma, {
      userId: harness.aliceOwner.userId,
      clientId: 'c1',
      scopes: ['library:read'],
    });
    expect(second.id).toBe(first.id);
    expect(await harness.prisma.mcpGrant.count()).toBe(1);
    expect(await lookupAccessToken(harness.prisma, tokens.access_token)).toBeNull();
    const client = await harness.prisma.mcpClient.findUniqueOrThrow({ where: { clientId: 'c1' } });
    expect(client.lastGrantedAt).not.toBeNull();
  });

  it('an authorization code can be peeked, consumed once, and expires', async () => {
    await registerClient('c1');
    const grant = await upsertGrant(harness.prisma, {
      userId: harness.aliceOwner.userId,
      clientId: 'c1',
      scopes: ['library:read'],
    });
    const now = 1_000_000;
    const bind = {
      grantId: grant.id,
      redirectUri: 'https://c.example/cb',
      codeChallenge: 'chal',
      resource: null,
    };
    const code = await createAuthorizationCode(harness.prisma, bind, now);
    expect(await peekAuthorizationCode(harness.prisma, code, now)).toEqual({
      codeChallenge: 'chal',
      clientId: 'c1',
    });
    expect(await consumeAuthorizationCode(harness.prisma, code, now)).toEqual({
      grantId: grant.id,
      clientId: 'c1',
      userId: harness.aliceOwner.userId,
      scopes: ['library:read'],
      redirectUri: 'https://c.example/cb',
      resource: null,
    });
    expect(await consumeAuthorizationCode(harness.prisma, code, now)).toBeNull();

    const late = await createAuthorizationCode(harness.prisma, bind, now);
    expect(await peekAuthorizationCode(harness.prisma, late, now + CODE_TTL_MS + 1)).toBeNull();
    expect(await consumeAuthorizationCode(harness.prisma, late, now + CODE_TTL_MS + 1)).toBeNull();
  });

  it('rotates refresh tokens and expires access tokens', async () => {
    await registerClient('c1');
    const grant = await upsertGrant(harness.prisma, {
      userId: harness.aliceOwner.userId,
      clientId: 'c1',
      scopes: ['library:read'],
    });
    const now = 1_000_000;
    const tokens = await issueTokens(harness.prisma, grant.id, ['library:read'], now);
    expect(tokens).toMatchObject({ token_type: 'bearer', expires_in: 3600, scope: 'library:read' });

    expect(await consumeRefreshToken(harness.prisma, tokens.refresh_token!, now)).toEqual({
      grantId: grant.id,
      clientId: 'c1',
      scopes: ['library:read'],
    });
    expect(await consumeRefreshToken(harness.prisma, tokens.refresh_token!, now)).toBeNull();

    expect(
      await lookupAccessToken(harness.prisma, tokens.access_token, now + ACCESS_TOKEN_TTL_MS + 1)
    ).toBeNull();
  });

  it('a deleted user’s token no longer resolves', async () => {
    await registerClient('c1');
    const grant = await upsertGrant(harness.prisma, {
      userId: harness.aliceOwner.userId,
      clientId: 'c1',
      scopes: ['library:read'],
    });
    const tokens = await issueTokens(harness.prisma, grant.id, ['library:read']);
    await deleteUser(harness.prisma, harness.editionsRoot, 'alice');
    expect(await lookupAccessToken(harness.prisma, tokens.access_token)).toBeNull();
  });

  it('revokes a presented token', async () => {
    await registerClient('c1');
    const grant = await upsertGrant(harness.prisma, {
      userId: harness.aliceOwner.userId,
      clientId: 'c1',
      scopes: ['library:read'],
    });
    const tokens = await issueTokens(harness.prisma, grant.id, ['library:read']);
    await revokeToken(harness.prisma, tokens.access_token);
    expect(await lookupAccessToken(harness.prisma, tokens.access_token)).toBeNull();
    await revokeToken(harness.prisma, 'never-issued'); // no throw
  });

  it('touchGrant writes last_used_at at most once a minute', async () => {
    await registerClient('c1');
    const grant = await upsertGrant(harness.prisma, {
      userId: harness.aliceOwner.userId,
      clientId: 'c1',
      scopes: ['library:read'],
    });
    const read = async () =>
      (await harness.prisma.mcpGrant.findUniqueOrThrow({ where: { id: grant.id } })).lastUsedAt;
    await touchGrant(harness.prisma, grant.id, 1_000_000);
    expect(await read()).toBe(1_000_000);
    await touchGrant(harness.prisma, grant.id, 1_030_000);
    expect(await read()).toBe(1_000_000);
    await touchGrant(harness.prisma, grant.id, 1_061_000);
    expect(await read()).toBe(1_061_000);
  });

  it('sweeps expired rows and never-granted clients', async () => {
    const now = 10_000_000_000;
    await registerClient('granted', now - UNGRANTED_CLIENT_TTL_MS - 1);
    await registerClient('stale', now - UNGRANTED_CLIENT_TTL_MS - 1);
    await registerClient('fresh', now - 1000);
    const grant = await upsertGrant(harness.prisma, {
      userId: harness.aliceOwner.userId,
      clientId: 'granted',
      scopes: ['library:read'],
    });
    const old = await issueTokens(
      harness.prisma,
      grant.id,
      ['library:read'],
      now - ACCESS_TOKEN_TTL_MS - 1
    );
    const live = await issueTokens(harness.prisma, grant.id, ['library:read'], now);

    await sweepExpired(harness.prisma, now);

    const clients = (await harness.prisma.mcpClient.findMany()).map((c) => c.clientId).sort();
    expect(clients).toEqual(['fresh', 'granted']);
    expect(await lookupAccessToken(harness.prisma, old.access_token, now)).toBeNull();
    expect(await lookupAccessToken(harness.prisma, live.access_token, now)).not.toBeNull();
    // The old refresh token outlives its access token (30 d), so it stays.
    expect(await harness.prisma.mcpToken.count()).toBe(3);
  });
});
