import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  McpAuthorizeMutation,
  McpAuthorizeMutationVariables,
  McpClientQuery,
  McpClientQueryVariables,
} from '~/gql/graphql';
import { McpAuthorizeDocument, McpClientDocument } from '~/graphql/mcp';
import { renderWithApollo } from '~/test-utils';

import { ConnectPage } from './index';

const PARAMS =
  '?client_id=claude&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&code_challenge=abc&state=st&scope=library%3Aread%20library%3Awrite&resource=https%3A%2F%2Fbooks.example%2Fmcp';

const clientMock = (found = true): MockedResponse<McpClientQuery, McpClientQueryVariables> => ({
  request: { query: McpClientDocument, variables: { clientId: 'claude' } },
  result: {
    data: {
      __typename: 'Query',
      mcpClient: found
        ? {
            __typename: 'McpClientInfo',
            clientId: 'claude',
            clientName: 'Claude',
            clientUri: 'https://claude.ai',
          }
        : null,
    },
  },
});

const authorizeMock = (
  input: McpAuthorizeMutationVariables['input'],
  result: McpAuthorizeMutation['mcpAuthorize']
): MockedResponse<McpAuthorizeMutation, McpAuthorizeMutationVariables> => ({
  request: { query: McpAuthorizeDocument, variables: { input } },
  result: { data: { __typename: 'Mutation', mcpAuthorize: result } },
});

const baseInput = {
  clientId: 'claude',
  redirectUri: 'https://claude.ai/cb',
  codeChallenge: 'abc',
  state: 'st',
  scope: 'library:read library:write',
  resource: 'https://books.example/mcp',
};

const render = (mocks: MockedResponse[], search = PARAMS, isAdmin = false) =>
  renderWithApollo(<ConnectPage />, {
    mocks,
    initialEntries: [`/connect${search}`],
    user: { username: isAdmin ? 'admin' : 'alice', isAdmin },
  });

describe('ConnectPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows an invalid-link card when the required params are missing', () => {
    render([], '?client_id=claude');
    expect(screen.getByText('This connection link is invalid.')).toBeInTheDocument();
  });

  it('refuses the admin account', () => {
    render([clientMock()], PARAMS, true);
    expect(
      screen.getByText('The admin account has no library to connect. Sign in as a reader.')
    ).toBeInTheDocument();
  });

  it('shows the invalid-link card when the client is unknown', async () => {
    render([clientMock(false)]);
    expect(await screen.findByText('This connection link is invalid.')).toBeInTheDocument();
  });

  it('names the client and lists what it may do; read-only hides the write bullet', async () => {
    const user = userEvent.setup();
    render([clientMock()]);
    expect(await screen.findByText('Connect Claude?')).toBeInTheDocument();
    expect(screen.getByText(/Search your library/)).toBeInTheDocument();
    expect(screen.getByText(/Edit metadata/)).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Read only' }));
    expect(screen.queryByText(/Edit metadata/)).not.toBeInTheDocument();
    expect(screen.getByText(/Search your library/)).toBeInTheDocument();
  });

  it('approves and sends the browser to the redirect URL', async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    render([
      clientMock(),
      authorizeMock(
        { ...baseInput, approve: true, readOnly: false },
        { __typename: 'McpAuthorizePayload', redirectUrl: 'https://claude.ai/cb?code=xyz&state=st' }
      ),
    ]);
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://claude.ai/cb?code=xyz&state=st')
    );
  });

  it('approves read-only when the switch is on', async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    render([
      clientMock(),
      authorizeMock(
        { ...baseInput, approve: true, readOnly: true },
        { __typename: 'McpAuthorizePayload', redirectUrl: 'https://claude.ai/cb?code=ro' }
      ),
    ]);
    await user.click(await screen.findByRole('switch', { name: 'Read only' }));
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://claude.ai/cb?code=ro'));
  });

  it('denies through the server too', async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    render([
      clientMock(),
      authorizeMock(
        { ...baseInput, approve: false, readOnly: false },
        {
          __typename: 'McpAuthorizePayload',
          redirectUrl: 'https://claude.ai/cb?error=access_denied',
        }
      ),
    ]);
    await user.click(await screen.findByRole('button', { name: 'Deny' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://claude.ai/cb?error=access_denied')
    );
  });

  it('toasts a refusal and stays put', async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    render([
      clientMock(),
      authorizeMock(
        { ...baseInput, approve: true, readOnly: false },
        { __typename: 'InvalidInputError', message: 'Unregistered redirect URI' }
      ),
    ]);
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Unregistered redirect URI')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });
});
