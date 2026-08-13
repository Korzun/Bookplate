import { useQuery } from '@apollo/client/react';
import { useMemo } from 'react';

import type { FragmentType } from '~/gql';
import { SeriesBookRowFragment, SeriesDetailDocument } from '~/graphql/series';
import { useCurrentLibraryId } from '~/provider/library-target';

/**
 * `series.books` deliberately keeps each `edge.node` MASKED — see this
 * file's own doc comment below (and `use-library-entries.ts`'s, which set
 * the precedent) for why this hook does not unmask it before returning.
 */
export type SeriesDetail = {
  id: string;
  name: string;
  author: string;
  publisher: string;
  totalPages: number;
  totalSize: number;
  subjects: string[];
  progressPercentage: number | null | undefined;
  books: FragmentType<typeof SeriesBookRowFragment>[];
};

export type UseSeriesDetail = {
  series: SeriesDetail | undefined;
  loading: boolean;
  /** Apollo's `error?.message` — see this file's doc comment for what it covers. */
  error: string | undefined;
};

/**
 * The series-detail screen's read: `node(id: $libraryId) { ... on Library {
 * seriesByName(name:) } }` — rooted the same way `useLibraryEntries` roots
 * `entries`, for the same reason (`node(id:)` is the only single root that
 * serves both a non-admin's own library and an admin's selected one; see
 * `useCurrentLibraryId`'s doc comment).
 *
 * Reshapes into a named `{ series, loading, error }` object rather than
 * preserving a REST-era tuple: `useSeries`/`useSeriesBookList`, the two REST
 * hooks this replaces, have only one non-test consumer between them once the
 * series page migrates onto this hook, so the small diff a reshape costs is
 * affordable, and a named object reads better at that one call site than a
 * positional tuple would.
 *
 * Skips the query outright when `libraryId` is `undefined`, exactly as
 * `useLibraryEntries` does — an admin with no library selected has nothing
 * to root `node(id:)` on. `loading` folds in `useCurrentLibraryId`'s own
 * bootstrap round trip for the same cold-load reason documented there: a
 * skipped `useQuery` reports `loading: false` on its own, which would flash
 * a false "series not found" for the whole `ViewerBootstrap` window without
 * this fold-in.
 *
 * **A series name the library does not have** resolves `seriesByName` to
 * `null` — the server's own "not found" answer, not a failure. That surfaces
 * here as `series: undefined` with `error: undefined`, deliberately
 * indistinguishable from "haven't loaded yet" at the type level; a consumer
 * tells the two apart via `loading`, the same way any not-found screen does.
 *
 * **Error-surfacing policy** (same decision `useLibraryEntries` made,
 * followed here rather than re-litigated): `error` is Apollo's own
 * `error?.message`, nothing more.
 *
 * **`books` stays MASKED.** `edge.node` carries `id` plus a `FragmentType`
 * ref for `SeriesBookRowFragment`, not the unwrapped `title`/`seriesIndex`/
 * etc. fields. This hook returns `edge.node` AS IS — it does not map it into
 * a plain object, which would strip the fragment ref marker your editor
 * can't see but Apollo's `useFragment` depends on to look the data back up.
 * The reason is the same one `use-library-entries.ts` documents at length:
 * unmasking here, in a `.map()` over a shared array, would call
 * `useFragment` conditionally/in a loop from one shared place — exactly what
 * `react-hooks/rules-of-hooks` forbids. Handing back the masked ref instead
 * removes the conflict: each row component (Task 6) calls `useFragment`
 * exactly once, unconditionally, in its OWN render context.
 */
export const useSeriesDetail = (name: string): UseSeriesDetail => {
  const { libraryId, loading: libraryIdLoading } = useCurrentLibraryId();
  const { data, loading, error } = useQuery(SeriesDetailDocument, {
    variables: { libraryId: libraryId ?? '', name },
    skip: libraryId === undefined,
  });

  const node = data?.node;
  const series = node?.__typename === 'Library' ? (node.seriesByName ?? undefined) : undefined;

  return useMemo(
    () => ({
      series: series
        ? { ...series, books: series.books.edges.map((edge) => edge.node) }
        : undefined,
      loading: loading || libraryIdLoading,
      error: error?.message,
    }),
    [series, loading, libraryIdLoading, error]
  );
};
