import type { InMemoryCacheConfig } from '@apollo/client';
import { relayStylePagination } from '@apollo/client/utilities';

import introspection from '~/gql/possible-types';

/**
 * The ONE cache configuration. Both `createApolloClient()` and the test helper
 * `renderWithApollo` build their cache from this object, so a test can never
 * pass against typePolicies the app does not actually use.
 *
 * Only three types need explicit config; everything else normalizes on `id`
 * with zero configuration. `Book`/`Library`/`Series`/`User` are Nodes;
 * `Device`/`PendingFix`/`Validation`/`ScanStatus` carry a scalar `id` without
 * implementing Node.
 *
 * NOTE on pagination: `Library.entries` and `Library.progress` are FORWARD-ONLY
 * server-side — they reject `last`/`before` with BACKWARD_PAGINATION_UNSUPPORTED.
 * `Series.books` and `Validation.messages` do support backward paging.
 * `relayStylePagination` handles both directions, so this config does not
 * enforce the asymmetry; the client simply never pages backward. Do not add
 * backward paging to `entries`/`progress` — it throws at runtime.
 */
export const cacheConfig: InMemoryCacheConfig = {
  possibleTypes: introspection.possibleTypes,
  typePolicies: {
    // Root singletons: no `id` field at all, so without an explicit empty key
    // they live inline under ROOT_QUERY and mutations cannot address them.
    Viewer: { keyFields: [] },
    Config: { keyFields: [] },

    // Prisma PK is (userId, document). `document` is a KOReader content hash
    // and COLLIDES across users — two users owning the same book share it, so
    // `document` alone would collapse both onto one entity in admin views.
    Progress: { keyFields: ['userId', 'document'] },

    Library: {
      fields: {
        entries: relayStylePagination(['filter']),
        progress: relayStylePagination(),
        book: { keyArgs: ['id'] },
      },
    },
    Series: { fields: { books: relayStylePagination() } },
    Validation: { fields: { messages: relayStylePagination() } },
  },
};
