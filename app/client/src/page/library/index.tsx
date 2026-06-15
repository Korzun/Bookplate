import { useEffect, useRef } from 'react';

import { Page, BookRow, FilterBar, SeriesRow } from '~/component';
import { SpinnerIcon } from '~/icon';
import { useIsAdmin } from '~/provider/auth';
import {
  useBookList,
  useBookListFilter,
  useBookListItems,
  useFetchNextPage,
} from '~/provider/book';
import { useLibraryTarget } from '~/provider/library-target';

import { useStyle } from './style';

export const LibraryPage = () => {
  const style = useStyle();
  const [isAdmin] = useIsAdmin();
  const [targetUsername] = useLibraryTarget();
  const [bookListFilter, setBookListFilter] = useBookListFilter();

  const [, bookListLoading, hasError, bookListError] = useBookList();
  const [bookListItems, nextCursor] = useBookListItems();
  const fetchNextPage = useFetchNextPage();
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (hasError || bookListLoading || nextCursor === null) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void fetchNextPage();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasError, bookListLoading, nextCursor]);

  if (isAdmin && !targetUsername) {
    return (
      <Page>
        <div className={style.emptyState}>
          <div className={style.emptyStateTitle}>Select a library</div>
          <div className={style.emptyStateSubtitle}>
            Choose a user from the library selector in the header to view and manage their books
          </div>
        </div>
      </Page>
    );
  }

  if (!bookListLoading && hasError && bookListItems.length === 0) {
    return (
      <Page>
        <div className={style.emptyState}>
          <div className={style.emptyStateTitle}>Failed to load library</div>
          <div className={style.emptyStateSubtitle}>{bookListError}</div>
        </div>
      </Page>
    );
  }

  const isFilterActive = bookListFilter.type !== undefined || bookListFilter.status !== undefined;

  return (
    <Page>
      <FilterBar filter={bookListFilter} onChange={setBookListFilter} />
      {bookListItems.length === 0 ? (
        <div className={style.emptyState}>
          {bookListLoading ? (
            <SpinnerIcon role="status" aria-label="Loading" className={style.spinner} />
          ) : (
            <>
              <div className={style.emptyStateTitle}>
                {isFilterActive ? 'No books match these filters' : 'Your library is empty'}
              </div>
              <div className={style.emptyStateSubtitle}>
                {isFilterActive
                  ? 'Try adjusting or clearing the filters above'
                  : 'No books have been added yet'}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className={style.root}>
          {bookListItems.map((item) =>
            item.type === 'series' ? (
              <SeriesRow key={item.seriesName} seriesName={item.seriesName} />
            ) : (
              <BookRow key={item.bookId} bookId={item.bookId} />
            )
          )}
          {nextCursor !== null && <div ref={sentinelRef} />}
          {hasError && bookListItems.length > 0 && (
            <div className={style.pageError}>
              Failed to load more books
              <br />
              <button
                type="button"
                className={style.retryButton}
                onClick={() => void fetchNextPage()}
              >
                Retry
              </button>
            </div>
          )}
        </div>
      )}
    </Page>
  );
};
