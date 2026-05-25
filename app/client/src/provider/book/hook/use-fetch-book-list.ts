import { useCallback, useContext } from 'react';

import { Context } from '../context';
import type { Book, BookList } from '../type';

export type FetchBookList = () => Promise<void>;

export const useFetchBookList = (): FetchBookList => {
  const {
    bookListLoading,
    bookList,
    completeBookIds,
    setBookList,
    setBookListFetched,
    setBookListLoading,
    setBookListError,
  } = useContext(Context);

  return useCallback(async () => {
    if (bookListLoading) return;

    setBookListLoading(true);
    setBookListError(undefined);
    try {
      const response = await fetch('/api/books');
      if (!response.ok) throw new Error('Failed to fetch books');
      const bookListArray = await (response.json() as Promise<Book[]>);
      setBookList(() =>
        bookListArray.reduce(
          (acc, book) => ({
            ...acc,
            [book.id]:
              completeBookIds.has(book.id) && bookList[book.id] !== undefined
                ? bookList[book.id]
                : { ...book, identifiers: book.identifiers ?? [], subjects: book.subjects ?? [] },
          }),
          {} as BookList
        )
      );
      setBookListFetched(true);
    } catch (err) {
      setBookListError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBookListLoading(false);
    }
  }, [
    bookListLoading,
    bookList,
    completeBookIds,
    setBookList,
    setBookListFetched,
    setBookListLoading,
    setBookListError,
  ]);
};
