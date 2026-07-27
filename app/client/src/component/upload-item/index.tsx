import cx from 'classnames';
import { Fragment, useState } from 'react';

import { Button, SeverityCounts, ValidationDetailModal } from '~/control';
import { CheckIcon, CircleXIcon, ClockIcon, SpinnerIcon } from '~/icon';
import type { MetadataFix, UploadItem as UploadItemType, UploadItemStatus } from '~/provider/book';

import { Card } from '../card';
import { FixReview } from '../fix-review';
import { useStyle } from './style';

interface Props {
  item: UploadItemType;
  onApplyFix: (fix: MetadataFix) => void;
  onApplyAll: () => void | Promise<void>;
  onDismissAll: () => void | Promise<void>;
  onUndo: () => void | Promise<void>;
  onDismissFix: (fix: MetadataFix) => void;
  onDismissCompleted?: () => void;
  /** When true, every accept/reject affordance on this card is disabled —
   * used while a page-level "Accept all" is applying across the whole queue,
   * so a per-card decision can't race the in-flight sweep. */
  actionsDisabled?: boolean;
}

const STATUS_LABEL: Record<UploadItemStatus, string> = {
  queued: 'Queued',
  uploading: 'Uploading',
  done: 'Upload complete',
  error: 'Upload failed',
};

export const UploadItem = ({
  item,
  onApplyFix,
  onApplyAll,
  onDismissAll,
  onUndo,
  onDismissFix,
  onDismissCompleted,
  actionsDisabled,
}: Props) => {
  const styles = useStyle();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { fileName, fileSize, status, bytesUploaded, errorMessage, validation, bookId } = item;
  const autoFixes = item.autoFixes ?? [];
  const appliedFixes = item.appliedFixes ?? [];
  const proposals = item.proposals ?? [];

  const totalMB = (fileSize / 1_048_576).toFixed(1);
  const uploadedMB = (bytesUploaded / 1_048_576).toFixed(1);
  const progressPercent = fileSize > 0 ? Math.min((bytesUploaded / fileSize) * 100, 100) : 0;

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
      // The left status label already reads "Upload failed"; the right side shows
      // the server's specific message when there is one, otherwise nothing.
      return errorMessage ?? '';
    }
    if (status === 'queued') {
      return `${totalMB} MB`;
    }
    if (status === 'done') {
      return `${totalMB} / ${totalMB} MB`;
    }
    return `${uploadedMB} / ${totalMB} MB`;
  })();

  // A rejected upload carrying a validation payload was turned away by epubcheck;
  // a plain error is a transport/server failure. Name them distinctly.
  const statusLabel = status === 'error' && validation ? 'Validation failed' : STATUS_LABEL[status];

  // Offer a clear-from-queue action on a failed upload, and on a completed one
  // once there are no pending fixes left to decide.
  const dismissAction =
    status === 'error' || (status === 'done' && proposals.length === 0) ? (
      <Button type="link" onClick={() => onDismissCompleted?.()}>
        Clear upload
      </Button>
    ) : undefined;

  return (
    <Fragment>
      <Card title={fileName} headerAction={dismissAction}>
        <div className={styles.content}>
          <div className={styles.labelContainer}>
            <div className={cx(styles.icon, styles[status])}>{icon}</div>
            <div className={cx(styles.leftLabel, styles[status])}>{statusLabel}</div>
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

          {status === 'done' && (
            <FixReview
              autoFixes={autoFixes}
              appliedFixes={appliedFixes}
              proposals={proposals}
              onApplyFix={onApplyFix}
              onApplyAll={onApplyAll}
              onDismissFix={onDismissFix}
              onDismissAll={onDismissAll}
              onUndo={onUndo}
              undo={item.undo}
              disabled={actionsDisabled}
              bookId={bookId}
              showEditLink
            />
          )}
        </div>
      </Card>
      {validation && detailsOpen && (
        <ValidationDetailModal
          isOpen
          filename={fileName}
          counts={validation.counts}
          messages={validation.messages}
          threshold={validation.threshold}
          onClose={() => setDetailsOpen(false)}
        />
      )}
    </Fragment>
  );
};
