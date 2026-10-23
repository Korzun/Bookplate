import type { Reference } from '@apollo/client';
import { useMutation } from '@apollo/client/react';
import { Fragment, useActionState, useCallback, useState } from 'react';

import { Card, CardDivider } from '~/component';
import { Button, ConfirmModal, TextInput } from '~/control';
import { useFragment, type FragmentType } from '~/gql';
import type { ViewerCreateMcpTokenMutation } from '~/gql/graphql';
import {
  McpTokenFragment,
  ViewerCreateMcpTokenDocument,
  ViewerRevokeMcpTokenDocument,
} from '~/graphql/mcp-token';
import { AlertOctagonIcon, CheckIcon } from '~/icon';
import { unwrapResult } from '~/provider/apollo';
import { useToast } from '~/provider/toast';
import { copyToClipboard } from '~/utils';

import { useStyle } from './style';

type CreatePayload = Extract<
  ViewerCreateMcpTokenMutation['viewerCreateMcpToken'],
  { __typename: 'ViewerCreateMcpTokenPayload' }
>;

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
  tokens: readonly FragmentType<typeof McpTokenFragment>[];
}

/**
 * The reader's AI-agent (MCP) access: the endpoint URL, a form to create a
 * named token, and the list of tokens with Revoke.
 *
 * Fetch-free like `ConnectionUrls`: `page/settings` selects this component's
 * fragment inside `UserPageDocument` (one request per screen), and this only
 * renders for a reader — the config admin owns no library, and the server
 * refuses it a token.
 *
 * A new token is shown ONCE, inline, until dismissed: the server stores only
 * its hash. It is held in component state, never in the Apollo cache, so it
 * is gone the moment this card unmounts.
 *
 * Create appends to `Viewer.mcpTokens` and revoke filters it, both via
 * `cache.modify` on the `Viewer` singleton — the `UserRegister` shape.
 */
export const AgentAccess = ({ tokens: tokenRefs }: AgentAccessProps) => {
  const styles = useStyle();
  const showToast = useToast();
  const tokens = useFragment(McpTokenFragment, tokenRefs);
  const endpoint = `${window.location.origin}/mcp`;

  const [label, setLabel] = useState('');
  const [created, setCreated] = useState<{ label: string; token: string } | null>(null);
  const [revoking, setRevoking] = useState<{ id: string; label: string } | null>(null);

  const [runCreate] = useMutation(ViewerCreateMcpTokenDocument);
  const [runRevoke, { loading: revokeLoading }] = useMutation(ViewerRevokeMcpTokenDocument);

  const [, createAction, isCreating] = useActionState(async () => {
    try {
      const { data } = await runCreate({
        variables: { input: { label } },
        update: (cache, { data: mutationData }) => {
          const result = unwrapResult<CreatePayload>(
            mutationData?.viewerCreateMcpToken,
            'ViewerCreateMcpTokenPayload'
          );
          if (result.status !== 'ok') return;
          cache.modify({
            id: cache.identify({ __typename: 'Viewer' }),
            fields: {
              mcpTokens: (existing: readonly Reference[] = [], { toReference }) => {
                const ref = toReference(result.payload.mcpToken);
                return ref ? [...existing, ref] : existing;
              },
            },
          });
        },
      });
      const result = unwrapResult<CreatePayload>(
        data?.viewerCreateMcpToken,
        'ViewerCreateMcpTokenPayload'
      );
      if (result.status === 'ok') {
        setCreated({ label: label.trim(), token: result.payload.token });
        setLabel('');
      } else {
        showToast(result.status === 'error' ? result.message : 'Could not create a token', 'error');
      }
    } catch {
      showToast('Could not create a token', 'error');
    }
    return null;
  }, null);

  const handleLabelChange = useCallback((next: string | undefined) => setLabel(next ?? ''), []);

  const handleConfirmRevoke = useCallback(async () => {
    if (revoking === null) return;
    const { id } = revoking;
    try {
      const { data } = await runRevoke({
        variables: { id },
        update: (cache, { data: mutationData }) => {
          if (mutationData?.viewerRevokeMcpToken !== true) return;
          cache.modify({
            id: cache.identify({ __typename: 'Viewer' }),
            fields: {
              mcpTokens: (existing: readonly Reference[] = [], { readField }) =>
                existing.filter((ref) => readField('id', ref) !== id),
            },
          });
        },
      });
      if (data?.viewerRevokeMcpToken !== true) {
        showToast('Could not revoke that token', 'error');
      } else {
        showToast('Token revoked', 'success');
      }
    } catch {
      showToast('Could not revoke that token', 'error');
    } finally {
      setRevoking(null);
    }
  }, [revoking, runRevoke, showToast]);

  return (
    <Fragment>
      <Card title="AI agents (MCP)">
        <div className={styles.stack}>
          <p className={styles.hint}>
            Let an AI agent such as Claude search your library, edit metadata, and upload or
            download books. Give each agent its own token so you can revoke it on its own.
          </p>
          <CopyRow value={endpoint} label="MCP server URL" />

          {created !== null && (
            <div className={styles.created} role="status">
              <span className={styles.createdTitle}>
                Token for “{created.label}” — copy it now, it won’t be shown again
              </span>
              <CopyRow value={created.token} label="token" />
              <p className={styles.hint}>To add it to Claude Code:</p>
              <CopyRow
                value={`claude mcp add --transport http bookplate ${endpoint} --header "Authorization: Bearer ${created.token}"`}
                label="command"
              />
              <p className={styles.hint}>
                Other MCP clients: add an HTTP server with the URL above and the header{' '}
                <code>Authorization: Bearer &lt;token&gt;</code>.
              </p>
              <Button type="default" radius="card" onClick={() => setCreated(null)}>
                Done
              </Button>
            </div>
          )}

          <form className={styles.form} action={createAction}>
            <TextInput
              name="mcp-token-label"
              value={label}
              onChange={handleLabelChange}
              layout="horizontal"
              label="Agent name"
              placeholder="e.g. Claude on my laptop"
              maxLength={100}
              autoComplete="off"
            />
            <Button
              type="primary"
              radius="card"
              submit
              loading={isCreating}
              disabled={label.trim() === ''}
            >
              {isCreating ? 'Creating…' : 'Create token'}
            </Button>
          </form>

          {tokens.length > 0 && (
            <>
              <CardDivider>Tokens</CardDivider>
              <ul className={styles.list}>
                {tokens.map((token) => (
                  <li key={token.id} className={styles.row}>
                    <div>
                      <span className={styles.name}>{token.label}</span>
                      <span className={styles.meta}>
                        Created {formatDate(token.createdAt)} ·{' '}
                        {token.lastUsedAt === null || token.lastUsedAt === undefined
                          ? 'never used'
                          : `last used ${formatDate(token.lastUsedAt)}`}
                      </span>
                    </div>
                    <Button
                      type="link"
                      danger
                      ariaLabel={`Revoke ${token.label}`}
                      onClick={() => setRevoking({ id: token.id, label: token.label })}
                    >
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </Card>
      <ConfirmModal
        isOpen={revoking !== null}
        icon={AlertOctagonIcon}
        title="Revoke this token?"
        confirmText="Revoke"
        cancelText="Cancel"
        danger
        loading={revokeLoading}
        onConfirm={() => void handleConfirmRevoke()}
        onCancel={() => setRevoking(null)}
      >
        <strong>{revoking?.label}</strong> will lose access to your library immediately, including
        any download or upload links it was given.
      </ConfirmModal>
    </Fragment>
  );
};
