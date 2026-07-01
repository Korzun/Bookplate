import cx from 'classnames';
import { Fragment, useCallback, useState } from 'react';

import { Button, ConfirmModal, LinkProgressModal } from '~/control';
import { AlertOctagonIcon } from '~/icon';
import { useUsername } from '~/provider/auth';
import { useBook } from '~/provider/book';
import { useDeleteMyProgress, useMyProgress } from '~/provider/progress';
import { useToast } from '~/provider/toast';
import { relativeTime } from '~/utils';

import { ProgressIndicator } from '../progress-indicator';

import { useStyle } from './style';

interface MyProgressRowProps {
  bookId: string;
}

export const MyProgressRow = ({ bookId }: MyProgressRowProps) => {
  const styles = useStyle();

  const [username] = useUsername();
  const [book, bookLoading] = useBook(bookId);
  const [progress, progressLoading, progressError] = useMyProgress(bookId);
  const [deleteMyProgress, deleting] = useDeleteMyProgress();
  const showToast = useToast();

  const [showClearModal, setShowClearModal] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);

  const handleClear = useCallback(() => setShowClearModal(true), []);
  const handleCancelClear = useCallback(() => setShowClearModal(false), []);
  const handleConfirmClear = useCallback(async () => {
    setShowClearModal(false);
    const ok = await deleteMyProgress(bookId);
    if (ok) {
      showToast('Progress cleared', 'success');
    } else {
      showToast('Failed to clear progress', 'error');
    }
  }, [deleteMyProgress, bookId, showToast]);

  if (progressLoading) {
    return <div className={styles.loading}>Loading…</div>;
  }
  if (progressError) {
    return <div className={styles.error}>Error loading progress</div>;
  }
  if (progress === undefined) {
    return null;
  }

  const bookTitle = book ? book.titleSort || book.title : progress.document;
  const isUnresolved = book === undefined && !bookLoading;

  const metadataList: string[] = [];
  if (progress.device) metadataList.push(progress.device);
  if (progress.timestamp != null) metadataList.push(relativeTime(progress.timestamp));

  return (
    <Fragment>
      <div className={styles.root}>
        <div className={styles.progress}>
          <ProgressIndicator value={progress.percentage} size={14} />
        </div>
        <div className={cx(styles.book, { [styles.bookUnresolved]: isUnresolved })}>
          {isUnresolved && (
            <AlertOctagonIcon
              width={14}
              height={14}
              className={styles.orphanIcon}
              aria-label="Unlinked progress"
            />
          )}
          <span className={styles.title}>{bookTitle}</span>
        </div>
        <div className={styles.metadata}>{metadataList.join(' · ')}</div>
        {isUnresolved && (
          <Button type="link" onClick={() => setShowLinkModal(true)}>
            Link
          </Button>
        )}
        <Button type="link" danger onClick={handleClear} loading={deleting}>
          Clear
        </Button>
      </div>
      {showClearModal && (
        <ConfirmModal
          isOpen
          onCancel={handleCancelClear}
          onConfirm={handleConfirmClear}
          icon={AlertOctagonIcon}
          danger
          title="Clear reading progress?"
          confirmText="Clear"
          loading={deleting}
        >
          This will remove your synced reading progress for <strong>{bookTitle}</strong>.
        </ConfirmModal>
      )}
      {showLinkModal && username !== undefined && (
        <LinkProgressModal
          isOpen
          documentId={bookId}
          username={username}
          onClose={() => setShowLinkModal(false)}
        />
      )}
    </Fragment>
  );
};
