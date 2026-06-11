import { Fragment, useCallback, useState } from 'react';

import { Card } from '~/component';
import { Button, ConfirmModal } from '~/control';
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
    setShowConfirm(false);
    const ok = await regenerate();
    if (ok) {
      showToast('Sync password regenerated', 'success');
    } else {
      showToast('Failed to regenerate sync password', 'error');
    }
  }, [regenerate, showToast]);

  return (
    <Fragment>
      <Card isCollapsible defaultCollapsed title="Sync password">
        {fetchError && <div>Failed to load sync password.</div>}
        {!fetchError && (
          <div className={styles.row}>
            <span className={styles.password}>{loadingFetch ? '…' : (displayPassword ?? '—')}</span>
            <Button type="default" disabled={!displayPassword || loadingFetch} onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </Button>
            <Button
              type="default"
              loading={regenerating}
              disabled={loadingFetch}
              onClick={handleRegenerateClick}
            >
              Regenerate
            </Button>
          </div>
        )}
      </Card>

      <ConfirmModal
        isOpen={showConfirm}
        title="Regenerate sync password?"
        confirmText="Regenerate"
        cancelText="Cancel"
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      >
        This will create a new sync password. Your KoReader devices and any OPDS clients will stop
        syncing until you update them with the new password.
      </ConfirmModal>
    </Fragment>
  );
};
