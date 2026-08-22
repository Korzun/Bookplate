import { useLazyQuery } from '@apollo/client/react';
import { useCallback } from 'react';

import { SeriesNextIndexDocument } from '~/graphql/library';
import { useCurrentLibraryId } from '~/provider/library-target';

export type FetchSeriesNextIndex = (name: string) => Promise<number>;

/**
 * Backs `Library.seriesNextIndex(name:)` — fired ON DEMAND from the book
 * edit form's series field (`handleSeriesChange`) the moment the user picks
 * a series, never on mount. `useLazyQuery`, not `useQuery`, for exactly that
 * reason: mounting the form must not issue this operation before a series
 * is even chosen.
 *
 * The returned fetcher passes `{ libraryId, name }` explicitly on every
 * call, rather than relying on the hook-level `variables` given to
 * `useLazyQuery` (there are none here) or any default. This is NOT
 * redundant: Apollo's `useLazyQuery` execute function resets to EMPTY
 * variables when called with no arguments (see its source: "If `variables`
 * is not given, reset back to empty variables"), so omitting them would
 * send `SeriesNextIndex` with `{}` instead of the real
 * `{ libraryId, name }` — see `use-book-validation.ts`'s doc comment, which
 * documents the same trap for `BookValidationDocument`.
 *
 * Preserves the previous REST hook's signature exactly: `(name: string) =>
 * Promise<number>`, rejecting on failure rather than returning a tuple —
 * `BookEditForm` awaits this fetcher directly and has its own
 * stale-response guard (`seriesRequestRef`), so this hook adds no error
 * reporting of its own beyond letting Apollo's rejection propagate.
 */
export const useFetchSeriesNextIndex = (): FetchSeriesNextIndex => {
  const { libraryId } = useCurrentLibraryId();
  const [execute] = useLazyQuery(SeriesNextIndexDocument);

  return useCallback(
    async (name: string): Promise<number> => {
      const { data } = await execute({ variables: { libraryId: libraryId ?? '', name } });
      const node = data?.node;
      if (node?.__typename !== 'Library') {
        throw new Error('Failed to fetch next series index');
      }
      return node.seriesNextIndex;
    },
    [execute, libraryId]
  );
};
