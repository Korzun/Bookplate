import { PropsWithChildren, useCallback } from 'react';

import { IconProps } from '~/icon';

import { Button } from '../button';
import { useModalDialog } from '../use-modal-dialog';
import { useStyle } from './style';

type ConfirmModalProps = PropsWithChildren<{
  cancelText?: string;
  confirmText?: string;
  danger?: boolean;
  icon?: React.ComponentType<IconProps>;
  isOpen?: boolean;
  loading?: boolean;
  onCancel?: () => void;
  onConfirm?: () => void;
  title?: string;
}>;

export function ConfirmModal({
  cancelText = 'Cancel',
  children,
  confirmText = 'Confirm',
  danger = false,
  icon: Icon,
  isOpen = false,
  loading = false,
  onCancel = () => {},
  onConfirm = () => {},
  title = 'Confirm action',
}: ConfirmModalProps) {
  const styles = useStyle();

  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);
  const handleConfirm = useCallback(() => {
    onConfirm();
  }, [onConfirm]);
  // Escape dismisses the modal, except while the action is in flight — the
  // Cancel button is disabled then, so Escape is gated to match.
  const modalRef = useModalDialog(isOpen, handleCancel, !loading);
  const handleClickBackground = useCallback(
    (event: React.MouseEvent<HTMLDialogElement, MouseEvent>) => {
      event.stopPropagation();
      handleCancel();
    },
    [handleCancel]
  );
  const handleClickDialog = useCallback((event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    event.stopPropagation();
  }, []);

  return (
    <dialog ref={modalRef} className={styles.root} onClick={handleClickBackground}>
      <div className={styles.dialog} onClick={handleClickDialog}>
        <div className={styles.header}>
          {Icon && (
            <div className={styles.icon}>
              <Icon className={danger ? styles.iconDanger : undefined} />
            </div>
          )}
          {title}
        </div>
        <div className={styles.body}>{children}</div>
        <div className={styles.footer}>
          <Button onClick={handleCancel} disabled={loading} type="text" radius="modal">
            {cancelText}
          </Button>
          <Button
            onClick={handleConfirm}
            loading={loading}
            type="primary"
            danger={danger}
            radius="modal"
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
