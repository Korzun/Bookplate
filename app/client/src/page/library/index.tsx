import { useMemo } from 'react';

import { Page, BookRow, SeriesRow } from '~/component';
import { useIsAdmin } from '~/provider/auth';
import { useSeriesList, useStandaloneBookList } from '~/provider/book';
import { useLibraryTarget } from '~/provider/library-target';

import { useStyle } from './style';

export const LibraryPage = () => {
  const style = useStyle();
  const [isAdmin] = useIsAdmin();
  const [targetUsername] = useLibraryTarget();

  const [standaloneBookList] = useStandaloneBookList();
  const [seriesBookList] = useSeriesList();

  const bookList = useMemo(() => {
    return [...seriesBookList, ...standaloneBookList].sort((bookOrSeriesA, bookOrSeriesB) => {
      const titleA = Array.isArray(bookOrSeriesA) ? bookOrSeriesA[0] : bookOrSeriesA.title;
      const titleB = Array.isArray(bookOrSeriesB) ? bookOrSeriesB[0] : bookOrSeriesB.title;
      return titleA.localeCompare(titleB);
    });
  }, [standaloneBookList, seriesBookList]);

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

  return (
    <Page>
      {bookList.length === 0 ? (
        <div className={style.emptyState}>
          <div className={style.emptyStateTitle}>Your library is empty</div>
          <div className={style.emptyStateSubtitle}>No books have been added yet</div>
        </div>
      ) : (
        <div className={style.root}>
          {bookList.map((book) =>
            Array.isArray(book) ? (
              <SeriesRow key={book[0]} seriesName={book[0]} />
            ) : (
              <BookRow key={book.id} bookId={book.id} />
            )
          )}
        </div>
      )}
    </Page>
  );
};
