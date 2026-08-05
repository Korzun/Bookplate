import { useQuery } from '@apollo/client/react';
import { useMemo } from 'react';

import { SyncPasswordDocument } from '~/graphql/user';

export type UseSyncPassword = [string | null, boolean, boolean];

/**
 * `Viewer.syncPassword` resolves to a clean `null` for the config-based
 * admin — no `authScopes`, no accompanying `FORBIDDEN` error (see
 * `SyncPasswordDocument`'s doc comment) — so there is nothing here for a
 * `skip` gate to guard against; `page/user/index.tsx` also only ever mounts
 * `SyncPassword` for a non-admin viewer in the first place. `error` covers
 * real transport/GraphQL failures only.
 */
export const useSyncPassword = (): UseSyncPassword => {
  const { data, loading, error } = useQuery(SyncPasswordDocument);

  return useMemo(
    () => [data?.viewer.syncPassword ?? null, loading, error !== undefined] as UseSyncPassword,
    [data, loading, error]
  );
};
