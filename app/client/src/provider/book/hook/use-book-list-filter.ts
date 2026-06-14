import { useContext } from 'react';

import { Context } from '../context';
import type { BookListFilter } from '../type';

export const useBookListFilter = (): [BookListFilter, (filter: BookListFilter) => void] => {
  const { bookListFilter, setBookListFilter } = useContext(Context);
  return [bookListFilter, setBookListFilter];
};
