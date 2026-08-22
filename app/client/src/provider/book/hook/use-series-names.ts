import { useQuery } from '@apollo/client/react';

import { SeriesNamesDocument } from '~/graphql/library';
import { useCurrentLibraryId } from '~/provider/library-target';

/**
 * The library's series names, ordered as `Library.series` returns them
 * (the server-computed sort key that strips leading articles such as "the",
 * "a", "an" already lives server-side — this hook does no reordering of its
 * own). Feeds the series autocomplete in the book edit form.
 *
 * Same `libraryId`-gated shape `useLibrarySubjects` follows: skips the query
 * while `libraryId` is `undefined` (an admin with no library selected has
 * nothing to root `node(id:)` on), and folds `useCurrentLibraryId`'s own
 * `loading` into this hook's `loading` — a SKIPPED `useQuery` reports
 * `loading: false`, and without folding that in, a caller reading `loading`
 * during the cold `ViewerBootstrap` round trip (`libraryId` still
 * resolving) would see `[], loading: false`: a false "no series yet" read.
 *
 * Preserves the previous REST hook's tuple shape: `error` reports Apollo's
 * own `error?.message`, matching the settled error-surfacing policy.
 */
export const useSeriesNames = (): [string[], boolean, string | undefined] => {
  const { libraryId, loading: libraryIdLoading } = useCurrentLibraryId();

  const { data, loading, error } = useQuery(SeriesNamesDocument, {
    variables: { libraryId: libraryId ?? '' },
    skip: libraryId === undefined,
  });

  const library = data?.node?.__typename === 'Library' ? data.node : undefined;
  const names = library?.series.map((series) => series.name) ?? [];

  return [names, loading || libraryIdLoading, error?.message];
};
