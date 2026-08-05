import { graphql } from '~/gql';

/**
 * Devices hang off the `Viewer` singleton, which is already `keyFields: []` in
 * `cacheConfig` — that is what makes `cache.modify` able to address the list
 * when a later task appends to it.
 *
 * Fields selected inline rather than through a named fragment: fragment
 * masking is ON, and an inline selection needs no `useFragment` to read.
 *
 * NOTE the cost shape before adding anything here: `Viewer.devices` carries a
 * ×100 multiplier. `Device.enabledUsers` adds ×50 ON TOP, so a field selected
 * under both is priced ×5000. This document deliberately does NOT select
 * `enabledUsers` — the device-form task fetches those separately.
 */
export const DeviceListDocument = graphql(`
  query DeviceList {
    viewer {
      devices {
        id
        name
        slug
        coverWidth
        coverHeight
        coverFit
        bwCover
        simplify
      }
    }
  }
`);

/**
 * `device { … }` mirrors `DeviceListDocument`'s selection so a created device
 * normalizes with every field the list read expects — a partial selection
 * here would leave the appended reference resolving `null`/missing fields
 * the next time `DeviceList` reads it.
 *
 * Both `DeviceSlugConflictError` and `InvalidInputError` are real, reachable
 * outcomes (a duplicate name/slug; a rejected cover size), so both are
 * selected — not just the happy path.
 */
export const DeviceCreateDocument = graphql(`
  mutation DeviceCreate($input: DeviceCreateInput!) {
    deviceCreate(input: $input) {
      __typename
      ... on DeviceCreatePayload {
        device {
          id
          name
          slug
          coverWidth
          coverHeight
          coverFit
          bwCover
          simplify
        }
      }
      ... on DeviceSlugConflictError {
        message
      }
      ... on InvalidInputError {
        message
      }
    }
  }
`);

/**
 * Returns the `Device` outright rather than an id: normalization over the
 * existing `Device:<id>` entity is what refreshes every cached read, so this
 * mutation needs no `update` function of its own (see `use-update-device.ts`).
 */
export const DeviceUpdateDocument = graphql(`
  mutation DeviceUpdate($input: DeviceUpdateInput!) {
    deviceUpdate(input: $input) {
      __typename
      ... on DeviceUpdatePayload {
        device {
          id
          name
          slug
          coverWidth
          coverHeight
          coverFit
          bwCover
          simplify
        }
      }
      ... on DeviceSlugConflictError {
        message
      }
      ... on InvalidInputError {
        message
      }
    }
  }
`);

/**
 * `deletedDeviceId` (not the deleted `Device`) is what `DeviceDeletePayload`
 * returns — the entity is gone, so `cache.evict` is keyed off this id rather
 * than a normalized reference.
 */
export const DeviceDeleteDocument = graphql(`
  mutation DeviceDelete($input: DeviceDeleteInput!) {
    deviceDelete(input: $input) {
      __typename
      ... on DeviceDeletePayload {
        deletedDeviceId
      }
      ... on InvalidInputError {
        message
      }
    }
  }
`);

/**
 * There is no `Query.device` — `useDeviceUsers` reads every device's `id`
 * plus its enabled users and picks the matching one out of the list.
 *
 * `Viewer.devices` carries a ×100 cost multiplier (see `DeviceListDocument`'s
 * own note above); `Device.enabledUsers` adds ×50 ON TOP, so any field
 * selected under BOTH is priced ×5000. `id` is selected here — and NOTHING
 * else, in particular not `username` — for exactly that reason; usernames
 * are resolved against the already-cached `UserListDocument`
 * (`graphql/user.ts`) in `useDeviceUsers` instead. Measured (`test:cost -w
 * app/server`): breadth 9.0%, complexity 31.2% of budget — comfortably under
 * the 70% headroom despite the ×5000 shape, because only `id` travels
 * through it.
 */
export const DeviceUsersDocument = graphql(`
  query DeviceUsers {
    viewer {
      devices {
        id
        enabledUsers {
          id
        }
      }
    }
  }
`);

/**
 * Grants a user access to a device. Returns `device { id enabledUsers { id
 * } }` — that normalizes over the existing `Device:<id>` entity, refreshing
 * `DeviceUsersDocument`'s cached read of the same device for free, so
 * neither this mutation nor `DeviceDisableUserDocument` below needs an
 * `update` function (verified in `use-enable-device-user.test.tsx` with none
 * supplied).
 *
 * `userId` is a `User` global ID, not a username, per the schema's rule for
 * every user-associated mutation — the enabling hook resolves the username
 * it's given against the already-cached `UserListDocument` before calling
 * this.
 *
 * Measured (`test:cost -w app/server`): breadth 12.0%, complexity 0.3% of
 * budget — a mutation's own selection carries none of `Viewer.devices`'s
 * ×100 multiplier, so the ×5000 shape does not apply here the way it does to
 * `DeviceUsersDocument`.
 */
export const DeviceEnableUserDocument = graphql(`
  mutation DeviceEnableUser($input: DeviceEnableUserInput!) {
    deviceEnableUser(input: $input) {
      __typename
      ... on DeviceEnableUserPayload {
        device {
          id
          enabledUsers {
            id
          }
        }
      }
      ... on InvalidInputError {
        message
      }
    }
  }
`);

/**
 * Revokes a user's access to a device. Mirrors `DeviceEnableUserDocument`'s
 * shape and reasoning above — same normalization, same no-`update` claim,
 * same `User` global ID rule.
 */
export const DeviceDisableUserDocument = graphql(`
  mutation DeviceDisableUser($input: DeviceDisableUserInput!) {
    deviceDisableUser(input: $input) {
      __typename
      ... on DeviceDisableUserPayload {
        device {
          id
          enabledUsers {
            id
          }
        }
      }
      ... on InvalidInputError {
        message
      }
    }
  }
`);
