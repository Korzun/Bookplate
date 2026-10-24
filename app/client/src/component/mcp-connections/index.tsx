import { useApolloClient, useMutation } from '@apollo/client/react';
import { useCallback, useState } from 'react';

import { Card, Tag } from '~/component';
import { UrlRow } from '~/component/connection-urls';
import { Button, ConfirmModal } from '~/control';
import { type FragmentType, useFragment } from '~/gql';
import {
  McpConnectionFragment,
  McpConnectionsFragment,
  ViewerRevokeMcpConnectionDocument,
} from '~/graphql/mcp';
import { UserPageDocument } from '~/page/settings';
import { useToast } from '~/provider/toast';

import { useStyle } from './style';

export type McpConnectionsProps = {
  /**
   * `page/settings` passes `data?.viewer` from `UserPageDocument`, which
   * spreads `McpConnectionsFragment`; undefined until that query resolves.
   */
  viewer: FragmentType<typeof McpConnectionsFragment> | undefined;
};

const formatDate = (iso: string): string => new Date(iso).toLocaleDateString();

/**
 * The "AI assistants" settings card: the URL to paste into an assistant as
 * a custom MCP connector, and every assistant this account has approved,
 * each with a Disconnect.
 *
 * Disconnect is immediate on the server (the grant and its tokens are
 * deleted), so the row is dropped locally the moment the mutation resolves
 * and `UserPageDocument` is refetched to make the cache agree. `removed` is
 * the one piece of local state and holds only ids whose revoke succeeded in
 * this mount — it cannot go stale against a later prop, because a refetched
 * list never contains them either.
 */
export const McpConnections = ({ viewer: viewerRef }: McpConnectionsProps) => {
  const style = useStyle();
  const showToast = useToast();
  const client = useApolloClient();
  const viewer = useFragment(McpConnectionsFragment, viewerRef);
  const connections = useFragment(McpConnectionFragment, viewer?.mcpConnections ?? []);
  const [revoke] = useMutation(ViewerRevokeMcpConnectionDocument);

  const [pending, setPending] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());

  const handleConfirm = useCallback(async () => {
    if (pending === null) return;
    setBusy(true);
    try {
      await revoke({ variables: { id: pending.id } });
      setRemoved((prev) => new Set([...prev, pending.id]));
      setPending(null);
      // A list removal has to update the field that held the array; a plain
      // eviction would leave stale refs in `viewer.mcpConnections` — same
      // reasoning `component/notification-settings` gives for its remove.
      await client.refetchQueries({ include: [UserPageDocument] });
    } catch {
      showToast('Could not disconnect that assistant', 'error');
    } finally {
      setBusy(false);
    }
  }, [client, pending, revoke, showToast]);

  const visible = connections.filter((c) => !removed.has(c.id));

  return (
    <>
      <Card title="AI assistants">
        <div className={style.stack}>
          <p className={style.lead}>
            Connect Claude or another MCP assistant to search, fix and add books in your library.
          </p>
          {viewer === undefined ? null : !viewer.mcpEnabled || viewer.mcpUrl === null ? (
            <p className={style.hint}>
              Set <code className={style.code}>public_url</code> to an https address in the add-on
              options to enable this.
            </p>
          ) : (
            <>
              <UrlRow url={viewer.mcpUrl} />
              {visible.length === 0 ? (
                <p className={style.hint}>No assistants connected yet.</p>
              ) : (
                <ul className={style.list}>
                  {visible.map((connection) => {
                    const write = connection.scopes.includes('library:write');
                    return (
                      <li key={connection.id} className={style.row}>
                        <div className={style.identity}>
                          <span className={style.nameLine}>
                            {connection.clientUri !== null ? (
                              <a
                                className={style.name}
                                href={connection.clientUri}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {connection.clientName}
                              </a>
                            ) : (
                              <span className={style.name}>{connection.clientName}</span>
                            )}
                            <Tag size="sm">{write ? 'Read & write' : 'Read only'}</Tag>
                          </span>
                          <span className={style.meta}>
                            {`Connected ${formatDate(connection.createdAt)} · ${
                              connection.lastUsedAt === null
                                ? 'Never used'
                                : `Last used ${formatDate(connection.lastUsedAt)}`
                            }`}
                          </span>
                        </div>
                        <Button
                          type="link"
                          danger
                          ariaLabel={`Disconnect ${connection.clientName}`}
                          onClick={() =>
                            setPending({ id: connection.id, name: connection.clientName })
                          }
                        >
                          Disconnect
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </Card>
      <ConfirmModal
        isOpen={pending !== null}
        title={pending === null ? '' : `Disconnect ${pending.name}?`}
        confirmText="Disconnect"
        danger
        loading={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => void handleConfirm()}
      >
        It will lose access immediately. You can connect it again from the assistant.
      </ConfirmModal>
    </>
  );
};
