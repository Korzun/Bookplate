import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '../button';

import { useStyle } from './style';

type PasswordResultModalProps = {
  isOpen?: boolean;
  username: string;
  password: string | null;
  onDone?: () => void;
};

export function PasswordResultModal({
  isOpen = false,
  username,
  password,
  onDone = () => {},
}: PasswordResultModalProps) {
  const styles = useStyle();
  const modalRef = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);

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

  const handleCopy = useCallback(async () => {
    if (!password) return;
    await navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [password]);

  const handleDone = useCallback(() => {
    setCopied(false);
    onDone();
  }, [onDone]);

  const handleClickDialog = useCallback((event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    event.stopPropagation();
  }, []);

  return (
    <dialog ref={modalRef} className={styles.root} closedby="none">
      <div className={styles.dialog} onClick={handleClickDialog}>
        <div className={styles.header}>New password for {username}</div>
        <div className={styles.body}>
          <p>
            This password will only be shown once. Make sure to copy it before closing this dialog.
          </p>
          <div className={styles.inset}>
            <span className={styles.password}>{password ?? '—'}</span>
            <Button
              type="default"
              disabled={!password}
              onClick={handleCopy}
              radius="inset"
              success={copied}
              className={styles.copyButton}
            >
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
        </div>
        <div className={styles.footer}>
          <Button onClick={handleDone} type="primary" radius="modal">
            Done
          </Button>
        </div>
      </div>
    </dialog>
  );
}
