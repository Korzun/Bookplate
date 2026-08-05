import { useMutation, useQuery } from '@apollo/client/react';
import { useCallback, useMemo, useState } from 'react';

import type { UserRegenerateSyncPasswordMutation } from '~/gql/graphql';
import { UserRegenerateSyncPasswordDocument } from '~/graphql/user';
import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import { unwrapResult } from '~/provider/apollo';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated.
type UserRegenerateSyncPasswordPayload = Extract<
  NonNullable<UserRegenerateSyncPasswordMutation['userRegenerateSyncPassword']>,
  { __typename: 'UserRegenerateSyncPasswordPayload' }
>;

export type RegenerateSyncPassword = () => Promise<boolean>;
export type UseRegenerateSyncPassword = [RegenerateSyncPassword, boolean, string | null, boolean];

/**
 * The mutation takes the viewer's own `User` global ID (`userId: ID!`), read
 * from `viewer.user { id }` — `ViewerBootstrapDocument` already selects it
 * (this hook does not add a second source), so this `useQuery` call is
 * ordinarily a cache hit, not a second network round trip. `viewer.user` is
 * null only for the config-based admin, which has no user row; `SyncPassword`
 * is only ever mounted for a non-admin viewer (`page/user/index.tsx`), so
 * `userId` being unset here is defensive, not a path this hook's own callers
 * exercise.
 *
 * `userRegenerateSyncPassword` returns `{ syncPassword, user }`, but the field
 * the UI reads is `Viewer.syncPassword` — a different place entirely. A
 * returned payload does not update it on its own, so `update` writes the new
 * value directly onto the `Viewer` singleton via `cache.modify` +
 * `cache.identify({ __typename: 'Viewer' })` (`Viewer`'s `keyFields: []` is
 * what makes that resolve to an addressable id — the same shape
 * `useRegisterUser` uses for `Viewer.users`).
 */
export const useRegenerateSyncPassword = (): UseRegenerateSyncPassword => {
  const { data: viewerData } = useQuery(ViewerBootstrapDocument);
  const userId = viewerData?.viewer.user?.id;

  const [runRegenerate] = useMutation(UserRegenerateSyncPasswordDocument);
  const [loading, setLoading] = useState(false);
  const [syncPassword, setSyncPassword] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const regenerate = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setError(false);
    setSyncPassword(null);

    if (!userId) {
      setError(true);
      setLoading(false);
      return false;
    }

    try {
      const { data } = await runRegenerate({
        variables: { input: { userId } },
        update: (cache, { data: mutationData }) => {
          const result = unwrapResult<UserRegenerateSyncPasswordPayload>(
            mutationData?.userRegenerateSyncPassword,
            'UserRegenerateSyncPasswordPayload'
          );
          if (result.status !== 'ok') return;

          cache.modify({
            id: cache.identify({ __typename: 'Viewer' }),
            fields: { syncPassword: () => result.payload.syncPassword },
          });
        },
      });

      const result = unwrapResult<UserRegenerateSyncPasswordPayload>(
        data?.userRegenerateSyncPassword,
        'UserRegenerateSyncPasswordPayload'
      );
      if (result.status !== 'ok') {
        setError(true);
        return false;
      }

      setSyncPassword(result.payload.syncPassword);
      return true;
    } catch {
      setError(true);
      return false;
    } finally {
      setLoading(false);
    }
  }, [runRegenerate, userId]);

  return useMemo(
    () => [regenerate, loading, syncPassword, error] as UseRegenerateSyncPassword,
    [regenerate, loading, syncPassword, error]
  );
};
