import { useQuery } from '@apollo/client/react';
import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  McpTokenFragmentFragment,
  ViewerCreateMcpTokenMutation,
  ViewerCreateMcpTokenMutationVariables,
  ViewerRevokeMcpTokenMutation,
  ViewerRevokeMcpTokenMutationVariables,
} from '~/gql/graphql';
import { ViewerCreateMcpTokenDocument, ViewerRevokeMcpTokenDocument } from '~/graphql/mcp-token';
import { UserPageDocument } from '~/page/settings';
import { renderWithApollo } from '~/test-utils';

import { AgentAccess } from './index';

const endpoint = `${window.location.origin}/mcp`;

const token = (overrides: Partial<McpTokenFragmentFragment> = {}): McpTokenFragmentFragment => ({
  __typename: 'McpToken',
  id: 't1',
  label: 'Claude on laptop',
  createdAt: '2026-10-01T12:00:00.000Z',
  lastUsedAt: null,
  ...overrides,
});

const createMock = (
  label: string
): MockedResponse<ViewerCreateMcpTokenMutation, ViewerCreateMcpTokenMutationVariables> => ({
  request: { query: ViewerCreateMcpTokenDocument, variables: { input: { label } } },
  result: {
    data: {
      __typename: 'Mutation',
      viewerCreateMcpToken: {
        __typename: 'ViewerCreateMcpTokenPayload',
        token: 'bpmcp_secretvalue',
        mcpToken: token({ id: 't-new', label }),
      },
    },
  },
});

const revokeMock = (
  id: string
): MockedResponse<ViewerRevokeMcpTokenMutation, ViewerRevokeMcpTokenMutationVariables> => ({
  request: { query: ViewerRevokeMcpTokenDocument, variables: { id } },
  result: { data: { __typename: 'Mutation', viewerRevokeMcpToken: true } },
});

/**
 * Reads the tokens through `UserPageDocument`, exactly as `page/settings`
 * does, so the cache writes the mutations make show up in what renders.
 */
const FromCache = () => {
  const { data } = useQuery(UserPageDocument, { fetchPolicy: 'cache-only' });
  return <AgentAccess tokens={data?.viewer.mcpTokens ?? []} />;
};

function renderCard(tokens: McpTokenFragmentFragment[], mocks: MockedResponse[] = []) {
  const rendered = renderWithApollo(<FromCache />, { mocks });
  rendered.client.writeQuery({
    query: UserPageDocument,
    data: { __typename: 'Query', viewer: { __typename: 'Viewer', devices: [], mcpTokens: tokens } },
  });
  // `TextInput` does not associate its label with the input, so the field is
  // found by name, as `user-register`'s tests do.
  const labelInput = () =>
    rendered.container.querySelector('input[name="mcp-token-label"]') as HTMLInputElement;
  return { ...rendered, labelInput };
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
  it('shows the MCP endpoint and each token with when it was last used', async () => {
    renderCard([
      token(),
      token({ id: 't2', label: 'Cursor', lastUsedAt: '2026-10-20T09:00:00.000Z' }),
    ]);

    expect(await screen.findByText(endpoint)).toBeInTheDocument();
    expect(screen.getByText('Claude on laptop')).toBeInTheDocument();
    expect(screen.getByText(/never used/)).toBeInTheDocument();
    expect(screen.getByText(/last used/)).toBeInTheDocument();
  });

  it('keeps Create disabled until the agent has a name', async () => {
    const user = userEvent.setup();
    const { labelInput } = renderCard([]);
    const button = await screen.findByRole('button', { name: 'Create token' });

    expect(button).toBeDisabled();
    await user.type(labelInput(), 'Claude');
    expect(button).toBeEnabled();
  });

  it('creates a token, shows it once with a ready-made command, and lists it', async () => {
    const user = userEvent.setup();
    const { labelInput } = renderCard([], [createMock('Claude')]);

    await screen.findByRole('button', { name: 'Create token' });
    await user.type(labelInput(), 'Claude');
    await user.click(screen.getByRole('button', { name: 'Create token' }));

    const shown = await screen.findByRole('status');
    expect(within(shown).getByText('bpmcp_secretvalue')).toBeInTheDocument();
    expect(
      within(shown).getByText(
        `claude mcp add --transport http bookplate ${endpoint} --header "Authorization: Bearer bpmcp_secretvalue"`
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke Claude' })).toBeInTheDocument();

    await user.click(within(shown).getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('bpmcp_secretvalue')).not.toBeInTheDocument();
  });

  it('revokes a token after confirmation and drops it from the list', async () => {
    const user = userEvent.setup();
    renderCard([token()], [revokeMock('t1')]);

    await user.click(await screen.findByRole('button', { name: 'Revoke Claude on laptop' }));
    // The confirm modal's button; the dialog is not "open" under jsdom, so
    // its contents are only reachable with `hidden: true`.
    await user.click(screen.getByRole('button', { name: 'Revoke', hidden: true }));

    await waitFor(() => expect(screen.queryByText('Claude on laptop')).not.toBeInTheDocument());
  });
});
