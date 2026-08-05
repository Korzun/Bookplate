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
