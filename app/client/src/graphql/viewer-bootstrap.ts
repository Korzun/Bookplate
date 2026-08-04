import { graphql } from '~/gql';

/**
 * The app-start read. `library { id }` is the self library's global ID, which
 * `useCurrentLibraryId()` hands to every library-scoped screen.
 *
 * Read from the server rather than minted client-side as
 * `btoa('Library:' + userId)`: the JWT claims do carry the raw user id, but
 * hard-coding Pothos's global-ID encoding into the client is exactly the
 * coupling the book-relay-id plan removed.
 *
 * `library` and `user` are both null for the config-based admin, which owns no
 * library and has no user row.
 */
export const ViewerBootstrapDocument = graphql(`
  query ViewerBootstrap {
    viewer {
      username
      isAdmin
      mustChangePassword
      user {
        id
      }
      library {
        id
      }
    }
  }
`);
