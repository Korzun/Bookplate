import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';

import { BookEditForm, Page } from '~/component';
import { UploadFixGuardModal } from '~/component/upload-fix-guard-modal';
import { useBook } from '~/provider/book';
import { useToast } from '~/provider/toast';
import { usePendingFixesForBook, useUploadQueue } from '~/provider/upload';
import { path } from '~/router';

import { useStyle } from './style';

export const BookEditPage = () => {
  const { id } = useParams<{ id: string }>();
  const styles = useStyle();
  const showToast = useToast();
  const navigate = useNavigate();
  const lastErrorRef = useRef<string | undefined>(undefined);

  const [original, loading, hasError, errorMessage] = useBook(id!);
  const pendingItem = usePendingFixesForBook(id);
  const { dismissAllProposals } = useUploadQueue();

  useEffect(() => {
    if (errorMessage !== undefined && errorMessage !== lastErrorRef.current) {
      lastErrorRef.current = errorMessage;
      showToast(errorMessage, 'error');
    }
  }, [errorMessage, showToast]);

  if (loading) {
    return (
      <Page>
        <h1 className={styles.heading}>Loading…</h1>
      </Page>
    );
  }

  if (!original) {
    return (
      <Page>
        <h1 className={styles.heading}>
          {hasError ? (errorMessage ?? 'Failed to load book.') : 'Book not found.'}
        </h1>
      </Page>
    );
  }

  return (
    <Page>
      {pendingItem ? (
        <UploadFixGuardModal
          isOpen
          onReview={() => navigate(path.upload())}
          onDismissAndEdit={() => dismissAllProposals(pendingItem.id)}
          onCancel={() => navigate(path.library())}
        />
      ) : (
        <BookEditForm key={id} original={original} id={id!} />
      )}
    </Page>
  );
};
