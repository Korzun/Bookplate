import { useMutation } from '@apollo/client/react';
import { useCallback, useMemo, useState } from 'react';

import type { BookDeleteMutation } from '~/gql/graphql';
import { BookDeleteDocument } from '~/graphql/book';
import { unwrapResult } from '~/provider/apollo';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated.
type BookDeletePayload = Extract<
  NonNullable<BookDeleteMutation['bookDelete']>,
  { __typename: 'BookDeletePayload' }
>;

export type UseDeleteBook = [(id: string) => Promise<void>, boolean, boolean, string | undefined];

/**
 * The whole REST-era `bookList`/`bookListItems`/`isLastInSeries` optimistic
 * dance is GONE: `page/library` now reads `Library.entries`, a GraphQL
 * connection normalized by Apollo, not a hand-maintained `DisplayUnit[]`
 * derived from a flat book map. There is no `Context` dependency left in
 * this hook at all.
 *
 * `update` does TWO things, not one:
 *
 *   1. `cache.evict` the deleted `Book` entity (+ `cache.gc()`). This alone
 *      is enough for a STANDALONE book's row: `Library.entries`' edges hold
 *      `Reference`s, and `InMemoryCache` silently drops an edge whose `node`
 *      reference now points at nothing when the connection is next read —
 *      no error, no manual list-filter, confirmed empirically (see this
 *      hook's own test, "removes a deleted standalone book's row").
 *
 *   2. `cache.evict` the OWNING `Library`'s entire `entries` field (every
 *      filter variant, no `args` given) + `cache.gc()`. This is required
 *      because deleting the LAST book in a series makes the SERVER also
 *      delete the `Series` row (`book-store.ts`'s `deleteBook`), but
 *      `BookDeletePayload` carries no `deletedSeriesId` — the client has no
 *      id to `cache.evict` a `Series` entity with, and evicting the just-
 *      deleted `Book` does nothing to the SERIES-typed edge that still
 *      references it from `Series.books`. Left alone, that edge — and the
 *      whole stale row, with its now-wrong `bookCount` — lingers in the
 *      cache until something else happens to overwrite it. Evicting the
 *      `entries` field wipes the connection's stored data outright, so the
 *      next `LibraryEntries` read (this hook has no way to know whether one
 *      is active right now, so this covers both an already-mounted grid and
 *      a later one) is a genuine cache miss and re-fetches over the network
 *      instead of serving stale rows. `cache.identify` needs the `Library`'s
 *      own global id for this, which is why the mutation document selects
 *      `library { id }` on top of `deletedId`.
 *
 * **Seen-to-fail**: deleting the field-evict + gc lines above (keeping only
 * the `Book` entity eviction) leaves this hook's "removes an emptied
 * series' row" test failing — the stale `Series` edge and its
 * `bookCount: 1` survive the delete untouched, and `cache.readQuery` keeps
 * returning the pre-delete connection instead of `null`. Restored; see this
 * file's git history / task report for the exact failure output.
 */
export const useDeleteBook = (): UseDeleteBook => {
  const [runDelete] = useMutation(BookDeleteDocument);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const deleteBook = useCallback(
    async (id: string) => {
      if (loading) return;

      try {
        setLoading(true);
        setError(false);
        setErrorMessage(undefined);

        const { data } = await runDelete({
          variables: { id },
          update: (cache, { data: mutationData }) => {
            const result = unwrapResult<BookDeletePayload>(
              mutationData?.bookDelete,
              'BookDeletePayload'
            );
            if (result.status !== 'ok') return;

            cache.evict({
              id: cache.identify({ __typename: 'Book', id: result.payload.deletedId }),
            });
            cache.evict({
              id: cache.identify({ __typename: 'Library', id: result.payload.library.id }),
              fieldName: 'entries',
            });
            cache.gc();
          },
        });

        const result = unwrapResult<BookDeletePayload>(data?.bookDelete, 'BookDeletePayload');
        if (result.status === 'missing') {
          setError(true);
          setErrorMessage('Failed to delete book');
          return;
        }
        if (result.status === 'error') {
          setError(true);
          setErrorMessage(result.message);
          return;
        }
      } catch (err) {
        setError(true);
        if (err instanceof Error) setErrorMessage(err.message);
      } finally {
        setLoading(false);
      }
    },
    [runDelete, loading]
  );

  return useMemo(
    () => [deleteBook, loading, error, errorMessage] as UseDeleteBook,
    [deleteBook, loading, error, errorMessage]
  );
};
