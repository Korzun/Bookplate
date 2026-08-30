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
 * NOTE on pagination: `Library.entries` is FORWARD-ONLY server-side — the
 * schema does not offer `last`/`before` on that field at all (it wraps a
 * forward-only service cursor over an interleaved two-table keyset; the two
 * arguments were removed from the SDL rather than left advertised and refused
 * at runtime). Do not add backward paging to `entries` — those arguments do
 * not exist, so a query using them fails schema validation.
 *
 * `Library.progress`, `Series.books` and `Validation.messages` DO support
 * backward paging. `progress` is the recent one: it was in the sentence above
 * until it became a `t.prismaConnection` server-side, which injects all four
 * Relay args and honours them. `relayStylePagination` handles both directions,
 * so this config does not enforce the asymmetry; the client simply never pages
 * backward on any of them.
 *
 * `Library.progress` CURSORS CHANGED FORMAT in that same server change (they
 * were base64 `{timestamp, document}`; they are now the Prisma plugin's
 * compound-primary-key cursor). Nothing here or in any component stores a
 * cursor beyond the lifetime of one cache entry — `fetchMore` reads
 * `pageInfo.endCursor` straight back out of the previous page — so this needed
 * no change; it is recorded because a future "persist the cursor across
 * sessions" idea would be broken by exactly that kind of server change.
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
    // `User.bookRequests` is a `t.prismaConnection`, same shape as
    // `Library.progress` above (no filter args, so no `keyArgs` needed) —
    // required for `usePaginatedConnection`'s `fetchMore` (`component/
    // book-requests-content`) to APPEND a second page's edges onto the
    // first rather than replace them: without a merge function here,
    // `InMemoryCache` treats each distinct `after` as its own cache entry.
    User: { fields: { bookRequests: relayStylePagination() } },
  },
};
