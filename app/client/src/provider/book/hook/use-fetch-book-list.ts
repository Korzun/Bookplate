import { useCallback, useContext } from 'react';

import { useIsAdmin } from '~/provider/auth';
import { useLibraryTarget, useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from '../../../lib/api-fetch';
import { Context } from '../context';
import type { BookList, PagedBookListResponse } from '../type';

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
    setBookListItems,
    setNextCursor,
    bookListFilter,
  } = useContext(Context);
  const [isAdmin] = useIsAdmin();
  const [targetUsername] = useLibraryTarget();
  const withTargetUser = useWithTargetUser();

  return useCallback(async () => {
    if (isAdmin && !targetUsername) return;
    if (bookListLoading) return;

    setBookListLoading(true);
    setBookListError(undefined);
    try {
      const params = new URLSearchParams();
      if (bookListFilter.type) params.append('type', bookListFilter.type);
      if (bookListFilter.status) params.append('status', bookListFilter.status);
      if (bookListFilter.subject) params.append('subject', bookListFilter.subject);
      params.append('take', '20');
      const response = await apiFetch(withTargetUser(`/api/books?${params.toString()}`));
      if (!response.ok) throw new Error('Failed to fetch books');
      const { items, books, nextCursor } =
        await (response.json() as Promise<PagedBookListResponse>);
      setBookList(() =>
        books.reduce(
          (acc, book) => ({
            ...acc,
            [book.id]:
              completeBookIds.has(book.id) && bookList[book.id] !== undefined
                ? bookList[book.id]
                : { ...book, identifiers: [], subjects: [] },
          }),
          {} as BookList
        )
      );
      setBookListItems(() => items);
      setNextCursor(nextCursor);
      setBookListFetched(true);
    } catch (err) {
      setBookListError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBookListLoading(false);
    }
  }, [
    isAdmin,
    targetUsername,
    withTargetUser,
    bookListLoading,
    bookList,
    completeBookIds,
    setBookList,
    setBookListFetched,
    setBookListLoading,
    setBookListError,
    setBookListItems,
    setNextCursor,
    bookListFilter,
  ]);
};
