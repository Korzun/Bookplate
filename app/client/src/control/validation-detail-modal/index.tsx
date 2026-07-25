import { Fragment, useCallback } from 'react';

import { SEVERITY_LABEL, SEVERITY_ORDER } from '~/lib/severity';
import type { Severity, ValidationMessage, ValidationThreshold } from '~/lib/severity';

import { CardDivider } from '../../component/card-divider';
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
            These issues reached the{' '}
            <strong className={styles.emphasisDanger}>rejection threshold</strong> and{' '}
            <strong className={styles.emphasisStrong}>must be fixed</strong> before this EPUB can be
            uploaded.
          </p>
          <div className={styles.counts}>
            <SeverityCounts counts={counts} threshold={threshold} />
          </div>
          <div className={styles.messageList}>
            {SEVERITY_ORDER.map((severity) => {
              const group = messages.filter((m) => m.severity === severity);
              if (group.length === 0) {
                return null;
              }
              return (
                <Fragment key={severity}>
                  <CardDivider>{SEVERITY_LABEL[severity]}</CardDivider>
                  <ul className={styles.group}>
                    {group.map((m, i) => (
                      <li key={`${m.id}-${i}`} className={styles.message}>
                        <span className={styles.severity}>{SEVERITY_LABEL[m.severity]}</span>
                        <span className={styles.id}>{m.id}</span>
                        <span className={styles.text}>{m.message}</span>
                        {m.location && (
                          <span className={styles.location}>
                            {m.location.line != null
                              ? `at ${m.location.path}:${m.location.line}`
                              : `in ${m.location.path}`}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </Fragment>
              );
            })}
          </div>
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
