import { useContext, useEffect, useMemo } from 'react';

import { Context } from '../context';
import type { Book } from '../type';

import { useFetchBookList } from './use-fetch-book-list';

export type UseBookList =
  | [Book[], false, false, undefined]
  | [Book[], true, false, undefined]
  | [Book[], false, true, undefined]
  | [Book[], false, true, string];

export const useBookList = (): UseBookList => {
  const { bookList, bookListFetched, bookListLoading, bookListError } = useContext(Context);
  const fetchBookList = useFetchBookList();

  useEffect(() => {
    if (!bookListLoading && bookListError === undefined && !bookListFetched) {
      void fetchBookList();
    }
  }, [bookListFetched, bookListLoading, bookListError, fetchBookList]);

  return useMemo(
    () =>
      [
        Object.values(bookList).sort((a, b) => a.title.localeCompare(b.title)),
        bookListLoading,
        bookListError !== undefined,
        bookListError,
      ] as UseBookList,
    [bookList, bookListLoading, bookListError]
  );
};
