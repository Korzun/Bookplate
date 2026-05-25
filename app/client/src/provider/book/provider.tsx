import { useCallback, useState, type ReactNode } from 'react';

import { Context } from './context';
import type { BookList } from './type';

export type BookProviderProps = { children: ReactNode };
export const BookProvider = ({ children }: BookProviderProps) => {
  const [bookList, setBookListRaw] = useState<BookList>({});
  const [bookListFetched, setBookListFetched] = useState(false);
  const [bookListLoading, setBookListLoading] = useState(false);
  const [bookListError, setBookListError] = useState<string | undefined>();
  const [loadingByBookId, setLoadingByBookIdRaw] = useState<Record<string, boolean>>({});
  const [errorByBookId, setErrorByBookIdRaw] = useState<Record<string, string | undefined>>({});
  const [completeBookIds, setCompleteBookIdsRaw] = useState(new Set<string>());

  const setBookList = useCallback(
    (updater: (prev: BookList) => BookList) => setBookListRaw(updater),
    []
  );

  const setLoadingForBook = useCallback((bookId: string, loading: boolean) => {
    setLoadingByBookIdRaw((prev) => ({ ...prev, [bookId]: loading }));
  }, []);

  const setErrorForBook = useCallback((bookId: string, error: string | undefined) => {
    setErrorByBookIdRaw((prev) => ({ ...prev, [bookId]: error }));
  }, []);

  const setBookComplete = useCallback((bookId: string) => {
    setCompleteBookIdsRaw((prev) => new Set([...prev, bookId]));
  }, []);

  const clearCompleteBookIds = useCallback(() => {
    setCompleteBookIdsRaw(new Set());
  }, []);

  return (
    <Context.Provider
      value={{
        bookList,
        bookListFetched,
        bookListLoading,
        bookListError,
        loadingByBookId,
        errorByBookId,
        completeBookIds,
        setBookList,
        setBookListFetched,
        setBookListLoading,
        setBookListError,
        setLoadingForBook,
        setErrorForBook,
        setBookComplete,
        clearCompleteBookIds,
      }}
    >
      {children}
    </Context.Provider>
  );
};
