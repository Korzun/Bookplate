import { useCallback, useEffect, useRef, useState } from 'react';

import { copyToClipboard } from '~/utils';

import { Button } from '../button';
import { useStyle } from './style';

function renderPassword(password: string, numberClass: string, symbolClass: string) {
  return [...password].map((char, i) => {
    if (/\d/.test(char))
      return (
        <span key={i} className={numberClass}>
          {char}
        </span>
      );
    if (/[a-zA-Z]/.test(char)) return char;
    return (
      <span key={i} className={symbolClass}>
        {char}
      </span>
    );
  });
}

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
  const [countdown, setCountdown] = useState(5);

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

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => {
      clearInterval(interval);
      setCountdown(5);
    };
  }, [isOpen]);

  const handleCopy = useCallback(async () => {
    if (!password) return;
    const ok = await copyToClipboard(password);
    if (!ok) return;
    setCopied(true);
    setCountdown(0); // completing the copy satisfies the countdown gate
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
            <span className={styles.password}>
              {password ? renderPassword(password, styles.charNumber, styles.charSymbol) : '—'}
            </span>
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
          <Button onClick={handleDone} type="primary" radius="modal" disabled={countdown > 0}>
            {countdown > 0 ? `Done (${countdown})` : 'Done'}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
