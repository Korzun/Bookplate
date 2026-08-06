import { useEffect, useState } from 'react';

import { apiFetch } from '~/lib/api-fetch';
import { useWithTargetUser } from '~/provider/library-target';

import type { Book, PagedBookListResponse } from '../type';

export type UseSeriesBookList =
  | [Book[], false, false, undefined] // Data was successfully loaded
  | [undefined, true, false, undefined] // Data is being loaded
  | [undefined, false, true, undefined] // There was an unspecified error while loading data
  | [undefined, false, true, string]; // There was a specified error while loading data

/**
 * `/api/books`'s own page-size clamp (`routes/ui.ts`: `Math.min(Math.max(
 * parseInt(take,10)||20,1),100)`) — the largest single page the server will
 * return, used here as "large enough to hold one series' worth of books in
 * one request" rather than a real pagination boundary. A series with more
 * than 100 books would silently truncate; no shipped library approaches
 * that, and paging a single series is out of this hook's scope.
 */
const MAX_TAKE = 100;

type FetchResult = { seriesName: string; books: Book[] } | { seriesName: string; error: string };

/**
 * Fetches this series' books directly from the server, filtered by
 * `seriesName` (`GET /api/books?seriesName=…`, already supported by
 * `listBooksPage`'s `filters.seriesName` — the same param `component/search-bar`
 * puts on the URL for the pre-GraphQL grid). Deliberately does NOT read
 * through `useBookList`'s shared, Context-wide list: that list is fetched
 * ONCE, unfiltered, capped at 20 entries (`use-fetch-book-list.ts`), and
 * nothing has grown it past page 1 since Task 11 deleted the REST
 * `fetchMore` the pre-GraphQL grid used to drive it — `page/library` now
 * grows its own separate GraphQL connection instead
 * (`provider/library/hook/use-library-entries.ts`). A series whose books
 * never landed on that frozen page 1 (i.e. almost any series past the
 * library's first ~20 REST-sort-order entries) used to look genuinely
 * missing to every consumer of the old `useSeriesBookList` — `page/series`
 * itself, plus `useMySeriesProgress`/`useUserSeriesProgress` — even though
 * the series exists and is one click away in the (correctly paginated)
 * GraphQL grid. This hook's own request is scoped to exactly the series
 * asked for, so it is correct regardless of where in the grid that series
 * sits or how the shared REST list's single page happens to be sorted.
 *
 * `CoverStack` no longer uses this hook (it reads `Series.books` off
 * `LibraryEntriesQuery` — `component/cover-stack`'s own doc comment); the
 * only remaining callers are `page/series` and the two `use*SeriesProgress`
 * hooks, none of which needs the shared bookList's cross-book caching this
 * hook used to piggyback on.
 */
export const useSeriesBookList = (seriesName: string): UseSeriesBookList => {
  const [result, setResult] = useState<FetchResult | null>(null);
  const withTargetUser = useWithTargetUser();

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ seriesName, take: String(MAX_TAKE) });
    void apiFetch(withTargetUser(`/api/books?${params.toString()}`))
      .then(async (res) => {
        if (!res.ok) throw new Error(`Unknown series ${seriesName}`);
        const { books } = await (res.json() as Promise<PagedBookListResponse>);
        if (books.length === 0) throw new Error(`Unknown series ${seriesName}`);
        const sorted: Book[] = [...books]
          .sort((a, b) => a.seriesIndex - b.seriesIndex)
          .map((book) => ({ ...book, identifiers: [], subjects: [] }));
        if (!cancelled) setResult({ seriesName, books: sorted });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setResult({
            seriesName,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [seriesName, withTargetUser]);

  if (result === null || result.seriesName !== seriesName)
    return [undefined, true, false, undefined];
  if ('error' in result) return [undefined, false, true, result.error];
  return [result.books, false, false, undefined];
};
