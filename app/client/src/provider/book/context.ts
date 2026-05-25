import { createContext } from 'react';

import type { BookList } from './type';

export type BookContext = {
  bookList: BookList;
  bookListFetched: boolean;
  bookListLoading: boolean;
  bookListError: string | undefined;
  loadingByBookId: Record<string, boolean>;
  errorByBookId: Record<string, string | undefined>;
  completeBookIds: Set<string>;
  setBookList: (updater: (prev: BookList) => BookList) => void;
  setBookListFetched: (fetched: boolean) => void;
  setBookListLoading: (loading: boolean) => void;
  setBookListError: (error: string | undefined) => void;
  setLoadingForBook: (bookId: string, loading: boolean) => void;
  setErrorForBook: (bookId: string, error: string | undefined) => void;
  setBookComplete: (bookId: string) => void;
  clearCompleteBookIds: () => void;
};

export const Context = createContext<BookContext>({
  bookList: {},
  bookListFetched: false,
  bookListLoading: false,
  bookListError: undefined,
  loadingByBookId: {},
  errorByBookId: {},
  completeBookIds: new Set(),
  setBookList: () => {},
  setBookListFetched: () => {},
  setBookListLoading: () => {},
  setBookListError: () => {},
  setLoadingForBook: () => {},
  setErrorForBook: () => {},
  setBookComplete: () => {},
  clearCompleteBookIds: () => {},
});
