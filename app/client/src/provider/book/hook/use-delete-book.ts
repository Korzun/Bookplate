import { useCallback, useContext, useMemo, useState } from 'react';

import { useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from '../../../lib/api-fetch';
import { Context } from '../context';
import { BookList } from '../type';

const removeBookById = (bookId: string, { [bookId]: _, ...rest }: BookList) => rest;

export type UseDeleteBook = [(id: string) => Promise<void>, boolean, boolean, string | undefined];
export const useDeleteBook = (): UseDeleteBook => {
  const { bookList, setBookList, clearCompleteBookIds } = useContext(Context);
  const withTargetUser = useWithTargetUser();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const deleteBook = useCallback(
    async (id: string) => {
      // Prevent multiple parallel requests
      if (loading) {
        return;
      }

      const book = bookList[id];
      if (book === undefined) {
        setError(true);
        setErrorMessage('Failed to delete book');
        return;
      }

      setBookList((prev) => removeBookById(id, prev));

      try {
        setLoading(true);
        setError(false);
        setErrorMessage(undefined);
        const res = await apiFetch(withTargetUser(`/api/books/${encodeURIComponent(id)}`), {
          method: 'DELETE',
        });
        if (res.status !== 204) throw new Error('Failed to delete book');
      } catch (err) {
        setError(true);
        setBookList((prev) => ({ ...prev, [book.id]: book }));
        clearCompleteBookIds();
        if (err instanceof Error) setErrorMessage(err.message);
      } finally {
        setLoading(false);
      }
    },
    [withTargetUser, bookList, clearCompleteBookIds, loading, setBookList]
  );

  return useMemo(
    () => [deleteBook, loading, error, errorMessage],
    [deleteBook, loading, error, errorMessage]
  );
};
