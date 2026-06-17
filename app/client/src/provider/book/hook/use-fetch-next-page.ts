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
      if (bookListFilter.query) params.append('query', bookListFilter.query);
      if (bookListFilter.author) params.append('author', bookListFilter.author);
      if (bookListFilter.seriesName) params.append('seriesName', bookListFilter.seriesName);
      if (bookListFilter.status) params.append('status', bookListFilter.status);
      for (const subject of bookListFilter.subjects ?? []) {
        params.append('subjects', subject);
      }
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
