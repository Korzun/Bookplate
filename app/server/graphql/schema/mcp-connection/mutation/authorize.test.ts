import { issueTokens, lookupAccessToken, peekAuthorizationCode } from '../../../../mcp/tokens';
import { createHarness, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.mcpClient.create({
    data: {
      clientId: 'claude',
      clientIdIssuedAt: 1,
      metadata: JSON.stringify({
        client_id: 'claude',
        client_name: 'Claude',
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      }),
      createdAt: Date.now(),
    },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

const MUTATION = `
  mutation Authorize($input: McpAuthorizeInput!) {
    mcpAuthorize(input: $input) {
      __typename
      ... on McpAuthorizePayload { redirectUrl }
      ... on InvalidInputError { message }
    }
  }
`;

const baseInput = {
  clientId: 'claude',
  redirectUri: 'https://claude.ai/api/mcp/auth_callback',
  codeChallenge: 'challenge-123',
  state: 'st',
  scope: null as string | null,
  resource: 'https://books.example/mcp',
  approve: true,
  readOnly: false,
};

type Result = { mcpAuthorize: { __typename: string; redirectUrl?: string; message?: string } };

const authorize = async (input: Partial<typeof baseInput>, viewer = harness.aliceViewer) => {
  const result = await harness.execute(MUTATION, {
    viewer,
    variables: { input: { ...baseInput, ...input } },
  });
  expect(result.errors).toBeUndefined();
  return (result.data as Result).mcpAuthorize;
};

describe('mcpAuthorize', () => {
  it('approves: writes a grant and a code, and returns the redirect with code and state', async () => {
    const out = await authorize({});
    expect(out.__typename).toBe('McpAuthorizePayload');
    const url = new URL(out.redirectUrl!);
    expect(url.origin + url.pathname).toBe('https://claude.ai/api/mcp/auth_callback');
    expect(url.searchParams.get('state')).toBe('st');
    const code = url.searchParams.get('code')!;
    expect(await peekAuthorizationCode(harness.prisma, code)).toEqual({
      codeChallenge: 'challenge-123',
      clientId: 'claude',
    });
    const grant = await harness.prisma.mcpGrant.findUniqueOrThrow({
      where: { userId_clientId: { userId: harness.aliceOwner.userId, clientId: 'claude' } },
    });
    expect(grant.scopes).toBe('library:read library:write');
    const client = await harness.prisma.mcpClient.findUniqueOrThrow({
      where: { clientId: 'claude' },
    });
    expect(client.lastGrantedAt).not.toBeNull();
  });

  it('honours the read-only switch and a requested scope', async () => {
    await authorize({ readOnly: true });
    let grant = await harness.prisma.mcpGrant.findUniqueOrThrow({
      where: { userId_clientId: { userId: harness.aliceOwner.userId, clientId: 'claude' } },
    });
    expect(grant.scopes).toBe('library:read');

    await authorize({ scope: 'library:write' });
    grant = await harness.prisma.mcpGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(grant.scopes).toBe('library:write');
  });

  it('approving twice keeps one connection and kills the earlier tokens', async () => {
    await authorize({});
    const grant = await harness.prisma.mcpGrant.findFirstOrThrow();
    const tokens = await issueTokens(harness.prisma, grant.id, ['library:read']);

    await authorize({});

    expect(await harness.prisma.mcpGrant.count()).toBe(1);
    expect(await lookupAccessToken(harness.prisma, tokens.access_token)).toBeNull();
    const listed = await harness.execute(`{ viewer { mcpConnections { id } } }`);
    expect(
      (listed.data as { viewer: { mcpConnections: unknown[] } }).viewer.mcpConnections
    ).toHaveLength(1);
  });

  it('denies: redirects with access_denied and writes nothing', async () => {
    const out = await authorize({ approve: false });
    const url = new URL(out.redirectUrl!);
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('code')).toBeNull();
    expect(await harness.prisma.mcpGrant.count()).toBe(0);
  });

  it('refuses an unknown client, an unregistered redirect URI, and the admin', async () => {
    expect(await authorize({ clientId: 'ghost' })).toEqual({
      __typename: 'InvalidInputError',
      message: 'Unknown client',
    });
    expect(await authorize({ redirectUri: 'https://evil.example/cb' })).toEqual({
      __typename: 'InvalidInputError',
      message: 'Unregistered redirect URI',
    });
    expect(await authorize({ redirectUri: 'https://evil.example/cb', approve: false })).toEqual({
      __typename: 'InvalidInputError',
      message: 'Unregistered redirect URI',
    });
    expect(await authorize({}, harness.adminViewer)).toEqual({
      __typename: 'InvalidInputError',
      message: 'The admin account has no library to connect',
    });
    expect(await harness.prisma.mcpGrant.count()).toBe(0);
  });

  it('refuses when MCP is not enabled on this install', async () => {
    await harness.cleanup();
    harness = await createHarness({ mcpUrl: null });
    await harness.prisma.mcpClient.create({
      data: {
        clientId: 'claude',
        clientIdIssuedAt: 1,
        metadata: JSON.stringify({ client_id: 'claude', redirect_uris: [baseInput.redirectUri] }),
        createdAt: Date.now(),
      },
    });
    expect(await authorize({})).toEqual({
      __typename: 'InvalidInputError',
      message: 'MCP is not enabled',
    });
  });

  it('allows a loopback redirect on any port, as RFC 8252 requires', async () => {
    await harness.prisma.mcpClient.create({
      data: {
        clientId: 'cli',
        clientIdIssuedAt: 1,
        metadata: JSON.stringify({ client_id: 'cli', redirect_uris: ['http://localhost:1234/cb'] }),
        createdAt: Date.now(),
      },
    });
    const out = await authorize({ clientId: 'cli', redirectUri: 'http://localhost:9999/cb' });
    expect(out.__typename).toBe('McpAuthorizePayload');
  });
});
