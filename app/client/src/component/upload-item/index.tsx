import cx from 'classnames';
import { Fragment, useState } from 'react';
import { Link } from 'react-router';

import { Button, SeverityCounts, ValidationDetailModal } from '~/control';
import { CheckIcon, CircleXIcon, ClockIcon, SpinnerIcon } from '~/icon';
import type { MetadataFix, UploadItem as UploadItemType, UploadItemStatus } from '~/provider/book';
import { path } from '~/router';

import { Card } from '../card';
import { CardDivider } from '../card-divider';
import { Tag } from '../tag';
import { useStyle } from './style';

interface Props {
  item: UploadItemType;
  onApplyFix: (fix: MetadataFix) => void;
  onApplyAll: () => void | Promise<void>;
  onDismissAll: () => void | Promise<void>;
  onUndo: () => void | Promise<void>;
  onDismissFix: (fix: MetadataFix) => void;
}

const FIELD_LABEL: Record<string, string> = {
  title: 'Title',
  titleSort: 'Title sort',
  author: 'Author',
  authorSort: 'Author sort',
  subjects: 'Subjects',
  document: 'EPUB',
};

const labelFor = (fix: MetadataFix): string =>
  fix.kind === 'subjects-split' ? 'Subject' : (FIELD_LABEL[fix.field] ?? fix.field);

const STATUS_LABEL: Record<UploadItemStatus, string> = {
  queued: 'Queued',
  uploading: 'Uploading',
  done: 'Upload complete',
  error: 'Error',
};

