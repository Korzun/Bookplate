import type { MockedResponse } from '@apollo/client/testing';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { McpStatusQuery } from '~/gql/graphql';
import { McpStatusDocument } from '~/graphql/mcp';
import { renderWithApollo } from '~/test-utils';

import { McpSetup } from './index';

const statusMock = (enabled: boolean): MockedResponse<McpStatusQuery> => ({
  request: { query: McpStatusDocument },
  result: {
    data: {
      __typename: 'Query',
      viewer: {
        __typename: 'Viewer',
        mcpEnabled: enabled,
        mcpUrl: enabled ? 'https://books.example/mcp' : null,
      },
    },
  },
});

describe('McpSetup', () => {
  it('tells the admin what to configure when MCP is off', async () => {
    renderWithApollo(<McpSetup />, {
      mocks: [statusMock(false)],
      user: { username: 'admin', isAdmin: true },
    });
    expect(await screen.findByText('AI assistants')).toBeInTheDocument();
    expect(screen.getByText(/Not enabled/)).toBeInTheDocument();
    expect(screen.getByText('public_url')).toBeInTheDocument();
    expect(screen.getByText(/Configuration tab/)).toBeInTheDocument();
    expect(screen.queryByText(/books\.example/)).not.toBeInTheDocument();
  });

  it('shows the connection URL once MCP is on', async () => {
    renderWithApollo(<McpSetup />, {
      mocks: [statusMock(true)],
      user: { username: 'admin', isAdmin: true },
    });
    expect(await screen.findByText('https://books.example/mcp')).toBeInTheDocument();
    expect(screen.getByText(/Enabled/)).toBeInTheDocument();
    expect(screen.queryByText(/Configuration tab/)).not.toBeInTheDocument();
  });
});
