import { useQuery } from '@apollo/client/react';
import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router';

import { BookRowFromEntry, Page, SearchBar, SeriesRow } from '~/component';
import { LibrarySwitcher } from '~/component/library-switcher';
import type { LibraryFilter } from '~/gql/graphql';
import { UserListDocument } from '~/graphql/user';
import { SpinnerIcon } from '~/icon';
import { useIsAdmin } from '~/provider/auth';
import { useBookListFilter } from '~/provider/book';
import { useLibraryEntries } from '~/provider/library';
import { useLibraryTarget } from '~/provider/library-target';
import { path } from '~/router';

import { useStyle } from './style';
import { toLibraryFilter } from './to-library-filter';

export const LibraryPage = () => {
  const style = useStyle();
  const [isAdmin] = useIsAdmin();
  const [targetLibraryId] = useLibraryTarget();
  // `UserListDocument` is imported from `~/graphql/user` (a leaf module —
  // this document has readers across multiple routes/providers, see its own
  // doc comment) — this only needs the count (for the "No users registered"
  // empty state), not any per-user field, so no fragment unmask is needed here.
  const { data: userListData, loading: userListLoading } = useQuery(UserListDocument, {
    skip: !isAdmin,
  });
  const userList = userListData?.viewer.users ?? [];
  const [bookListFilter, setBookListFilter] = useBookListFilter();

  // `useBookListFilter` recomputes a fresh `BookListFilter` object from URL
  // search params on every render (see that hook's own doc comment) — never
  // a stable reference. `useLibraryEntries` resets its `fetchMore` error
  // state on `[libraryId, filter]` by REFERENCE equality, so passing that
  // straight through (even re-mapped) would fire the reset effect every
  // render and could clear a legitimate retry state before it's ever shown.
  // Destructuring to primitives (plus a stringified `subjects`) and gating
  // the `useMemo` on those, rather than on `bookListFilter` itself, is what
  // keeps `libraryFilter`'s identity stable across renders that don't
  // actually change the filter.
  const { query, author, seriesName, status, entryType, subjects } = bookListFilter;
  const subjectsKey = subjects && subjects.length > 0 ? JSON.stringify(subjects) : '';
  const libraryFilter = useMemo<LibraryFilter>(
    () =>
      toLibraryFilter({
        query,
        author,
        seriesName,
        status,
        entryType,
        subjects: subjectsKey ? (JSON.parse(subjectsKey) as string[]) : undefined,
      }),
    [query, author, seriesName, status, entryType, subjectsKey]
  );

  const { edges, loading, error, hasNextPage, loadMore } = useLibraryEntries(libraryFilter);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error !== undefined || loading || !hasNextPage) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, error, loading, hasNextPage]);

  if (isAdmin && !targetLibraryId) {
    const noUsers = !userListLoading && userList.length === 0;
    return (
      <Page>
        <LibrarySwitcher />
        <div className={style.emptyState}>
          {noUsers ? (
            <>
              <div className={style.emptyStateTitle}>No users registered</div>
              <div className={style.emptyStateSubtitle}>
                Go to the{' '}
                <Link className={style.link} to={path.userList()}>
                  Users
                </Link>{' '}
                page to register the first user
              </div>
            </>
          ) : (
            <>
              <div className={style.emptyStateTitle}>Select a library</div>
              <div className={style.emptyStateSubtitle}>
                Choose a user above to view and manage their books
              </div>
            </>
          )}
        </div>
      </Page>
    );
  }

  if (!loading && error !== undefined && edges.length === 0) {
    return (
      <Page>
        <LibrarySwitcher />
        <div className={style.emptyState}>
          <div className={style.emptyStateTitle}>Failed to load library</div>
          <div className={style.emptyStateSubtitle}>{error}</div>
        </div>
      </Page>
    );
  }

  const isSearchActive =
    !!bookListFilter.query ||
    !!bookListFilter.author ||
    !!bookListFilter.seriesName ||
    !!bookListFilter.status ||
    (bookListFilter.subjects?.length ?? 0) > 0;

  return (
    <Page>
      <LibrarySwitcher />
      <SearchBar filter={bookListFilter} onChange={setBookListFilter} />
      {edges.length === 0 ? (
        <div className={style.emptyState}>
          {loading ? (
            <SpinnerIcon role="status" aria-label="Loading" className={style.spinner} />
          ) : (
            <>
              <div className={style.emptyStateTitle}>
                {isSearchActive
                  ? 'No books match your search'
                  : `${isAdmin && targetLibraryId ? 'This' : 'Your'} library is empty`}
              </div>
              <div className={style.emptyStateSubtitle}>
                {isSearchActive
                  ? 'Try adjusting or clearing the filters above'
                  : 'No books have been added yet'}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className={style.root}>
          {edges.map((edge) =>
            edge.node.__typename === 'Series' ? (
              <SeriesRow key={edge.cursor} series={edge.node} />
            ) : (
              <BookRowFromEntry key={edge.cursor} book={edge.node} />
            )
          )}
          {hasNextPage && <div ref={sentinelRef} />}
          {error !== undefined && edges.length > 0 && (
            <div className={style.pageError}>
              Failed to load more books
              <br />
              <button type="button" className={style.retryButton} onClick={loadMore}>
                Retry
              </button>
            </div>
          )}
        </div>
      )}
    </Page>
  );
};
