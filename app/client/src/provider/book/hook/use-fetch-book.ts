import { useCallback, useContext } from 'react';

import { Context } from '../context';
import type { Book } from '../type';

export type FetchBook = (bookId: string) => Promise<void>;

export const useFetchBook = (): FetchBook => {
  const { loadingByBookId, setBookList, setLoadingForBook, setErrorForBook, setBookComplete } =
    useContext(Context);

  return useCallback(
    async (bookId: string) => {
      if (loadingByBookId[bookId]) return;

      setLoadingForBook(bookId, true);
      setErrorForBook(bookId, undefined);
      try {
        const response = await fetch(`/api/books/${encodeURIComponent(bookId)}`);
        if (!response.ok) throw new Error('Book not found');
        const book = await (response.json() as Promise<Book>);
        setBookList((prev) => ({ ...prev, [book.id]: book }));
        setBookComplete(bookId);
      } catch (err) {
        setErrorForBook(bookId, err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoadingForBook(bookId, false);
      }
    },
    [loadingByBookId, setBookList, setLoadingForBook, setErrorForBook, setBookComplete]
  );
};
