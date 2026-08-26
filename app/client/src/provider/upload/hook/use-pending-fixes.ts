import { useQuery } from '@apollo/client/react';

import { useFragment } from '~/gql';
import type { PendingFixRowFragmentFragment } from '~/gql/graphql';
import { LibraryPendingFixesDocument, PendingFixRowFragment } from '~/graphql/upload';
import { useCurrentLibraryId } from '~/provider/library-target';

/**
 * The query's own row type, unmasked — NOT `FragmentType<typeof
 * PendingFixRowFragment>`: Task 8 reads `.book.id` and `.state` off these
 * directly.
 *
 * The brief's illustrative formula for this type (`Extract<…>['pendingFixes']
 * [number]` off `LibraryPendingFixesQuery['node']` directly) compiles down to
 * the still-MASKED row (`{ __typename: 'PendingFix' } & { ' $fragmentRefs'?:
 * … }` — verified against `tsc`), which does not expose `.book`/`.state` at
 * all. `PendingFixRowFragmentFragment` — the fragment's own resolved type,
 * what `useFragment(PendingFixRowFragment, …)` below actually returns — is
 * the type that matches the brief's stated intent, so that's what's aliased
 * here. `state`'s three nested `MetadataFix` arrays stay masked one level
 * further in (nothing here reads into them; `fix-review/index.tsx`'s
 * eventual unmask is Task 8's concern).
 *
 * Masking in this codebase is compile-time only (`useFragment` is an
 * identity cast, `gql/fragment-masking.ts`), so exposing this concrete row
 * type is honest rather than a workaround.
 */
export type PendingFixRow = PendingFixRowFragmentFragment;

export type UsePendingFixes = {
  rows: PendingFixRow[];
  loading: boolean;
  error: string | undefined;
  refetch: () => void;
};

/**
 * The read half of the pending-fix queue: every `PendingFix` row for the
 * current library, rooted at `node(id: $libraryId)` exactly like
 * `useLibraryEntries`/`useBookValidation` — the Library global id
 * `useCurrentLibraryId()` hands out serves admins and non-admins alike (see
 * that hook's own doc comment; `useLibraryTarget()` must never be reached
 * for directly here).
 *
 * Skips the query outright when `libraryId` is `undefined` — an admin with
 * no library selected has nothing to root `node(id:)` on.
 *
 * **`loading` also folds in `useCurrentLibraryId`'s own loading.** A SKIPPED
 * `useQuery` reports `loading: false`, so without this fold an admin whose
 * target is still resolving would render "no pending fixes" for a frame
 * instead of a loading state. Same correction `page/library`'s `LibraryPage`
 * carries (`page/library/index.tsx`'s own `LibraryEntriesDocument`/
 * `extraLoading` doc comment).
 */
export const usePendingFixes = (): UsePendingFixes => {
  const { libraryId, loading: libraryIdLoading } = useCurrentLibraryId();
  const { data, loading, error, refetch } = useQuery(LibraryPendingFixesDocument, {
    variables: { libraryId: libraryId ?? '' },
    skip: libraryId === undefined,
  });

  const library = data?.node?.__typename === 'Library' ? data.node : undefined;
  const rows = useFragment(PendingFixRowFragment, library?.pendingFixes ?? []);

  return {
    rows,
    loading: libraryIdLoading || loading,
    error: error?.message,
    refetch: () => void refetch(),
  };
};
