import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

import type { BookListFilter } from './book-types';

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
  const entryType = params.get('entryType');
  if (entryType === 'series' || entryType === 'standalone') filter.entryType = entryType;
  return filter;
}

export function filterToSearchParams(filter: BookListFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.query) params.set('q', filter.query);
  if (filter.author) params.set('author', filter.author);
  if (filter.seriesName) params.set('seriesName', filter.seriesName);
  if (filter.status) params.set('status', filter.status);
  for (const s of filter.subjects ?? []) params.append('subjects', s);
  if (filter.entryType) params.set('entryType', filter.entryType);
  return params;
}

/**
 * Pure URL state. The URL is the single source of truth for the library
 * filter, and always was — this hook previously mirrored the filter into
 * `BookContext` as well, but returned the URL-derived value regardless, so the
 * context copy's only reader was its own dedup effect. Removing it left
 * `BookContext` with no readers at all (step-10 spec §3.1).
 */
export const useBookListFilter = (): [BookListFilter, (filter: BookListFilter) => void] => {
  const [searchParams, setSearchParams] = useSearchParams();

  const setFilter = useCallback(
    (newFilter: BookListFilter) => {
      setSearchParams(filterToSearchParams(newFilter), { replace: true });
    },
    [setSearchParams]
  );

  return [filterFromSearchParams(searchParams), setFilter];
};
