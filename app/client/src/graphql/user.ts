import { graphql } from '~/gql';

/**
 * `Viewer.users` carries a ×50 cost multiplier, so this selection is kept to
 * exactly the three fields the UI uses: `id` (the User global ID every user
 * mutation addresses), `username` (display + list keying), and
 * `progressCount` (the "N books synced" subtitle). Do NOT add `library { … }`
 * here — `viewer.users → library.progress` is this project's worst-measured
 * legitimate query shape at 68.5% of the complexity budget, and that is
 * exactly the shape this document would become if it grew a nested
 * selection.
 */
export const UserListDocument = graphql(`
  query UserList {
    viewer {
      users {
        id
        username
        progressCount
      }
    }
  }
`);
