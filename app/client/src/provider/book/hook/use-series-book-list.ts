import { useMemo } from 'react';

import { Book } from '../type';
import { useBookList } from './use-book-list';

export type UseSeriesBookList =
  | [Book[], false, false, undefined] // Data was successfully loaded
  | [Book[], true, false, undefined] // Data was already successfully and new data is being loaded
  | [undefined, true, false, undefined] // Data is being loaded
  | [undefined, false, true, undefined] // There was an unspecified error while loading data
  | [undefined, false, true, string]; // There was a specified error while loading data
export const useSeriesBookList = (seriesName: string): UseSeriesBookList => {
  const [bookList, loading, error, errorMessage] = useBookList();

  return useMemo(() => {
    if (error === true) {
      return [undefined, false, error, errorMessage];
    }

    const seriesMap = new Map<string, Book[]>();
    for (const book of bookList) {
      if (book.series.length > 0) {
        if (!seriesMap.has(book.series)) {
          seriesMap.set(book.series, []);
        }
        seriesMap.get(book.series)!.push(book);
      }
    }
    for (const seriesBooks of seriesMap.values()) {
      seriesBooks.sort((bookA, bookB) => bookA.seriesIndex - bookB.seriesIndex);
    }

    const seriesBookList = seriesMap.get(seriesName);
    if (
      (loading === true && seriesMap.size > 0 && seriesBookList === undefined) ||
      (loading === false && seriesBookList === undefined)
    ) {
      return [undefined, false, true, `Unknown series ${seriesName}`];
    }

    if (loading === true) {
      return [seriesBookList, loading, false, undefined];
    }

    return [seriesBookList!, false, false, undefined];
  }, [bookList, loading, error, errorMessage, seriesName]);
};
