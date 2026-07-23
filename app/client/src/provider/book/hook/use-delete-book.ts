import { useCallback, useContext, useMemo, useState } from 'react';

import { useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from '../../../lib/api-fetch';
import { Context } from '../context';
import { BookList, DisplayUnit } from '../type';

const removeBookById = (bookId: string, { [bookId]: _, ...rest }: BookList) => rest;

const isStandalone = (item: DisplayUnit, bookId: string) =>
  item.type === 'standalone' && item.bookId === bookId;

const isSeries = (item: DisplayUnit, seriesName: string) =>
  item.type === 'series' && item.seriesName === seriesName;

export type UseDeleteBook = [(id: string) => Promise<void>, boolean, boolean, string | undefined];
export const useDeleteBook = (): UseDeleteBook => {
  const { bookList, bookListItems, setBookList, setBookListItems, clearCompleteBookIds } =
    useContext(Context);
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

      // The book's list item disappears too when it is a standalone entry, or the
      // last remaining book of its series (the server deletes the emptied series).
      const isLastInSeries =
        book.series.length > 0 &&
        !Object.values(bookList).some((other) => other.id !== id && other.series === book.series);
      const isRemovedItem = (item: DisplayUnit) =>
        isStandalone(item, id) || (isLastInSeries && isSeries(item, book.series));

      const itemIndex = bookListItems.findIndex(isRemovedItem);
      const removedItem = itemIndex === -1 ? undefined : bookListItems[itemIndex];

      setBookList((prev) => removeBookById(id, prev));
      if (removedItem) {
        setBookListItems((prev) => prev.filter((item) => !isRemovedItem(item)));
      }

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
        if (removedItem) {
          setBookListItems((prev) => {
            if (prev.some(isRemovedItem)) return prev;
            const restored = [...prev];
            restored.splice(itemIndex, 0, removedItem);
            return restored;
          });
        }
        clearCompleteBookIds();
        if (err instanceof Error) setErrorMessage(err.message);
      } finally {
        setLoading(false);
      }
    },
    [
      withTargetUser,
      bookList,
      bookListItems,
      clearCompleteBookIds,
      loading,
      setBookList,
      setBookListItems,
    ]
  );

  return useMemo(
    () => [deleteBook, loading, error, errorMessage],
    [deleteBook, loading, error, errorMessage]
  );
};