export const UploadItem = ({
  item,
  onApplyFix,
  onApplyAll,
  onDismissAll,
  onUndo,
  onDismissFix,
}: Props) => {
  const styles = useStyle();
  const [detailsOpen, setDetailsOpen] = useState(false);
  // True while a bulk header action (Apply all / Dismiss all / Undo) is running,
  // so the buttons disable and a rapid second click can't re-trigger it.
  const [busy, setBusy] = useState(false);
  const { file, status, bytesUploaded, errorMessage, validation, bookId } = item;
  const autoFixes = item.autoFixes ?? [];
  const appliedFixes = item.appliedFixes ?? [];
  const proposals = item.proposals ?? [];
  const actionable = proposals.filter((p) => p.to !== null);
  const pendingUndo = item.undo;

  const runAction = async (action: () => void | Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const totalMB = (file.size / 1_048_576).toFixed(1);
  const uploadedMB = (bytesUploaded / 1_048_576).toFixed(1);
  const progressPercent = file.size > 0 ? Math.min((bytesUploaded / file.size) * 100, 100) : 0;

  const icon = (() => {
    if (status === 'uploading') {
      return <SpinnerIcon />;
    }
    if (status === 'error') {
      return <CircleXIcon />;
    }
    if (status === 'done') {
      return <CheckIcon />;
    }
    return <ClockIcon />;
  })();

  const rightLabel = (() => {
    if (status === 'error') {
      return errorMessage ?? 'Upload failed';
    }
    if (status === 'queued') {
      return `${totalMB} MB`;
    }
    if (status === 'done') {
      return `${totalMB} / ${totalMB} MB`;
    }
    return `${uploadedMB} / ${totalMB} MB`;
  })();

  return (
    <Fragment>
      <Card title={file.name}>
        <div className={styles.content}>
          <div className={styles.labelContainer}>
            <div className={cx(styles.icon, styles[status])}>{icon}</div>
            <div className={cx(styles.leftLabel, styles[status])}>{STATUS_LABEL[status]}</div>
            {validation ? (
              <div className={cx(styles.rightLabel, styles.validationLabel)}>
                <SeverityCounts counts={validation.counts} threshold={validation.threshold} />
                <span className={styles.separator} aria-hidden="true">
                  |
                </span>
                <Button
                  type="link"
                  className={styles.detailsLink}
                  onClick={() => setDetailsOpen(true)}
                >
                  Details
                </Button>
              </div>
            ) : (
              <div className={cx(styles.rightLabel, { [styles.error]: status === 'error' })}>
                {rightLabel}
              </div>
            )}
          </div>
          <div className={styles.progressRow}>
            <div className={styles.barTrack}>
              <div
                className={cx(styles.barFill, styles[status])}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {status === 'done' &&
            (autoFixes.length > 0 ||
              appliedFixes.length > 0 ||
              proposals.length > 0 ||
              pendingUndo) && (
              <div className={styles.metadata}>
                {autoFixes.length > 0 && (
                  <Fragment>
                    <CardDivider>Automatic fixes</CardDivider>
                    {autoFixes.map((fix) => (
                      <div
                        key={`auto-${fix.field}-${fix.kind}-${fix.from}`}
                        className={styles.appliedRow}
                      >
                        <CheckIcon />
                        <span className={styles.chipLine}>
                          {labelFor(fix)}:{' '}
                          {Object.keys(fix.changes).length === 0 ? (
                            // Structural repairs (e.g. the dcterms:modified fix) have no
                            // original field value — show just the description.
                            <strong>{fix.to}</strong>
                          ) : (
                            <span>
                              {fix.from ? (
                                <span className={styles.fromValue}>{fix.from}</span>
                              ) : (
                                <em>empty</em>
                              )}
                              {' → '}
                              <strong>{fix.to}</strong>
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </Fragment>
                )}

                {(proposals.length > 0 || pendingUndo) && (
                  <CardDivider
                    actions={
                      pendingUndo ? (
                        <Button type="link" disabled={busy} onClick={() => void runAction(onUndo)}>
                          Undo {pendingUndo.kind}
                        </Button>
                      ) : (
                        <Fragment>
                          {proposals.length >= 1 && (
                            <Button
                              type="link"
                              danger
                              disabled={busy}
                              onClick={() => void runAction(onDismissAll)}
                            >
                              Dismiss all
                            </Button>
                          )}
                          {actionable.length >= 1 && (
                            <Button
                              type="link"
                              disabled={busy}
                              onClick={() => void runAction(onApplyAll)}
                            >
                              Apply all
                            </Button>
                          )}
                        </Fragment>
                      )
                    }
                  >
                    Suggested fixes
                  </CardDivider>
                )}

                {appliedFixes.map((fix) => (
                  <div
                    key={`applied-${fix.field}-${fix.kind}-${fix.from}`}
                    className={styles.appliedRow}
                  >
                    <CheckIcon />
                    <span className={styles.chipLine}>
                      {labelFor(fix)}:{' '}
                      {fix.toChips ? (
                        <span className={styles.chipGroup}>
                          {fix.toChips.map((c) => (
                            <Tag key={c} size="sm">
                              {c}
                            </Tag>
                          ))}
                        </span>
                      ) : (
                        <strong>{fix.to}</strong>
                      )}
                    </span>
                  </div>
                ))}

                {proposals.map((fix) => (
                  <div
                    key={`prop-${fix.field}-${fix.kind}-${fix.from}`}
                    className={styles.proposalRow}
                  >
                    <div className={styles.proposalText}>
                      <span className={styles.fieldName}>{labelFor(fix)}:</span>
                      {fix.to === null ? (
                        <span className={styles.flagText}>needs review</span>
                      ) : fix.toChips ? (
                        <span className={styles.chipLine}>
                          {/* Left side matches the scalar "from" styling: struck-through,
                              faint text — not a chip. The split parts stay chips. */}
                          <span className={styles.fromValue}>{fix.from}</span>
                          {' → '}
                          <span className={styles.chipGroup}>
                            {fix.toChips.map((c) => (
                              <Tag key={c} size="sm">
                                {c}
                              </Tag>
                            ))}
                          </span>
                        </span>
                      ) : (
                        <span>
                          {fix.from ? (
                            <span className={styles.fromValue}>{fix.from}</span>
                          ) : (
                            <em>empty</em>
                          )}
                          {' → '}
                          <strong>{fix.to}</strong>
                        </span>
                      )}
                      {fix.reason && <span className={styles.reason}>{fix.reason}</span>}
                    </div>
                    <div className={styles.proposalActions}>
                      {fix.to !== null ? (
                        <Fragment>
                          <Button type="link" danger onClick={() => onDismissFix(fix)}>
                            Dismiss
                          </Button>
                          <Button type="link" onClick={() => onApplyFix(fix)}>
                            Apply
                          </Button>
                        </Fragment>
                      ) : (
                        bookId && (
                          <Link to={path.bookEdit(bookId)} className={styles.editLink}>
                            Edit
                          </Link>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
        </div>
      </Card>
      {validation && detailsOpen && (
        <ValidationDetailModal
          isOpen
          filename={file.name}
          counts={validation.counts}
          messages={validation.messages}
          threshold={validation.threshold}
          onClose={() => setDetailsOpen(false)}
        />
      )}
    </Fragment>
  );
};
