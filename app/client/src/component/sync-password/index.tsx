import { useMutation, useQuery } from '@apollo/client/react';
import { Fragment, useCallback, useState } from 'react';

import { Card } from '~/component';
import { Button, ConfirmModal } from '~/control';
import type { UserRegenerateSyncPasswordMutation } from '~/gql/graphql';
import { SyncPasswordDocument, UserRegenerateSyncPasswordDocument } from '~/graphql/user';
import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import { AlertOctagonIcon, CheckIcon, KeyIcon } from '~/icon';
import { unwrapResult } from '~/provider/apollo';
import { useToast } from '~/provider/toast';
import { copyToClipboard } from '~/utils';

import { useStyle } from './style';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated.
type UserRegenerateSyncPasswordPayload = Extract<
  NonNullable<UserRegenerateSyncPasswordMutation['userRegenerateSyncPassword']>,
  { __typename: 'UserRegenerateSyncPasswordPayload' }
>;

/**
 * `useSyncPassword`/`useRegenerateSyncPassword` are inlined directly here
 * rather than kept as `provider/user` hooks — this card is their only
 * caller. `Viewer.syncPassword` resolves to a clean `null` for the
 * config-based admin (no `authScopes`, no accompanying `FORBIDDEN` error),
 * so there is no `skip` gate to guard the read with; `page/user` also only
 * ever mounts `SyncPassword` for a non-admin viewer.
 *
 * The mutation takes the viewer's own `User` global ID (`userId: ID!`), read
 * from `viewer.user { id }` — `ViewerBootstrapDocument` already selects it,
 * so this `useQuery` call is ordinarily a cache hit, not a second network
 * round trip. `userRegenerateSyncPassword` returns `{ syncPassword, user }`,
 * but the field the UI reads is `Viewer.syncPassword` — a different place
 * entirely — so `update` writes the new value directly onto the `Viewer`
 * singleton via `cache.modify` + `cache.identify({ __typename: 'Viewer' })`.
 */
export const SyncPassword = () => {
  const styles = useStyle();
  const {
    data: syncData,
    loading: loadingFetch,
    error: fetchError,
  } = useQuery(SyncPasswordDocument);
  const { data: viewerData } = useQuery(ViewerBootstrapDocument);
  const userId = viewerData?.viewer.user?.id;
  const [runRegenerate, { loading: regenerating }] = useMutation(
    UserRegenerateSyncPasswordDocument
  );
  const showToast = useToast();

  const [newPassword, setNewPassword] = useState<string | null>(null);
  const displayPassword = newPassword ?? syncData?.viewer.syncPassword ?? null;

  const [showConfirm, setShowConfirm] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!displayPassword) return;
    const ok = await copyToClipboard(displayPassword);
    if (!ok) {
      showToast('Failed to copy device password', 'error');
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [displayPassword, showToast]);

  const handleRegenerateClick = useCallback(() => setShowConfirm(true), []);
  const handleCancel = useCallback(() => setShowConfirm(false), []);
  const handleConfirm = useCallback(async () => {
    setShowConfirm(false);
    if (!userId) {
      showToast('Failed to regenerate device password', 'error');
      return;
    }
    try {
      const { data } = await runRegenerate({
        variables: { input: { userId } },
        update: (cache, { data: mutationData }) => {
          const result = unwrapResult<UserRegenerateSyncPasswordPayload>(
            mutationData?.userRegenerateSyncPassword,
            'UserRegenerateSyncPasswordPayload'
          );
          if (result.status !== 'ok') return;

          cache.modify({
            id: cache.identify({ __typename: 'Viewer' }),
            fields: { syncPassword: () => result.payload.syncPassword },
          });
        },
      });

      const result = unwrapResult<UserRegenerateSyncPasswordPayload>(
        data?.userRegenerateSyncPassword,
        'UserRegenerateSyncPasswordPayload'
      );
      if (result.status !== 'ok') {
        showToast('Failed to regenerate device password', 'error');
        return;
      }

      setNewPassword(result.payload.syncPassword);
      showToast('Device password regenerated', 'success');
    } catch {
      showToast('Failed to regenerate device password', 'error');
    }
  }, [runRegenerate, userId, showToast]);

  const regenerateElement = [
    <Button
      key="regenerate"
      type="link"
      danger
      loading={regenerating}
      disabled={loadingFetch}
      onClick={handleRegenerateClick}
    >
      Regenerate
    </Button>,
  ];

  return (
    <Fragment>
      <Card title="Device password" headerAction={regenerateElement}>
        {fetchError !== undefined && <div>Failed to load device password.</div>}
        {fetchError === undefined && (
          <div className={styles.pill}>
            <KeyIcon className={styles.pillIcon} width={14} height={14} />
            <span className={styles.password}>{loadingFetch ? '…' : (displayPassword ?? '—')}</span>
            <Button
              type="default"
              success={copied}
              prefix={copied ? CheckIcon : undefined}
              disabled={regenerating || (!copied && (!displayPassword || loadingFetch))}
              onClick={handleCopy}
              radius="card"
            >
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
        )}
      </Card>
      <ConfirmModal
        isOpen={showConfirm}
        icon={AlertOctagonIcon}
        title="Regenerate device password?"
        confirmText="Regenerate"
        cancelText="Cancel"
        danger
        loading={regenerating}
        onConfirm={() => void handleConfirm()}
        onCancel={handleCancel}
      >
        This will create a <strong>new random device password</strong>. All of your KoReader devices
        and OPDS clients will stop syncing until you update them with the new password.
      </ConfirmModal>
    </Fragment>
  );
};
