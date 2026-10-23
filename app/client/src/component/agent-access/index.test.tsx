import { useQuery } from '@apollo/client/react';
import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  McpConnectionFragmentFragment,
  ViewerDisconnectMcpConnectionMutation,
  ViewerDisconnectMcpConnectionMutationVariables,
} from '~/gql/graphql';
import { ViewerDisconnectMcpConnectionDocument } from '~/graphql/mcp-connection';
import { UserPageDocument } from '~/page/settings';
import { renderWithApollo } from '~/test-utils';

import { AgentAccess } from './index';

const endpoint = `${window.location.origin}/mcp`;

const connection = (
  overrides: Partial<McpConnectionFragmentFragment> = {}
): McpConnectionFragmentFragment => ({
  __typename: 'McpConnection',
  id: 'g1',
  clientName: 'Claude',
  createdAt: '2026-10-01T12:00:00.000Z',
  lastUsedAt: null,
  ...overrides,
});

const disconnectMock = (
  id: string
): MockedResponse<
  ViewerDisconnectMcpConnectionMutation,
  ViewerDisconnectMcpConnectionMutationVariables
> => ({
  request: { query: ViewerDisconnectMcpConnectionDocument, variables: { id } },
  result: { data: { __typename: 'Mutation', viewerDisconnectMcpConnection: true } },
});

/**
 * Reads the connections through `UserPageDocument`, exactly as `page/settings`
 * does, so the cache write the disconnect makes shows up in what renders.
 */
const FromCache = () => {
  const { data } = useQuery(UserPageDocument, { fetchPolicy: 'cache-only' });
  return <AgentAccess connections={data?.viewer.mcpConnections ?? []} />;
};

function renderCard(connections: McpConnectionFragmentFragment[], mocks: MockedResponse[] = []) {
  const rendered = renderWithApollo(<FromCache />, { mocks });
  rendered.client.writeQuery({
    query: UserPageDocument,
    data: {
      __typename: 'Query',
      viewer: { __typename: 'Viewer', devices: [], mcpConnections: connections },
    },
  });
  return rendered;
}

beforeAll(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = () => {};
  HTMLDialogElement.prototype.close = () => {};
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AgentAccess', () => {
  it('shows the MCP URL and a ready-made Claude Code command', async () => {
    renderCard([]);
    expect(await screen.findByText(endpoint)).toBeInTheDocument();
    expect(
      screen.getByText(`claude mcp add --transport http bookplate ${endpoint}`)
    ).toBeInTheDocument();
    expect(screen.queryByText('Connected agents')).not.toBeInTheDocument();
  });

  it('lists connected agents with when each was last used', async () => {
    renderCard([
      connection(),
      connection({ id: 'g2', clientName: 'Cursor', lastUsedAt: '2026-10-20T09:00:00.000Z' }),
    ]);

    expect(await screen.findByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('Cursor')).toBeInTheDocument();
    expect(screen.getByText(/not used yet/)).toBeInTheDocument();
    expect(screen.getByText(/last used/)).toBeInTheDocument();
  });

  it('copies the URL', async () => {
    const user = userEvent.setup();
    renderCard([]);
    await user.click(await screen.findByRole('button', { name: 'Copy MCP server URL' }));
    // `userEvent.setup()` installs its own clipboard, so read back from it.
    expect(await navigator.clipboard.readText()).toBe(endpoint);
  });

  it('disconnects an agent after confirmation and drops it from the list', async () => {
    const user = userEvent.setup();
    renderCard([connection()], [disconnectMock('g1')]);

    await user.click(await screen.findByRole('button', { name: 'Disconnect Claude' }));
    // The confirm modal's button; the dialog is not "open" under jsdom, so
    // its contents are only reachable with `hidden: true`.
    await user.click(screen.getByRole('button', { name: 'Disconnect', hidden: true }));

    await waitFor(() => expect(screen.queryByText('Claude')).not.toBeInTheDocument());
    expect(within(document.body).queryByText('Connected agents')).not.toBeInTheDocument();
  });
});
