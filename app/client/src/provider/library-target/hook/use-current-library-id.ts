import { useQuery } from '@apollo/client/react';

import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';

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
 * SELF PATH ONLY for now: an admin has no `viewer.library`, so this returns
 * undefined for them until the library-target reshape supplies a stored
 * selection.
 */
export const useCurrentLibraryId = (): UseCurrentLibraryId => {
  const { data, loading } = useQuery(ViewerBootstrapDocument);
  return { libraryId: data?.viewer.library?.id, loading };
};
