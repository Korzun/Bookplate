import type { InMemoryCacheConfig } from '@apollo/client';
import { relayStylePagination } from '@apollo/client/utilities';

import introspection from '~/gql/possible-types';

/**
 * The ONE cache configuration. Both `createApolloClient()` and the test helper
 * `renderWithApollo` build their cache from this object, so a test can never
 * pass against typePolicies the app does not actually use.
 *
 * Only two types need explicit key config (the root singletons below);
 * everything else — including `Progress`, keyed by its computed global ID —
 * normalizes on `id` with zero configuration. `Book`/`Library`/`Series`/`User`
 * are Nodes; `Device`/`PendingFix`/`Validation`/`ScanStatus`/`Progress` carry
 * a scalar `id` without implementing Node.
 *
 * NOTE on pagination: `Library.entries` and `Library.progress` are FORWARD-ONLY
 * server-side — the schema no longer offers `last`/`before` on either field at
 * all (they wrap a forward-only service cursor; the two arguments were removed
 * from the SDL rather than left advertised and refused at runtime).
 * `Series.books` and `Validation.messages` do support backward paging.
 * `relayStylePagination` handles both directions, so this config does not
 * enforce the asymmetry; the client simply never pages backward. Do not add
 * backward paging to `entries`/`progress` — those arguments do not exist, so a
 * query using them fails schema validation.
 */
export const cacheConfig: InMemoryCacheConfig = {
  possibleTypes: introspection.possibleTypes,
  typePolicies: {
    // Root singletons: no `id` field at all, so without an explicit empty key
    // they live inline under ROOT_QUERY and mutations cannot address them.
    Viewer: { keyFields: [] },
    Config: { keyFields: [] },

    // Progress has no explicit typePolicy: `Progress.id` is now a computed
    // global ID (encodeGlobalID('Progress', [userId, document])), so the
    // default `id` keying already carries the owner and is safe to use.
    // `document` alone would NOT be — it's a KOReader content hash that
    // COLLIDES across users, so two users owning the same book share it and
    // would collapse onto one cache entity if `document` were the key.
    // See cache.test.ts's two-user test, which proves this doesn't happen.

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
