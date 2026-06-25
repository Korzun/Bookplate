import { useMemo } from 'react';

import { seriesSortKey } from '~/lib/series-sort-key';

import { Book } from '../type';

import { useBookList } from './use-book-list';

export type UseSeriesList = [[string, Book[]][], boolean, boolean, string | undefined];
export const useSeriesList = (): UseSeriesList => {
  const [bookList, loading, error, errorMessage] = useBookList();
  const seriesList = useMemo(() => {
    const seriesMap = new Map<string, Book[]>();
    for (const book of bookList) {
      if (book.series.length > 0) {
        if (!seriesMap.has(book.series)) {
          seriesMap.set(book.series, []);
        }
        seriesMap.get(book.series)!.push(book);
      }
    }
    for (const bookList of seriesMap.values()) {
      bookList.sort((bookA, bookB) => bookA.seriesIndex - bookB.seriesIndex);
    }
    return [...seriesMap.entries()].sort(([seriesA], [seriesB]) =>
      seriesSortKey(seriesA).localeCompare(seriesSortKey(seriesB))
    );
  }, [bookList]);
  return useMemo(
    () => [seriesList, loading, error, errorMessage],
    [seriesList, loading, error, errorMessage]
  );
};
