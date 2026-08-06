import { createContext } from 'react';

import type { BookList, BookListFilter, DisplayUnit } from './type';

export type BookContext = {
  bookList: BookList;
  bookListFetched: boolean;
  bookListLoading: boolean;
  bookListError: string | undefined;
  loadingByBookId: Record<string, boolean>;
  errorByBookId: Record<string, string | undefined>;
  completeBookIds: Set<string>;
  bookListItems: DisplayUnit[];
  bookListFilter: BookListFilter;
  setBookList: (updater: (prev: BookList) => BookList) => void;
  setBookListFetched: (fetched: boolean) => void;
  setBookListLoading: (loading: boolean) => void;
  setBookListError: (error: string | undefined) => void;
  setLoadingForBook: (bookId: string, loading: boolean) => void;
  setErrorForBook: (bookId: string, error: string | undefined) => void;
  setBookComplete: (bookId: string) => void;
  clearCompleteBookIds: () => void;
  setBookListItems: (updater: (prev: DisplayUnit[]) => DisplayUnit[]) => void;
  setBookListFilter: (filter: BookListFilter) => void;
};

export const Context = createContext<BookContext>({
  bookList: {},
  bookListFetched: false,
  bookListLoading: false,
  bookListError: undefined,
  loadingByBookId: {},
  errorByBookId: {},
  completeBookIds: new Set(),
  bookListItems: [],
  bookListFilter: {},
  setBookList: () => {},
  setBookListFetched: () => {},
  setBookListLoading: () => {},
  setBookListError: () => {},
  setLoadingForBook: () => {},
  setErrorForBook: () => {},
  setBookComplete: () => {},
  clearCompleteBookIds: () => {},
  setBookListItems: () => {},
  setBookListFilter: () => {},
});
