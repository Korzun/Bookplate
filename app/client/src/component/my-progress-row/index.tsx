import { Fragment, useCallback, useEffect, useState } from 'react';

import { Button, ConfirmModal } from '~/control';
import { AlertOctagonIcon } from '~/icon';
import { useBook } from '~/provider/book';
import { useDeleteMyProgress, useMyProgress } from '~/provider/progress';
import { relativeTime } from '~/utils';

import { Toast } from '../toast';
import { ProgressIndicator } from '../progress-indicator';

import { useStyle } from './style';

interface MyProgressRowProps {
  bookId: string;
}

export const MyProgressRow = ({ bookId }: MyProgressRowProps) => {
  const styles = useStyle();

  const [book] = useBook(bookId);
  const [progress, progressLoading, progressError] = useMyProgress(bookId);
  const [deleteMyProgress, deleting, error, errorMessage] = useDeleteMyProgress();

  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [submitCount, setSubmitCount] = useState(0);

  const handleDismiss = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (submitCount === 0) return;
    if (deleting) {
      setToast(null);
      return;
    }
    if (error) {
      setToast({ text: errorMessage ?? 'Failed to clear progress', type: 'error' });
      return;
    }
    setToast({ text: 'Progress cleared', type: 'success' });
  }, [submitCount, deleting, error, errorMessage]);

  const handleClear = useCallback(() => setShowModal(true), []);
  const handleCancel = useCallback(() => setShowModal(false), []);
  const handleConfirm = useCallback(() => {
    setShowModal(false);
    setSubmitCount((c) => c + 1);
    deleteMyProgress(bookId);
  }, [deleteMyProgress, bookId]);

  if (progressLoading) {
    return <div className={styles.loading}>Loading…</div>;
  }
  if (progressError) {
    return <div className={styles.error}>Error loading progress</div>;
  }
  if (progress === undefined) {
    return null;
  }

  const bookTitle = book?.title ?? progress.document;

  const metadataList: string[] = [];
  if (progress.device) metadataList.push(progress.device);
  if (progress.timestamp != null) metadataList.push(relativeTime(progress.timestamp));

  return (
    <Fragment>
      <div className={styles.root}>
        <div className={styles.progress}>
          <ProgressIndicator value={progress.percentage} size={14} />
        </div>
        <div className={styles.book}>{bookTitle}</div>
        <div className={styles.metadata}>{metadataList.join(' · ')}</div>
        <Button type="link" danger onClick={handleClear} loading={deleting}>
          Clear
        </Button>
      </div>
      {showModal && (
        <ConfirmModal
          isOpen
          onCancel={handleCancel}
          onConfirm={handleConfirm}
          icon={AlertOctagonIcon}
          danger
          title="Clear reading progress?"
          confirmText="Clear"
          loading={deleting}
        >
          This will remove your synced reading progress for <strong>{bookTitle}</strong>.
        </ConfirmModal>
      )}
      {toast && (
        <Toast key={submitCount} message={toast.text} type={toast.type} onDismiss={handleDismiss} />
      )}
    </Fragment>
  );
};
