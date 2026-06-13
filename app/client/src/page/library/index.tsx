import { useEffect, useRef } from 'react';

import { Page, BookRow, SeriesRow } from '~/component';
import { useIsAdmin } from '~/provider/auth';
import { useBookList, useBookListItems, useFetchNextPage } from '~/provider/book';
import { useLibraryTarget } from '~/provider/library-target';

import { useStyle } from './style';

export const LibraryPage = () => {
  const style = useStyle();
  const [isAdmin] = useIsAdmin();
  const [targetUsername] = useLibraryTarget();

  // useBookList triggers the initial fetch and provides loading/error state
  const [, bookListLoading, hasError, bookListError] = useBookList();
  const [bookListItems, nextCursor] = useBookListItems();
  const fetchNextPage = useFetchNextPage();
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          void fetchNextPage();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage]);

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

  return (
    <Page>
      {bookListItems.length === 0 ? (
        <div className={style.emptyState}>
          <div className={style.emptyStateTitle}>Your library is empty</div>
          <div className={style.emptyStateSubtitle}>No books have been added yet</div>
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
          {nextCursor !== null && (
            <div ref={sentinelRef} />
          )}
          {hasError && bookListItems.length > 0 && (
            <div className={style.pageError}>
              Failed to load more books
              <br />
              <button className={style.retryButton} onClick={() => void fetchNextPage()}>
                Retry
              </button>
            </div>
          )}
        </div>
      )}
    </Page>
  );
};
