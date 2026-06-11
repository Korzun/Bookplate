import { Fragment, useCallback, useState } from 'react';

import { Button, ConfirmModal, LinkProgressModal } from '~/control';
import { AlertOctagonIcon } from '~/icon';
import { useIsAdmin } from '~/provider/auth';
import { useBook } from '~/provider/book';
import { useDeleteUserProgress, useUserProgress } from '~/provider/progress';
import { relativeTime } from '~/utils';

import { ProgressIndicator } from '../progress-indicator';
import { Toast } from '../toast';

import { useStyle } from './style';

interface UserProgressRowProps {
  bookId: string;
  username: string;
}

export const UserProgressRow = ({ bookId, username }: UserProgressRowProps) => {
  const styles = useStyle();

  const [isAdmin] = useIsAdmin();
  const [book, bookLoading] = useBook(bookId);
  const [progress, progressLoading, progressError] = useUserProgress(username, bookId);
  const [deleteUserProgress, deleting, error, errorMessage] = useDeleteUserProgress(username);

  const [showClearModal, setShowClearModal] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [submitCount, setSubmitCount] = useState(0);
  const [dismissedCount, setDismissedCount] = useState(0);

  const handleDismiss = useCallback(() => setDismissedCount(submitCount), [submitCount]);

  const toast = (() => {
    if (submitCount === 0 || dismissedCount >= submitCount || deleting) return null;
    if (error) return { text: errorMessage ?? 'Failed to clear progress', type: 'error' as const };
    return { text: 'Progress cleared', type: 'success' as const };
  })();

  const handleClear = useCallback(() => setShowClearModal(true), []);
  const handleCancelClear = useCallback(() => setShowClearModal(false), []);
  const handleConfirmClear = useCallback(() => {
    setShowClearModal(false);
    setSubmitCount((c) => c + 1);
    deleteUserProgress(bookId);
  }, [deleteUserProgress, bookId]);

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
        <div className={styles.book}>{bookTitle}</div>
        <div className={styles.metadata}>{metadataList.join(' · ')}</div>
        {isUnresolved && isAdmin && (
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
          This will remove <strong>{username}</strong>'s synced reading progress for{' '}
          <strong>{bookTitle}</strong>.
        </ConfirmModal>
      )}
      {showLinkModal && (
        <LinkProgressModal
          isOpen
          documentId={bookId}
          username={username}
          onClose={() => setShowLinkModal(false)}
        />
      )}
      {toast && (
        <Toast key={submitCount} message={toast.text} type={toast.type} onDismiss={handleDismiss} />
      )}
    </Fragment>
  );
};
