import { useCallback, use } from 'react';

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
    bookListFilter,
  } = use(Context);
  const [isAdmin] = useIsAdmin();
  const [targetLibraryId, setTargetLibraryId] = useLibraryTarget();
  const withTargetUser = useWithTargetUser();

  return useCallback(async () => {
    if (isAdmin && !targetLibraryId) return;
    // `withTargetUser` restores `targetLibraryId` (the selected Library's
    // global id) synchronously from `localStorage`, but resolving it to a
    // USERNAME is a network round trip (`UserListDocument`) that cannot have
    // answered yet on the very first render after a cold page load. Firing
    // here anyway would build a `?user=`-less URL, which the server 400s —
    // and unlike a real failure, retrying it would keep 400ing until the
    // query resolves, so this bails WITHOUT setting `bookListError`,
    // leaving `bookListFetched`/`bookListLoading` at their initial values so
    // `useBookList`'s trigger effect (gated on `bookListError === undefined`)
    // fires again the moment `withTargetUser`'s identity changes to `ready`.
    if (isAdmin && !withTargetUser.ready) return;
    // `ready` but no resolved username: the stored selection matches no user
    // in the (settled) list — a deleted owner, an id stale across installs,
    // or the UserList query itself errored. A request built from this state
    // can never carry `?user=`, and the server 400s every such admin
    // request, which would otherwise `throw` below and latch a permanent
    // `bookListError` with no route back (round-2 review finding — this is
    // the SAME "Select a library" fallback the 404 branch further down
    // already covers for a request the server itself rejects; this clears
    // the selection before ever attempting one).
    if (isAdmin && !withTargetUser.username) {
      setTargetLibraryId(undefined);
      return;
    }
    if (bookListLoading) return;

    setBookListLoading(true);
    setBookListError(undefined);
    try {
      const params = new URLSearchParams();
      if (bookListFilter.query) params.append('query', bookListFilter.query);
      if (bookListFilter.author) params.append('author', bookListFilter.author);
      if (bookListFilter.seriesName) params.append('seriesName', bookListFilter.seriesName);
      if (bookListFilter.status) params.append('status', bookListFilter.status);
      for (const subject of bookListFilter.subjects ?? []) {
        params.append('subjects', subject);
      }
      if (bookListFilter.entryType) params.append('entryType', bookListFilter.entryType);
      params.append('take', '20');
      const response = await apiFetch(withTargetUser(`/api/books?${params.toString()}`));
      // Reaching here means `withTargetUser.username` WAS resolved (the
      // guard above already clears an unresolvable selection before ever
      // building a request) — so a 404 here means the client's cached
      // `UserListDocument` match was itself stale (the owner was deleted
      // server-side after this admin's list was fetched but before the
      // cache refreshed). Same fallback either way: clear the selection so
      // the page falls back to "Select a library" instead of a load failure.
      if (response.status === 404 && isAdmin && targetLibraryId) {
        setTargetLibraryId(undefined);
        return;
      }
      if (!response.ok) throw new Error('Failed to fetch books');
      const { items, books } = await (response.json() as Promise<PagedBookListResponse>);
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
      setBookListFetched(true);
    } catch (err) {
      setBookListError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBookListLoading(false);
    }
  }, [
    isAdmin,
    targetLibraryId,
    setTargetLibraryId,
    withTargetUser,
    bookListLoading,
    bookList,
    completeBookIds,
    setBookList,
    setBookListFetched,
    setBookListLoading,
    setBookListError,
    setBookListItems,
    bookListFilter,
  ]);
};
