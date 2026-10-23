import type { Reference } from '@apollo/client';
import { useMutation } from '@apollo/client/react';
import { Fragment, useCallback, useState } from 'react';

import { Card, CardDivider } from '~/component';
import { Button, ConfirmModal } from '~/control';
import { useFragment, type FragmentType } from '~/gql';
import {
  McpConnectionFragment,
  ViewerDisconnectMcpConnectionDocument,
} from '~/graphql/mcp-connection';
import { AlertOctagonIcon, CheckIcon } from '~/icon';
import { useToast } from '~/provider/toast';
import { copyToClipboard } from '~/utils';

import { useStyle } from './style';

/** A read-only value with a Copy button — the `sync-password` pill. */
const CopyRow = ({ value, label }: { value: string; label: string }) => {
  const styles = useStyle();
  const showToast = useToast();
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    if (!(await copyToClipboard(value))) {
      showToast(`Failed to copy the ${label}`, 'error');
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [label, showToast, value]);

  return (
    <div className={styles.pill}>
      <span className={styles.mono}>{value}</span>
      <Button
        type="default"
        radius="card"
        success={copied}
        prefix={copied ? CheckIcon : undefined}
        ariaLabel={`Copy ${label}`}
        onClick={() => void handleCopy()}
      >
        {copied ? 'Copied!' : 'Copy'}
      </Button>
    </div>
  );
};

const formatDate = (iso: string): string => new Date(iso).toLocaleDateString();

interface AgentAccessProps {
  connections: readonly FragmentType<typeof McpConnectionFragment>[];
}

/**
 * The reader's AI-agent (MCP) access: the endpoint URL to give an agent, and
 * the agents already connected, each with Disconnect.
 *
 * There is nothing to create here. An agent connects itself over OAuth: told
 * this URL, it asks the reader to sign in to Bookplate and approve it
 * (`page/oauth-consent`), and appears in this list once they do.
 *
 * Fetch-free like `ConnectionUrls`: `page/settings` selects this component's
 * fragment inside `UserPageDocument` (one request per screen), and this only
 * renders for a reader — the config admin owns no library, and the server
 * refuses to connect one to it.
 *
 * Disconnect filters `Viewer.mcpConnections` via `cache.modify` on the
 * `Viewer` singleton — the `UserRegister` shape.
 */
export const AgentAccess = ({ connections: connectionRefs }: AgentAccessProps) => {
  const styles = useStyle();
  const showToast = useToast();
  const connections = useFragment(McpConnectionFragment, connectionRefs);
  const endpoint = `${window.location.origin}/mcp`;

  const [disconnecting, setDisconnecting] = useState<{ id: string; name: string } | null>(null);
  const [runDisconnect, { loading }] = useMutation(ViewerDisconnectMcpConnectionDocument);

  const handleConfirm = useCallback(async () => {
    if (disconnecting === null) return;
    const { id } = disconnecting;
    try {
      const { data } = await runDisconnect({
        variables: { id },
        update: (cache, { data: mutationData }) => {
          if (mutationData?.viewerDisconnectMcpConnection !== true) return;
          cache.modify({
            id: cache.identify({ __typename: 'Viewer' }),
            fields: {
              mcpConnections: (existing: readonly Reference[] = [], { readField }) =>
                existing.filter((ref) => readField('id', ref) !== id),
            },
          });
        },
      });
      if (data?.viewerDisconnectMcpConnection === true) {
        showToast('Agent disconnected', 'success');
      } else {
        showToast('Could not disconnect that agent', 'error');
      }
    } catch {
      showToast('Could not disconnect that agent', 'error');
    } finally {
      setDisconnecting(null);
    }
  }, [disconnecting, runDisconnect, showToast]);

  return (
    <Fragment>
      <Card title="AI agents (MCP)">
        <div className={styles.stack}>
          <p className={styles.hint}>
            Let an AI agent such as Claude search your library, edit metadata, and upload or
            download books. Add this URL to the agent as a remote MCP server; it will ask you to
            sign in here and approve it.
          </p>
          <CopyRow value={endpoint} label="MCP server URL" />
          <p className={styles.hint}>For Claude Code:</p>
          <CopyRow
            value={`claude mcp add --transport http bookplate ${endpoint}`}
            label="command"
          />

          {connections.length > 0 && (
            <>
              <CardDivider>Connected agents</CardDivider>
              <ul className={styles.list}>
                {connections.map((connection) => (
                  <li key={connection.id} className={styles.row}>
                    <div>
                      <span className={styles.name}>{connection.clientName}</span>
                      <span className={styles.meta}>
                        Connected {formatDate(connection.createdAt)} ·{' '}
                        {connection.lastUsedAt === null || connection.lastUsedAt === undefined
                          ? 'not used yet'
                          : `last used ${formatDate(connection.lastUsedAt)}`}
                      </span>
                    </div>
                    <Button
                      type="link"
                      danger
                      ariaLabel={`Disconnect ${connection.clientName}`}
                      onClick={() =>
                        setDisconnecting({ id: connection.id, name: connection.clientName })
                      }
                    >
                      Disconnect
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </Card>
      <ConfirmModal
        isOpen={disconnecting !== null}
        icon={AlertOctagonIcon}
        title="Disconnect this agent?"
        confirmText="Disconnect"
        cancelText="Cancel"
        danger
        loading={loading}
        onConfirm={() => void handleConfirm()}
        onCancel={() => setDisconnecting(null)}
      >
        <strong>{disconnecting?.name}</strong> will lose access to your library immediately,
        including any download or upload links it was given. It can only reconnect if you approve it
        again.
      </ConfirmModal>
    </Fragment>
  );
};
