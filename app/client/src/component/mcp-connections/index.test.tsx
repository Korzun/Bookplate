import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { makeFragmentData } from '~/gql';
import type {
  McpConnectionFragmentFragment,
  ViewerRevokeMcpConnectionMutation,
  ViewerRevokeMcpConnectionMutationVariables,
} from '~/gql/graphql';
import {
  McpConnectionFragment,
  McpConnectionsFragment,
  ViewerRevokeMcpConnectionDocument,
} from '~/graphql/mcp';
import { renderWithApollo } from '~/test-utils';

import { McpConnections } from './index';

// ConfirmModal renders a native <dialog>, whose showModal/close jsdom does
// not implement — same shim `component/sync-password`'s test installs.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

const connection = (overrides: Partial<McpConnectionFragmentFragment> = {}) => ({
  __typename: 'McpConnection' as const,
  ...makeFragmentData(
    {
      __typename: 'McpConnection' as const,
      id: overrides.id ?? 'grant-1',
      clientName: overrides.clientName ?? 'Claude',
      clientUri: overrides.clientUri === undefined ? 'https://claude.ai' : overrides.clientUri,
      logoUri: overrides.logoUri ?? null,
      scopes: overrides.scopes ?? ['library:read', 'library:write'],
      createdAt: overrides.createdAt ?? '2026-10-20T10:00:00.000Z',
      lastUsedAt: overrides.lastUsedAt === undefined ? null : overrides.lastUsedAt,
    },
    McpConnectionFragment
  ),
});

const viewer = (opts: { enabled?: boolean; connections?: ReturnType<typeof connection>[] }) =>
  makeFragmentData(
    {
      __typename: 'Viewer' as const,
      mcpEnabled: opts.enabled ?? true,
      mcpUrl: (opts.enabled ?? true) ? 'https://books.example/mcp' : null,
      mcpConnections: opts.connections ?? [],
    },
    McpConnectionsFragment
  );

const revokeMock = (
  id: string,
  onCalled: () => void
): MockedResponse<
  ViewerRevokeMcpConnectionMutation,
  ViewerRevokeMcpConnectionMutationVariables
> => ({
  request: { query: ViewerRevokeMcpConnectionDocument, variables: { id } },
  result: () => {
    onCalled();
    return { data: { __typename: 'Mutation', viewerRevokeMcpConnection: true } };
  },
});

describe('McpConnections', () => {
  it('renders nothing when the install has no MCP server (readers cannot change that)', () => {
    // The providers render their own chrome (toast region), so assert on the
    // card rather than on an empty container.
    renderWithApollo(<McpConnections viewer={viewer({ enabled: false })} />);
    expect(screen.queryByText('AI assistants')).not.toBeInTheDocument();
    expect(screen.queryByText(/public_url/)).not.toBeInTheDocument();
  });

  it('renders nothing until the viewer has loaded', () => {
    renderWithApollo(<McpConnections viewer={undefined} />);
    expect(screen.queryByText('AI assistants')).not.toBeInTheDocument();
  });

  it('shows the MCP URL and the empty state when nothing is connected', () => {
    renderWithApollo(<McpConnections viewer={viewer({})} />);
    expect(screen.getByText('https://books.example/mcp')).toBeInTheDocument();
    expect(screen.getByText('No assistants connected yet.')).toBeInTheDocument();
  });

  it('lists each connection with its access level and dates', () => {
    renderWithApollo(
      <McpConnections
        viewer={viewer({
          connections: [
            connection({ id: 'g1', clientName: 'Claude' }),
            connection({
              id: 'g2',
              clientName: 'Claude Code',
              clientUri: null,
              scopes: ['library:read'],
              lastUsedAt: '2026-10-23T08:00:00.000Z',
            }),
          ],
        })}
      />
    );
    const claude = screen.getByRole('link', { name: 'Claude' });
    expect(claude).toHaveAttribute('href', 'https://claude.ai');
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Claude Code' })).not.toBeInTheDocument();
    expect(screen.getByText('Read & write')).toBeInTheDocument();
    expect(screen.getByText('Read only')).toBeInTheDocument();
    expect(screen.getAllByText(/Never used/)).toHaveLength(1);
    expect(screen.getAllByText(/Last used/)).toHaveLength(1);
    expect(screen.getAllByText(/^Connected /)).toHaveLength(2);
  });

  it('disconnects after confirmation and drops the row', async () => {
    const user = userEvent.setup();
    const called = vi.fn();
    renderWithApollo(
      <McpConnections
        viewer={viewer({
          connections: [connection({ id: 'g1', clientName: 'Claude' })],
        })}
      />,
      { mocks: [revokeMock('g1', called)] }
    );

    await user.click(screen.getByRole('button', { name: 'Disconnect Claude' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Disconnect Claude?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => expect(called).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Disconnect Claude' })).not.toBeInTheDocument()
    );
    expect(screen.getByText('No assistants connected yet.')).toBeInTheDocument();
  });

  it('keeps the row and toasts when the mutation fails', async () => {
    const user = userEvent.setup();
    renderWithApollo(
      <McpConnections
        viewer={viewer({
          connections: [connection({ id: 'g1', clientName: 'Claude' })],
        })}
      />,
      {
        mocks: [
          {
            request: { query: ViewerRevokeMcpConnectionDocument, variables: { id: 'g1' } },
            error: new Error('boom'),
          },
        ],
      }
    );
    await user.click(screen.getByRole('button', { name: 'Disconnect Claude' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Disconnect' })
    );
    expect(await screen.findByText('Could not disconnect that assistant')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect Claude' })).toBeInTheDocument();
  });
});
