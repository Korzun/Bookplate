import { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';

import { BookEditForm, Page } from '~/component';
import { useBook } from '~/provider/book';
import { useToast } from '~/provider/toast';

import { useStyle } from './style';

export const BookEditPage = () => {
  const { id } = useParams<{ id: string }>();
  const styles = useStyle();
  const showToast = useToast();
  const lastErrorRef = useRef<string | undefined>(undefined);

  const [original, loading, hasError, errorMessage] = useBook(id!);

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
      <BookEditForm key={id} original={original} id={id!} />
    </Page>
  );
};
