import { useContext, useEffect, useMemo } from 'react';

import { Context } from '../context';
import type { Book } from '../type';

import { useFetchBook } from './use-fetch-book';

export type UseBook =
  | [Book, false, false, undefined]
  | [Book, true, false, undefined]
  | [undefined, true, false, undefined]
  | [undefined, false, true, undefined]
  | [undefined, false, true, string];

export const useBook = (bookId: string, completeBook: boolean = false): UseBook => {
  const { bookList, loadingByBookId, errorByBookId, completeBookIds } = useContext(Context);
  const fetchBook = useFetchBook();

  const loading = loadingByBookId[bookId] ?? false;
  const errorMessage = errorByBookId[bookId];

  useEffect(() => {
    if (
      !loading &&
      errorMessage === undefined &&
      (bookList[bookId] === undefined || (completeBook === true && !completeBookIds.has(bookId)))
    ) {
      void fetchBook(bookId);
    }
  }, [bookId, bookList, loading, errorMessage, fetchBook, completeBookIds, completeBook]);

  return useMemo(() => {
    const book = bookList[bookId];
    const isLoading = loading || (!loading && errorMessage === undefined && book === undefined);
    if (errorMessage !== undefined) return [undefined, false, true, errorMessage] as UseBook;
    if (book === undefined) return [undefined, isLoading, false, undefined] as UseBook;
    return [book, loading, false, undefined] as UseBook;
  }, [bookList, loading, errorMessage, bookId]);
};
