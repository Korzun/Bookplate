import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';

import { BookEditForm, Page, Toast } from '~/component';
import { useBook } from '~/provider/book';

import { useStyle } from './style';

export const BookEditPage = () => {
  const { id } = useParams<{ id: string }>();
  const styles = useStyle();

  const [original, loading, hasError, errorMessage] = useBook(id!);
  const [dismissedError, setDismissedError] = useState<string | undefined>();
  const handleDismissError = useCallback(() => setDismissedError(errorMessage), [errorMessage]);
  const toastError =
    errorMessage !== undefined && errorMessage !== dismissedError ? errorMessage : undefined;

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
      {toastError && <Toast message={toastError} type="error" onDismiss={handleDismissError} />}
      <BookEditForm key={id} original={original} id={id!} />
    </Page>
  );
};
