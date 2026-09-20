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
 * library and whose token carries no `sub`.
 *
 * `email`/`emailVerifiedAt` (task 16) feed `component/email-setting`, mounted
 * on `page/user`. This document is the natural place for them: unlike
 * `page/user`'s own `UserPageDocument` (skipped entirely for an admin
 * viewer, to spare the ×100 `Viewer.devices` cost multiplier), this one is
 * unconditionally active for every viewer, admin included — and the admin
 * manages its own address too (`Viewer.email`'s own doc comment,
 * `graphql/schema/viewer/model.ts`).
 */
export const ViewerBootstrapDocument = graphql(`
  query ViewerBootstrap {
    viewer {
      username
      isAdmin
      mustChangePassword
      email
      emailVerifiedAt
      user {
        id
      }
      library {
        id
      }
    }
  }
`);
