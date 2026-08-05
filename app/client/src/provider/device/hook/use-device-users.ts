import { useQuery } from '@apollo/client/react';
import { useMemo } from 'react';

import { DeviceUsersDocument } from '~/graphql/device';
import { useIsAdmin } from '~/provider/auth';
import { useUserList } from '~/provider/user';

export type UseDeviceUsers =
  | [string[], true, false, undefined]
  | [string[], false, false, undefined]
  | [string[], false, true, undefined]
  | [string[], false, true, string];

// A stable identity across renders, not a fresh `[]` literal — device-form
// derives its pending selection from this hook's return value on every
// render (`selectedUsers = editedUsers ?? fetchedUsers`) rather than syncing
// it into state via an effect, specifically to dodge a set-state-in-effect
// render loop a fresh array identity here would otherwise cause.
const EMPTY_USERS: string[] = [];

/**
 * The enabled usernames for one device, read over GraphQL.
 *
 * `Device.enabledUsers` is admin-only (`authScopes: { admin: true }`,
 * `app/server/graphql/schema/device/model.ts`) and nullable for the same
 * reason `Viewer.users` is (`use-user-list.ts`'s own note): the server's
 * test-pinned contract (`device/enabled-users.test.ts`, "refuses a
 * non-admin") pairs a denial's `enabledUsers: null` on the affected device
 * with a FORBIDDEN error in the SAME response, and Apollo's default
 * `errorPolicy: 'none'` (unconfigured anywhere in this client) discards
 * `data` entirely whenever any error is present. So a real denial never
 * reaches this hook as "live data with a null field" — it reaches it as
 * `{ data: undefined, error }`, the `error !== undefined` branch below, not
 * a "null folds to empty" branch. There is deliberately no such branch.
 *
 * That leaves querying at all as the thing to guard, exactly like
 * `useUserList`: `skip: !isAdmin` stops the request before the server ever
 * gets to deny it, made explicit and real here rather than left dependent on
 * a caller passing `undefined` for a non-admin (the previous, REST-era call
 * site's own accident of how it happened to be invoked).
 *
 * There is no `Query.device`, so this reads `viewer { devices { id
 * enabledUsers { id } } }` (`DeviceUsersDocument`) and picks the matching
 * device by id. Only `id` is selected inside `enabledUsers` — `Viewer.devices`
 * carries a ×100 cost multiplier and `Device.enabledUsers` a further ×50 ON
 * TOP, so a field selected under both is priced ×5000 (see
 * `graphql/device.ts`'s note). Usernames are resolved against the
 * already-cached `useUserList()` (Task 4's `UserListDocument`) instead of
 * being selected here — that read is already active wherever this hook's
 * only consumer (`component/device-form`) is mounted, so this costs no
 * extra network round trip.
 */
export const useDeviceUsers = (deviceId?: string): UseDeviceUsers => {
  const [isAdmin] = useIsAdmin();
  const [allUsers, allUsersLoading] = useUserList();
  const skip = !isAdmin || !deviceId;
  const { data, loading, error } = useQuery(DeviceUsersDocument, { skip });

  return useMemo(() => {
    if (skip) return [EMPTY_USERS, false, false, undefined] as UseDeviceUsers;
    if (error !== undefined) {
      return [EMPTY_USERS, false, true, error.message] as UseDeviceUsers;
    }
    // Usernames come out of `allUsers` below, so this hook's loading slot
    // must reflect BOTH queries — DeviceUsers alone isn't enough. If
    // DeviceUsers resolves first while UserList is still in flight, folding
    // only `loading` here would report a stable, authoritative-looking
    // `[[], false, false, undefined]` for a device that in fact has enabled
    // users — the id→username lookup just hasn't landed yet. Same race
    // `use-enable-device-user.ts`/`use-disable-device-user.ts` guard against
    // on the write side.
    if (loading || allUsersLoading) {
      return [EMPTY_USERS, true, false, undefined] as UseDeviceUsers;
    }

    const device = data?.viewer.devices.find((candidate) => candidate.id === deviceId);
    const enabledIds = new Set((device?.enabledUsers ?? []).map((enabledUser) => enabledUser.id));
    const usernames = allUsers
      .filter((candidate) => enabledIds.has(candidate.id))
      .map((candidate) => candidate.username);

    return [usernames, false, false, undefined] as UseDeviceUsers;
  }, [skip, error, loading, allUsersLoading, data, deviceId, allUsers]);
};
