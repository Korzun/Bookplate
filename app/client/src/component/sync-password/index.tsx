import { Fragment, useCallback, useEffect, useState } from 'react';

import { Card, Toast } from '~/component';
import { Button, ConfirmModal } from '~/control';
import { useRegenerateSyncPassword, useSyncPassword } from '~/provider/user';

import { useStyle } from './style';

export const SyncPassword = () => {
  const styles = useStyle();
  const [syncPassword, loadingFetch, fetchError] = useSyncPassword();
  const [regenerate, regenerating, newPassword, regenerateError] = useRegenerateSyncPassword();

  const displayPassword = newPassword ?? syncPassword;

  const [showConfirm, setShowConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [regenerateCount, setRegenerateCount] = useState(0);

  useEffect(() => {
    if (regenerateCount === 0) return;
    if (regenerating) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setToast(null);
      return;
    }
    if (regenerateError) {
      setToast({ text: 'Failed to regenerate sync password', type: 'error' });
      return;
    }
    if (newPassword) {
      setToast({ text: 'Sync password regenerated', type: 'success' });
    }
  }, [regenerateCount, regenerating, regenerateError, newPassword]);

  const handleCopy = useCallback(async () => {
    if (!displayPassword) return;
    await navigator.clipboard.writeText(displayPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [displayPassword]);

  const handleRegenerateClick = useCallback(() => setShowConfirm(true), []);
  const handleCancel = useCallback(() => setShowConfirm(false), []);
  const handleConfirm = useCallback(() => {
    setShowConfirm(false);
    setRegenerateCount((c) => c + 1);
    regenerate();
  }, [regenerate]);

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

      {toast && (
        <Toast
          key={regenerateCount}
          message={toast.text}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
    </Fragment>
  );
};
