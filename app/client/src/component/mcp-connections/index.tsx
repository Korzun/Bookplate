import { useApolloClient, useMutation } from '@apollo/client/react';
import { useCallback, useState } from 'react';

import { Card } from '~/component';
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

import { McpClientsModal } from './clients-modal';
import { useStyle } from './style';

export type McpConnectionsProps = {
  /**
   * `page/settings` passes `data?.viewer` from `UserPageDocument`, which
   * spreads `McpConnectionsFragment`; undefined until that query resolves.
   */
  viewer: FragmentType<typeof McpConnectionsFragment> | undefined;
};

/**
 * The "AI assistants" settings card: the URL to paste into an assistant as
 * a custom MCP connector, and a "clients" link in the header that opens the
 * list of every assistant this account has approved, each with a Disconnect.
 *
 * Disconnect is immediate on the server (the grant and its tokens are
 * deleted), so the row is dropped locally the moment the mutation resolves
 * and `UserPageDocument` is refetched to make the cache agree. `removed` is
 * the one piece of list state and holds only ids whose revoke succeeded in
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

  const [listOpen, setListOpen] = useState(false);
  const [pending, setPending] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());

  const closeList = useCallback(() => setListOpen(false), []);

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

  // Nothing at all unless the install publishes an MCP server: a reader
  // cannot set `public_url`, so a card telling them to would only confuse.
  // The admin's `component/mcp-setup` card carries that explanation.
  if (viewer === undefined || !viewer.mcpEnabled || viewer.mcpUrl === null) return null;

  return (
    <>
      <Card
        title="AI assistants"
        headerAction={
          <Button type="link" onClick={() => setListOpen(true)}>
            Clients
          </Button>
        }
      >
        <div className={style.stack}>
          <UrlRow url={viewer.mcpUrl} />
        </div>
      </Card>
      <McpClientsModal
        isOpen={listOpen}
        clients={visible}
        onClose={closeList}
        onDisconnect={setPending}
      />
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
