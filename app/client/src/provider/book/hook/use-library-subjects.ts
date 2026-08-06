import { useQuery } from '@apollo/client/react';

import { LibrarySubjectsDocument } from '~/graphql/library';
import { useCurrentLibraryId } from '~/provider/library-target';

/**
 * Feeds the filter-chip subject picker (`component/search-bar`) from
 * `Library.subjects` — a flat, unpaginated `[String!]!` (no connection, no
 * fragment).
 *
 * Skips the query while `libraryId` is `undefined` — an admin with no
 * library selected has nothing to root `node(id:)` on. `loading` folds in
 * `useCurrentLibraryId`'s own `loading` for the same reason
 * `useLibraryEntries` does: a SKIPPED `useQuery` reports `loading: false`,
 * and on a cold load `libraryId` stays `undefined` for the whole
 * `ViewerBootstrap` round trip. Without folding that in, a caller keying an
 * empty-subjects state off this hook's `loading` alone would see `[],
 * loading: false` for that entire window — a false "no subjects" read, not
 * a corner case.
 *
 * Preserves the previous REST hook's tuple shape and its "silently empty on
 * error" contract: `error` reports Apollo's own `error?.message`, but the
 * caller (`SearchBar`) never surfaced one — subjects are optional filter
 * candidates, not a first-class loaded screen, so a failure here degrades to
 * "no subject chips offered" rather than an error state.
 */
export const useLibrarySubjects = (): [string[], boolean, string | undefined] => {
  const { libraryId, loading: libraryIdLoading } = useCurrentLibraryId();

  const { data, loading, error } = useQuery(LibrarySubjectsDocument, {
    variables: { libraryId: libraryId ?? '' },
    skip: libraryId === undefined,
  });

  const library = data?.node?.__typename === 'Library' ? data.node : undefined;
  const subjects = library?.subjects ?? [];

  return [subjects, loading || libraryIdLoading, error?.message];
};
