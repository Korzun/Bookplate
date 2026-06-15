import { Fragment, useCallback, useState } from 'react';

import { Card } from '~/component';
import { Button, ConfirmModal } from '~/control';
import { AlertOctagonIcon } from '~/icon';
import { useToast } from '~/provider/toast';
import { useRegenerateSyncPassword, useSyncPassword } from '~/provider/user';

import { useStyle } from './style';

export const SyncPassword = () => {
  const styles = useStyle();
  const [syncPassword, loadingFetch, fetchError] = useSyncPassword();
  const [regenerate, regenerating, newPassword] = useRegenerateSyncPassword();
  const showToast = useToast();

  const displayPassword = newPassword ?? syncPassword;

  const [showConfirm, setShowConfirm] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!displayPassword) return;
    await navigator.clipboard.writeText(displayPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [displayPassword]);

  const handleRegenerateClick = useCallback(() => setShowConfirm(true), []);
  const handleCancel = useCallback(() => setShowConfirm(false), []);
  const handleConfirm = useCallback(async () => {
    const ok = await regenerate();
    if (ok) {
      showToast('Sync password regenerated', 'success');
    } else {
      showToast('Failed to regenerate sync password', 'error');
    }
    setShowConfirm(false);
  }, [regenerate, showToast]);

  const regenerateElement = [
    <Button
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
      <Card title="Sync password" headerAction={regenerateElement}>
        {fetchError && <div>Failed to load sync password.</div>}
        {!fetchError && (
          <div className={styles.row}>
            <span className={styles.password}>{loadingFetch ? '…' : (displayPassword ?? '—')}</span>
            <Button type="default" disabled={!displayPassword || loadingFetch} onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
        )}
      </Card>
      <ConfirmModal
        isOpen={showConfirm}
        icon={AlertOctagonIcon}
        title="Regenerate sync password?"
        confirmText="Regenerate"
        cancelText="Cancel"
        danger
        loading={regenerating}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      >
        This will create a <strong>new random sync password</strong>. All of your KoReader devices
        and OPDS clients will stop syncing until you update them with the new password.
      </ConfirmModal>
    </Fragment>
  );
};
