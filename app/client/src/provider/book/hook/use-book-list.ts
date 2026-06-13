import { useContext, useEffect, useMemo, useRef } from 'react';

import { useLibraryTarget } from '~/provider/library-target';

import { Context } from '../context';
import type { Book } from '../type';

import { useFetchBookList } from './use-fetch-book-list';

export type UseBookList =
  | [Book[], false, false, undefined]
  | [Book[], true, false, undefined]
  | [Book[], false, true, undefined]
  | [Book[], false, true, string];

export const useBookList = (): UseBookList => {
  const {
    bookList,
    bookListFetched,
    bookListLoading,
    bookListError,
    setBookListFetched,
    setBookListError,
    clearCompleteBookIds,
    setBookListItems,
    setNextCursor,
  } = useContext(Context);
  const fetchBookList = useFetchBookList();
  const [targetUsername] = useLibraryTarget();

  useEffect(() => {
    if (!bookListLoading && bookListError === undefined && !bookListFetched) {
      void fetchBookList();
    }
  }, [bookListFetched, bookListLoading, bookListError, fetchBookList]);

  // On target change only reset state; calling fetchBookList here would use a
  // callback that still closes over the previous target's completeBookIds and
  // bookList, reusing cached entries when book ids collide across libraries.
  // The trigger effect above refetches once the cleared state has flushed, and
  // clearing the error unblocks it after a failed fetch of a stale target.
  const prevTargetRef = useRef(targetUsername);
  useEffect(() => {
    if (prevTargetRef.current === targetUsername) return;
    prevTargetRef.current = targetUsername;
    clearCompleteBookIds();
    setBookListError(undefined);
    setBookListFetched(false);
    setBookListItems(() => []);
    setNextCursor(null);
  }, [
    targetUsername,
    setBookListFetched,
    setBookListError,
    clearCompleteBookIds,
    setBookListItems,
    setNextCursor,
  ]);

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
