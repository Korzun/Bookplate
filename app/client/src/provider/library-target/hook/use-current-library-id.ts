import { useQuery } from '@apollo/client/react';

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
 */
export const useCurrentLibraryId = (): UseCurrentLibraryId => {
  const [targetLibraryId] = useLibraryTarget();
  const { data, loading } = useQuery(ViewerBootstrapDocument);
  const isAdmin = data?.viewer.isAdmin ?? false;
  return { libraryId: isAdmin ? targetLibraryId : data?.viewer.library?.id, loading };
};
