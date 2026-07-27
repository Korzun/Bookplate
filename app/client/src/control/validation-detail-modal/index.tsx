import { Fragment, useCallback, useState } from 'react';

import { CheckIcon } from '~/icon';
import { isBlockingAtThreshold, SEVERITY_LABEL, SEVERITY_ORDER } from '~/lib/severity';
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
  intro?: React.ReactNode;
  onClose?: () => void;
}

export function ValidationDetailModal({
  isOpen = false,
  filename,
  counts,
  messages,
  threshold,
  intro,
  onClose = () => {},
}: Props) {
  const styles = useStyle();
  // Escape dismisses the modal the same way the Close button does.
  const modalRef = useModalDialog(isOpen, onClose);

  const blockingMessages = messages.filter((m) => isBlockingAtThreshold(m.severity, threshold));
  const [showAll, setShowAll] = useState(blockingMessages.length === 0);
  const hasNonBlocking = blockingMessages.length < messages.length;
  const visible = showAll ? messages : blockingMessages;

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
          {messages.length === 0 ? (
            <p className={styles.validEmpty}>
              <CheckIcon width={16} height={16} className={styles.checkIcon} aria-hidden />
              No validation issues found.
            </p>
          ) : (
            <>
              <p className={styles.intro}>
                {intro ?? (
                  <>
                    These issues reached the{' '}
                    <strong className={styles.emphasisDanger}>rejection threshold</strong> and{' '}
                    <strong className={styles.emphasisStrong}>must be fixed</strong> before this
                    EPUB can be uploaded.
                  </>
                )}
              </p>
              <div className={styles.countsRow}>
                <SeverityCounts counts={counts} threshold={threshold} pluralize />
                {hasNonBlocking && (
                  <Button
                    type="link"
                    className={styles.toggle}
                    onClick={() => setShowAll((v) => !v)}
                  >
                    {showAll ? 'Show blocking only' : 'Show all messages'}
                  </Button>
                )}
              </div>
              <div className={styles.messageList}>
                {SEVERITY_ORDER.map((severity) => {
                  const group = visible.filter((m) => m.severity === severity);
                  if (group.length === 0) {
                    return null;
                  }
                  const blocking = isBlockingAtThreshold(severity, threshold);
                  return (
                    <Fragment key={severity}>
                      <CardDivider>{SEVERITY_LABEL[severity]}</CardDivider>
                      <ul className={styles.group}>
                        {group.map((m, i) => (
                          <li key={`${m.id}-${i}`} className={styles.message}>
                            <span
                              data-blocking={blocking}
                              className={blocking ? styles.severityBlocking : styles.severityMuted}
                            >
                              {SEVERITY_LABEL[m.severity]}
                            </span>
                            <span className={styles.id}>{m.id}</span>
                            {m.location && (
                              <Fragment>
                                <span className={styles.locationLabel}>
                                  {m.location.line != null ? 'at' : 'in'}
                                </span>
                                <span className={styles.location}>
                                  {m.location.line != null
                                    ? `${m.location.path}:${m.location.line}`
                                    : m.location.path}
                                </span>
                              </Fragment>
                            )}
                            <span className={styles.text}>
                              {(m.segments ?? [{ text: m.message }]).map((seg, si) =>
                                seg.subject ? (
                                  <code key={si} className={styles.subject}>
                                    {seg.text}
                                  </code>
                                ) : (
                                  <Fragment key={si}>{seg.text}</Fragment>
                                )
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Fragment>
                  );
                })}
              </div>
            </>
          )}
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
