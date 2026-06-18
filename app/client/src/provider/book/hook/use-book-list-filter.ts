import { useCallback, useContext, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Context } from '../context';
import type { BookListFilter } from '../type';

function filterFromSearchParams(params: URLSearchParams): BookListFilter {
  const filter: BookListFilter = {};
  const q = params.get('q');
  if (q) filter.query = q;
  const author = params.get('author');
  if (author) filter.author = author;
  const seriesName = params.get('seriesName');
  if (seriesName) filter.seriesName = seriesName;
  const status = params.get('status');
  if (status === 'not-started' || status === 'in-progress' || status === 'completed')
    filter.status = status;
  const subjects = params.getAll('subjects');
  if (subjects.length > 0) filter.subjects = subjects;
  return filter;
}

export function filterToSearchParams(filter: BookListFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.query) params.set('q', filter.query);
  if (filter.author) params.set('author', filter.author);
  if (filter.seriesName) params.set('seriesName', filter.seriesName);
  if (filter.status) params.set('status', filter.status);
  for (const s of filter.subjects ?? []) params.append('subjects', s);
  return params;
}

function filtersEqual(a: BookListFilter, b: BookListFilter): boolean {
  return (
    a.query === b.query &&
    a.author === b.author &&
    a.seriesName === b.seriesName &&
    a.status === b.status &&
    JSON.stringify([...(a.subjects ?? [])].sort()) ===
      JSON.stringify([...(b.subjects ?? [])].sort())
  );
}

export const useBookListFilter = (): [BookListFilter, (filter: BookListFilter) => void] => {
  const { bookListFilter, setBookListFilter } = useContext(Context);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const urlFilter = filterFromSearchParams(searchParams);
    if (filtersEqual(urlFilter, bookListFilter)) return;
    setBookListFilter(urlFilter);
  }, [searchParams, bookListFilter, setBookListFilter]);

  const setFilter = useCallback(
    (newFilter: BookListFilter) => {
      setBookListFilter(newFilter);
      setSearchParams(filterToSearchParams(newFilter), { replace: true });
    },
    [setBookListFilter, setSearchParams]
  );

  return [bookListFilter, setFilter];
};
