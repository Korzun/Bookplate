import { useCallback, useEffect, useRef } from 'react';

import { SEVERITY_LABEL } from '~/lib/severity';
import type { Severity, ValidationMessage } from '~/lib/severity';

import { Button } from '../button';
import { SeverityCounts } from '../severity-counts';

import { useStyle } from './style';

interface Props {
  isOpen?: boolean;
  filename: string;
  counts: Record<Severity, number>;
  messages: ValidationMessage[];
  onClose?: () => void;
}

export function ValidationDetailModal({
  isOpen = false,
  filename,
  counts,
  messages,
  onClose = () => {},
}: Props) {
  const styles = useStyle();
  const modalRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = modalRef.current;
    if (!el) {
      return;
    }
    if (isOpen) {
      el.showModal();
    } else {
      el.close();
    }
  }, [isOpen]);

  const handleClickBackground = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleClickDialog = useCallback((event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    event.stopPropagation();
  }, []);

  return (
    <dialog ref={modalRef} className={styles.root} closedby="none" onClick={handleClickBackground}>
      <div className={styles.dialog} onClick={handleClickDialog}>
        <div className={styles.header}>{filename}</div>
        <div className={styles.body}>
          <p className={styles.intro}>
            This EPUB can't be added until the blocking problems below are fixed.
          </p>
          <div className={styles.counts}>
            <SeverityCounts counts={counts} />
          </div>
          <ul className={styles.messageList}>
            {messages.map((m, i) => (
              <li key={`${m.id}-${i}`} className={styles.message}>
                <span className={styles.severity}>{SEVERITY_LABEL[m.severity]}</span>
                <span className={styles.id}>{m.id}</span>
                <span className={styles.text}>{m.message}</span>
                {m.location && <span className={styles.location}>at {m.location}</span>}
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.footer}>
          <Button onClick={onClose} type="primary" radius="modal">
            Close
          </Button>
        </div>
      </div>
    </dialog>
  );
}
