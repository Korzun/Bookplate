import { useCallback, useContext } from 'react';

import { useIsAdmin } from '~/provider/auth';
import { useLibraryTarget, useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from '../../../lib/api-fetch';
import { Context } from '../context';
import type { BookList, PagedBookListResponse } from '../type';

export type FetchNextPage = () => Promise<void>;

export const useFetchNextPage = (): FetchNextPage => {
  const {
    bookListLoading,
    nextCursor,
    completeBookIds,
    bookListFilter,
    setBookList,
    setBookListLoading,
    setBookListError,
    setBookListItems,
    setNextCursor,
  } = useContext(Context);
  const [isAdmin] = useIsAdmin();
  const [targetUsername] = useLibraryTarget();
  const withTargetUser = useWithTargetUser();

  return useCallback(async () => {
    if (isAdmin && !targetUsername) return;
    if (bookListLoading) return;
    if (nextCursor === null) return;

    setBookListLoading(true);
    setBookListError(undefined);
    try {
      const params = new URLSearchParams();
      params.append('cursor', nextCursor);
      if (bookListFilter.type) params.append('type', bookListFilter.type);
      if (bookListFilter.status) params.append('status', bookListFilter.status);
      params.append('take', '20');
      const url = withTargetUser(`/api/books?${params.toString()}`);
      const response = await apiFetch(url);
      if (!response.ok) throw new Error('Failed to fetch books');
      const {
        items,
        books,
        nextCursor: newCursor,
      } = await (response.json() as Promise<PagedBookListResponse>);
      setBookList((prev: BookList) =>
        books.reduce(
          (acc, book) => ({
            ...acc,
            [book.id]:
              completeBookIds.has(book.id) && prev[book.id] !== undefined
                ? prev[book.id]
                : { ...book, identifiers: [], subjects: [] },
          }),
          prev
        )
      );
      setBookListItems((prev) => [...prev, ...items]);
      setNextCursor(newCursor);
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
    nextCursor,
    completeBookIds,
    bookListFilter,
    setBookList,
    setBookListLoading,
    setBookListError,
    setBookListItems,
    setNextCursor,
  ]);
};
