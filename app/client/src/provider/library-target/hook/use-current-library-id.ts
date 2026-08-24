import { useQuery } from '@apollo/client/react';
import { useEffect } from 'react';

import { LibraryTargetResolveDocument } from '~/graphql/library';
import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';

import { useLibraryTarget } from './use-library-target';

export type UseCurrentLibraryId = {
  /** The Library global ID every library-scoped screen roots on, or undefined when there is none to read yet. */
  libraryId: string | undefined;
  loading: boolean;
};

/**
 * The single source of "which library am I reading".
 *
 * Every library-scoped screen roots on `node(id: $libraryId) { ... on Library }`
 * rather than `viewer.library` — `Query.user(id:)` is admin-only (it FORBIDs a
 * non-admin even for their own id) and `viewer.library` is null for the
 * config-based admin, so `node(id:)` is the only root that serves both roles
 * with one document. The Library global ID is `encodeGlobalID('Library', userId)`
 * and is therefore viewer-independent, unlike `Book.id`.
 *
 * An admin reads the `library-target` selection (`useLibraryTarget`), which
 * an admin with no selection yet leaves `undefined` — screens render "Select
 * a library", the designed state, not an error.
 *
 * A non-admin ALWAYS reads their own `viewer.library.id`, ignoring the stored
 * selection entirely. This is deliberate, not an oversight: `targetLibraryId`
 * lives in `localStorage`, which a non-admin fully controls — nothing stops
 * them from writing another library's global ID into it. The server is the
 * real enforcement boundary (`node(id:)` authorizes every read against the
 * viewer), but this hook adds a defense-in-depth layer by never even
 * *offering* another library's id to a non-admin's screens.
 *
 * **Stale-target self-heal (Task 11).** An admin's `targetLibraryId` is
 * restored from `localStorage` and can go stale (the target user deleted,
 * or a dev database swap) in a way that does not merely go MISSING from the
 * user list — `component/library-switcher`'s own effect already covers
 * that case — but resolves to nothing at all, or to some other node
 * entirely. Re-homed from `useFetchBookList`'s now-dead 404 branch (see
 * `graphql/library.ts`'s `LibraryTargetResolveDocument` doc comment): once
 * an admin holds a `targetLibraryId` and a `node(id: targetLibraryId)` read
 * for it has LOADED (never while still loading — see below) and resolved to
 * `null` or a non-`Library` type, the target is cleared.
 *
 * The LOADED guard is load-bearing, not decorative: `useQuery` reports
 * `loading: true` with `data: undefined` on every fresh mount, which is
 * indistinguishable from "resolved to nothing" by shape alone. Skipping the
 * clear while `targetLoading` is true is what stops a perfectly valid
 * selection from being wiped on every single mount before its own read has
 * even come back.
 */
export const useCurrentLibraryId = (): UseCurrentLibraryId => {
  const [targetLibraryId, setTargetLibraryId] = useLibraryTarget();
  const { data, loading } = useQuery(ViewerBootstrapDocument);
  const isAdmin = data?.viewer.isAdmin ?? false;

  const resolvingTarget = isAdmin && targetLibraryId !== undefined;
  const { data: targetData, loading: targetLoading } = useQuery(LibraryTargetResolveDocument, {
    variables: { libraryId: targetLibraryId ?? '' },
    skip: !resolvingTarget,
  });

  useEffect(() => {
    if (!resolvingTarget || targetLoading) return;
    const node = targetData?.node;
    if (node === null || node === undefined || node.__typename !== 'Library') {
      setTargetLibraryId(undefined);
    }
  }, [resolvingTarget, targetLoading, targetData, setTargetLibraryId]);

  return { libraryId: isAdmin ? targetLibraryId : data?.viewer.library?.id, loading };
};
