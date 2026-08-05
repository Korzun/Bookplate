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
