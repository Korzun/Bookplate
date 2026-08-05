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

/**
 * `user { … }` mirrors `UserListDocument`'s selection field-for-field so the
 * appended reference normalizes with every field that list read expects — a
 * partial selection here would leave `viewer.users`'s new entry resolving
 * `null`/missing fields the next time `UserList` reads it (same reasoning as
 * `DeviceCreateDocument`'s doc comment).
 *
 * `UsernameAlreadyExistsError` and `InvalidInputError` are both real,
 * reachable outcomes (a duplicate/reserved name; a rejected charset or
 * length) — see `user/mutation/register.ts`'s four-branch doc comment — so
 * both are selected, not just the happy path.
 */
export const UserRegisterDocument = graphql(`
  mutation UserRegister($input: UserRegisterInput!) {
    userRegister(input: $input) {
      __typename
      ... on UserRegisterPayload {
        user {
          id
          username
          progressCount
        }
        password
      }
      ... on UsernameAlreadyExistsError {
        message
      }
      ... on InvalidInputError {
        message
      }
    }
  }
`);

/**
 * `UserDeletePayload` carries only `deletedId: ID!`, the Relay global ID —
 * feed it straight to `cache.evict({ id: cache.identify({ __typename:
 * 'User', id: deletedId }) }) })`. `viewer.users` is an array of references,
 * which Apollo auto-filters once the referenced entity is evicted, so no
 * `cache.modify` list filter is needed alongside it (unlike
 * `DeviceDeleteDocument`'s hook, which is optimistic and needs one — see
 * `use-delete-device.ts`'s doc comment for why that case differs).
 *
 * `UserDeleteResult` is a one-member union server-side (no string input field
 * is left for a zod check to reject), so there is no error branch to select
 * here — see `user/mutation/delete.ts`'s doc comment.
 */
export const UserDeleteDocument = graphql(`
  mutation UserDelete($input: UserDeleteInput!) {
    userDelete(input: $input) {
      __typename
      ... on UserDeletePayload {
        deletedId
      }
    }
  }
`);

/**
 * Selects only `user { id }` — the reset changes no field any cached read
 * (`UserListDocument` included) selects, so nothing but the entity's own
 * identity is needed for normalization; no `update` function is needed
 * either (same "free" shape as `DeviceUpdateDocument`'s doc comment, though
 * here even the id is not strictly necessary since no list depends on it —
 * it is kept anyway so the mutation returns a well-formed `User` reference).
 *
 * `UserResetPasswordResult` is a one-member union for the same reason
 * `UserDeleteResult` is — see that document's doc comment above.
 */
export const UserResetPasswordDocument = graphql(`
  mutation UserResetPassword($input: UserResetPasswordInput!) {
    userResetPassword(input: $input) {
      __typename
      ... on UserResetPasswordPayload {
        user {
          id
        }
        password
      }
    }
  }
`);
