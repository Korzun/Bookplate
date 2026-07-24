import { useCallback } from 'react';

import { SEVERITY_LABEL, THRESHOLD_LABEL } from '~/lib/severity';
import type { Severity, ValidationMessage, ValidationThreshold } from '~/lib/severity';

import { Button } from '../button';
import { SeverityCounts } from '../severity-counts';
import { useModalDialog } from '../use-modal-dialog';
import { useStyle } from './style';

interface Props {
  isOpen?: boolean;
  filename: string;
  counts: Record<Severity, number>;
  messages: ValidationMessage[];
  threshold: ValidationThreshold;
  onClose?: () => void;
}

export function ValidationDetailModal({
  isOpen = false,
  filename,
  counts,
  messages,
  threshold,
  onClose = () => {},
}: Props) {
  const styles = useStyle();
  // Escape dismisses the modal the same way the Close button does.
  const modalRef = useModalDialog(isOpen, onClose);

  const handleClickBackground = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleClickDialog = useCallback((event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    event.stopPropagation();
  }, []);

  return (
    <dialog ref={modalRef} className={styles.root} onClick={handleClickBackground}>
      <div className={styles.dialog} onClick={handleClickDialog}>
        <div className={styles.header}>{filename}</div>
        <div className={styles.body}>
          <p className={styles.intro}>
            These issues reached the {THRESHOLD_LABEL[threshold]} rejection threshold and must be
            fixed before this EPUB can be added.
          </p>
          <div className={styles.counts}>
            <SeverityCounts counts={counts} threshold={threshold} />
          </div>
          <ul className={styles.messageList}>
            {/* messages contains every issue at or above the configured threshold — the reasons
                this book was rejected — so the danger-colored label is always correct */}
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
