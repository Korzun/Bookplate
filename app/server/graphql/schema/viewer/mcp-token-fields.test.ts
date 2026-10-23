import { authenticateMcpToken, MAX_MCP_TOKENS_PER_USER } from '../../../services/mcp-token';
import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

const CREATE = `
  mutation Create($label: String!) {
    viewerCreateMcpToken(input: { label: $label }) {
      __typename
      ... on ViewerCreateMcpTokenPayload { token mcpToken { id label createdAt lastUsedAt } }
      ... on InvalidInputError { issues { path message } }
      ... on McpTokenLimitExceededError { limit }
    }
  }
`;
const LIST = `{ viewer { mcpTokens { id label } } }`;
const REVOKE = `mutation Revoke($id: ID!) { viewerRevokeMcpToken(id: $id) }`;

type CreateResult = {
  __typename: string;
  token?: string;
  mcpToken?: { id: string; label: string; createdAt: string; lastUsedAt: string | null };
  issues?: { path: string[]; message: string }[];
  limit?: number;
};

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

async function create(label: string, viewer = harness.aliceViewer): Promise<CreateResult> {
  const result = await harness.execute(CREATE, { viewer, variables: { label } });
  expect(result.errors).toBeUndefined();
  return (result.data as { viewerCreateMcpToken: CreateResult }).viewerCreateMcpToken;
}

async function list(viewer = harness.aliceViewer): Promise<{ id: string; label: string }[]> {
  const result = await harness.execute(LIST, { viewer });
  expect(result.errors).toBeUndefined();
  return (result.data as { viewer: { mcpTokens: { id: string; label: string }[] } }).viewer
    .mcpTokens;
}

describe('agent (MCP) tokens', () => {
  it('creates a working token, shown once, and lists it without the secret', async () => {
    const created = await create('  Claude on laptop  ');

    expect(created.__typename).toBe('ViewerCreateMcpTokenPayload');
    expect(created.mcpToken).toMatchObject({ label: 'Claude on laptop', lastUsedAt: null });
    const identity = await authenticateMcpToken(harness.prisma, created.token!);
    expect(identity?.userId).toBe(harness.aliceOwner.userId);

    expect(await list()).toEqual([{ id: created.mcpToken!.id, label: 'Claude on laptop' }]);
    expect(await list(harness.bobViewer)).toEqual([]);
  });

  it('rejects a blank label', async () => {
    const created = await create('   ');
    expect(created.__typename).toBe('InvalidInputError');
    expect(created.issues?.[0].path).toEqual(['label']);
  });

  it('refuses a token past the per-reader limit', async () => {
    for (let i = 0; i < MAX_MCP_TOKENS_PER_USER; i += 1) await create(`t${i}`);
    const created = await create('one too many');
    expect(created).toMatchObject({
      __typename: 'McpTokenLimitExceededError',
      limit: MAX_MCP_TOKENS_PER_USER,
    });
  });

  it("revokes the viewer's own token, and only their own", async () => {
    const created = await create('Laptop');
    const id = created.mcpToken!.id;

    const asBob = await harness.execute(REVOKE, { viewer: harness.bobViewer, variables: { id } });
    expect(asBob.data).toEqual({ viewerRevokeMcpToken: false });

    const asAlice = await harness.execute(REVOKE, { variables: { id } });
    expect(asAlice.data).toEqual({ viewerRevokeMcpToken: true });
    expect(await authenticateMcpToken(harness.prisma, created.token!)).toBeNull();
    expect(await list()).toEqual([]);
  });

  it('gives the config admin no tokens and refuses to create one', async () => {
    expect(await list(harness.adminViewer)).toEqual([]);
    const result = await harness.execute(CREATE, {
      viewer: harness.adminViewer,
      variables: { label: 'x' },
    });
    expect(result.errors?.[0].extensions?.code).toBe('FORBIDDEN');
  });
});
