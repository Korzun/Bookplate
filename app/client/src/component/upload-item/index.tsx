import cx from 'classnames';
import { Fragment, useState } from 'react';

import { Button, SeverityCounts, ValidationDetailModal } from '~/control';
import { CheckIcon, CircleXIcon, ClockIcon, SpinnerIcon } from '~/icon';
import type { UploadItem as UploadItemType } from '~/provider/book';

import { Card } from '../card';

import { useStyle } from './style';

interface Props {
  item: UploadItemType;
}

export const UploadItem = ({ item }: Props) => {
  const styles = useStyle();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { file, status, bytesUploaded, errorMessage, validation } = item;

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
            <div className={cx(styles.leftLabel, styles[status])}>{status}</div>
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
