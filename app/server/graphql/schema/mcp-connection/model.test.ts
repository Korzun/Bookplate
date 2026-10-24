import { issueTokens, upsertGrant } from '../../../mcp/tokens';
import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

afterEach(async () => {
  await harness.cleanup();
});

const registerClient = (clientId: string, name?: string) =>
  harness.prisma.mcpClient.create({
    data: {
      clientId,
      clientIdIssuedAt: 1,
      metadata: JSON.stringify({
        client_id: clientId,
        redirect_uris: ['https://c.example/cb'],
        ...(name === undefined ? {} : { client_name: name, client_uri: 'https://c.example' }),
      }),
      createdAt: Date.now(),
    },
  });

describe('Viewer.mcpEnabled / mcpUrl', () => {
  it('reports the configured MCP URL', async () => {
    harness = await createHarness();
    const result = await harness.execute(`{ viewer { mcpEnabled mcpUrl } }`);
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      viewer: { mcpEnabled: true, mcpUrl: 'https://books.example/mcp' },
    });
  });

  it('reports disabled when public_url does not allow MCP', async () => {
    harness = await createHarness({ mcpUrl: null });
    const result = await harness.execute(`{ viewer { mcpEnabled mcpUrl } }`);
    expect(result.data).toEqual({ viewer: { mcpEnabled: false, mcpUrl: null } });
  });
});

describe('Viewer.mcpConnections', () => {
  it('lists only the viewer’s own grants, with the client’s registered name', async () => {
    harness = await createHarness();
    await registerClient('claude', 'Claude');
    await registerClient('anon');
    await upsertGrant(harness.prisma, {
      userId: harness.aliceOwner.userId,
      clientId: 'claude',
      scopes: ['library:read', 'library:write'],
    });
    await upsertGrant(harness.prisma, {
      userId: harness.aliceOwner.userId,
      clientId: 'anon',
      scopes: ['library:read'],
    });
    await upsertGrant(harness.prisma, {
      userId: harness.bobOwner.userId,
      clientId: 'claude',
      scopes: ['library:read'],
    });

    const result = await harness.execute(
      `{ viewer { mcpConnections { id clientName clientUri logoUri scopes createdAt lastUsedAt } } }`
    );
    expect(result.errors).toBeUndefined();
    const rows = (result.data as { viewer: { mcpConnections: Array<Record<string, unknown>> } })
      .viewer.mcpConnections;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.clientName).sort()).toEqual(['Claude', 'Unnamed client']);
    const claude = rows.find((r) => r.clientName === 'Claude')!;
    expect(claude.clientUri).toBe('https://c.example');
    expect(claude.logoUri).toBeNull();
    expect(claude.scopes).toEqual(['library:read', 'library:write']);
    expect(typeof claude.createdAt).toBe('string');
    expect(claude.lastUsedAt).toBeNull();
  });

  it('is empty for the config admin', async () => {
    harness = await createHarness();
    const result = await harness.execute(`{ viewer { mcpConnections { id } } }`, {
      viewer: harness.adminViewer,
    });
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ viewer: { mcpConnections: [] } });
  });

  it('requires authentication', async () => {
    harness = await createHarness();
    const result = await harness.execute(`{ viewer { mcpConnections { id } } }`, { viewer: null });
    expect(result.errors).toBeDefined();
  });
});

describe('Query.mcpClient', () => {
  it('returns a registered client’s display fields and null for an unknown id', async () => {
    harness = await createHarness();
    await registerClient('claude', 'Claude');
    const found = await harness.execute(
      `{ mcpClient(clientId: "claude") { clientId clientName clientUri logoUri } }`
    );
    expect(found.data).toEqual({
      mcpClient: {
        clientId: 'claude',
        clientName: 'Claude',
        clientUri: 'https://c.example',
        logoUri: null,
      },
    });
    const missing = await harness.execute(`{ mcpClient(clientId: "nope") { clientId } }`);
    expect(missing.data).toEqual({ mcpClient: null });
  });
});

describe('viewerRevokeMcpConnection', () => {
  it('deletes the grant and its tokens, and refuses another reader’s grant', async () => {
    harness = await createHarness();
    await registerClient('claude', 'Claude');
    const alice = await upsertGrant(harness.prisma, {
      userId: harness.aliceOwner.userId,
      clientId: 'claude',
      scopes: ['library:read'],
    });
    const bob = await upsertGrant(harness.prisma, {
      userId: harness.bobOwner.userId,
      clientId: 'claude',
      scopes: ['library:read'],
    });
    await issueTokens(harness.prisma, alice.id, ['library:read']);

    const denied = await harness.execute(`mutation { viewerRevokeMcpConnection(id: "${bob.id}") }`);
    expect(denied.data).toEqual({ viewerRevokeMcpConnection: false });
    expect(await harness.prisma.mcpGrant.count()).toBe(2);

    const ok = await harness.execute(`mutation { viewerRevokeMcpConnection(id: "${alice.id}") }`);
    expect(ok.data).toEqual({ viewerRevokeMcpConnection: true });
    expect(await harness.prisma.mcpGrant.count()).toBe(1);
    expect(await harness.prisma.mcpToken.count()).toBe(0);
  });
});
