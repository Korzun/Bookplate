import { useEffect, PropsWithChildren, useRef, useCallback } from 'react';

import { IconProps } from '~/icon';

import { Button } from '../button';
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
  const modalRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const modalElement = modalRef.current;
    if (!modalElement) {
      return;
    }
    if (isOpen) {
      modalElement.showModal();
    } else {
      modalElement.close();
    }
  }, [isOpen]);

  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);
  const handleConfirm = useCallback(() => {
    onConfirm();
  }, [onConfirm]);
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
    <dialog ref={modalRef} className={styles.root} closedby="none" onClick={handleClickBackground}>
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
