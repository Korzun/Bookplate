import { Fragment, useCallback, useState } from 'react';

import { Card } from '~/component';
import { Button, ConfirmModal } from '~/control';
import { AlertOctagonIcon, CheckIcon, KeyIcon } from '~/icon';
import { useToast } from '~/provider/toast';
import { useRegenerateSyncPassword, useSyncPassword } from '~/provider/user';
import { copyToClipboard } from '~/utils';

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
    const ok = await regenerate();
    if (ok) {
      showToast('Device password regenerated', 'success');
    } else {
      showToast('Failed to regenerate device password', 'error');
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
      <Card title="Device password" headerAction={regenerateElement}>
        {fetchError && <div>Failed to load device password.</div>}
        {!fetchError && (
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
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      >
        This will create a <strong>new random device password</strong>. All of your KoReader devices
        and OPDS clients will stop syncing until you update them with the new password.
      </ConfirmModal>
    </Fragment>
  );
};
