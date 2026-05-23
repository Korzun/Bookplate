import { useMemo } from 'react';

import type { Book } from '../type';

import { useBookList } from './use-book-list';

export type UseStandaloneBookList = [Book[], boolean, boolean, string | undefined];
export const useStandaloneBookList = (): UseStandaloneBookList => {
  const [bookList, loading, error, errorMessage] = useBookList();
  const standaloneBookList = useMemo(() => {
    return [...bookList].filter((book) => !book.series);
  }, [bookList]);
  return useMemo(
    () => [standaloneBookList, loading, error, errorMessage],
    [standaloneBookList, loading, error, errorMessage]
  );
};
