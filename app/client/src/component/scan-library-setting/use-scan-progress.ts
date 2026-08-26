import { useQuery, useSubscription } from '@apollo/client/react';

import { useFragment } from '~/gql';
import {
  LibraryScanStatusDocument,
  ScanProgressDocument,
  ScanStatusFieldsFragment,
} from '~/graphql/scan';

/**
 * Live scan status for a library.
 *
 * Two reads, deliberately: the subscription streams progress, and the query is
 * the reconnect/current-state read that closes the inherent registration gap
 * between `subscribe()` resolving and the server publishing to that stream. A
 * hook that only subscribes shows nothing for an already-running scan.
 *
 * Both write through the same `ScanStatusFields` fragment, and `ScanStatus`
 * carries a scalar `id`, so the streamed event merges into the already-rendered
 * status with no typePolicy override — the query result and the event are the
 * same cache entity.
 *
 * A scan started through REST is visible here, but only at start/terminal
 * granularity: REST passes no onProgress callback, so per-file progress exists
 * only for a scan started via `libraryScan`.
 *
 * Both reads' `error` is surfaced too — a refused SSE stream or a 5xx on the
 * bootstrap query must not look identical to "no scan is running". Silence on
 * a GraphQL error is the bug class an earlier fix round in this feature ruled
 * unacceptable; this hook applies that ruling consistently rather than
 * re-deciding it.
 */
export const useScanProgress = (libraryId: string | undefined) => {
  const {
    data: readData,
    loading,
    error: readError,
  } = useQuery(LibraryScanStatusDocument, {
    variables: { libraryId: libraryId ?? '' },
    skip: !libraryId,
    fetchPolicy: 'cache-and-network',
  });

  const { data: eventData, error: subscriptionError } = useSubscription(ScanProgressDocument, {
    variables: { libraryId: libraryId ?? '' },
    skip: !libraryId,
  });

  const library = readData?.node?.__typename === 'Library' ? readData.node : undefined;

  // Codegen ships fragment masking (task 1's `fragment-masking.ts`), so both
  // reads hand back an opaque `FragmentType<ScanStatusFieldsFragment>` rather
  // than the fields directly. `useFragment` here is codegen's plain type-cast
  // helper, not a React hook, so calling it unconditionally on both sources is
  // fine even when one is undefined.
  const eventStatus = useFragment(ScanStatusFieldsFragment, eventData?.scanProgress);
  const readStatus = useFragment(ScanStatusFieldsFragment, library?.scanStatus);

  return {
    status: eventStatus ?? readStatus ?? undefined,
    // The mutation is keyed on a USER global ID while this hook is keyed on a
    // LIBRARY one — see this task's Interfaces note. Reading it off the current
    // library is what makes an admin-targeted scan work.
    userId: library?.user.id,
    loading,
    // Query error takes priority: a subscription can legitimately be in a
    // reconnect gap while the query itself is failing outright, and the query
    // is the one carrying the owner userId the whole hook depends on.
    error: readError ?? subscriptionError ?? undefined,
  };
};
