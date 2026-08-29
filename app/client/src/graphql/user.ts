import { graphql } from '~/gql';

/**
 * A document read by more than one ROUTE (`page/user-list`, `page/library`,
 * `page/upload`) and by a kept PROVIDER (`provider/library-target`'s
 * `useWithTargetUser`) lives in a leaf module under `src/graphql/`, not in
 * whichever route happens to compose it — that is the general rule this
 * project settled on after `UserListDocument` briefly lived at
 * `page/user-list` (task 2) and created a real import cycle:
 * `component/index.ts -> device-form -> page/user-list -> component`, plus
 * made `provider/library-target` (explicitly kept, not dissolved) depend on
 * a page module and the whole component barrel it re-exports, a strict
 * regression from the pre-task-2 shape (`~/graphql/user`, a leaf). Six
 * readers as of this writing: `page/user-list` (composes `...UserRowFragment`
 * into it), `page/library`, `page/upload`, `component/library-switcher`,
 * `component/device-form`, and `provider/library-target`'s
 * `useWithTargetUser`.
 *
 * `...UserRowFragment` below is resolved by NAME against
 * `component/user-row`'s own `graphql(...)` definition — codegen matches
 * fragment spreads across files by name (its `documents` glob), not via a JS
 * import — so colocation survives this document living outside the
 * fragment-owning component's own directory; only the FIELD SELECTION lives
 * here, not the fragment declaration.
 *
 * `library { id }` rides alongside the spread rather than inside the
 * fragment itself: `UserRow` never renders it, but `library-switcher` and
 * `useWithTargetUser` need each user's Library global id alongside their
 * username, and neither of those is a "row" component that would otherwise
 * own that field. `Viewer.users` carries a ×50 cost multiplier (see
 * `UserRowFragment`'s own doc comment, `component/user-row`, for the full
 * warning) — `library` is a singular field (multiplier 1), so only ITS OWN
 * children's cost rides the ×50, and `id` alone is the cheapest possible
 * one. Do not add anything past `library { id }` here either.
 *
 * `Viewer.users` is admin-only and nullable. The server's test-pinned
 * contract (`app/server/graphql/schema/viewer/users.test.ts`) never returns
 * that `null` on its own: a non-admin denial returns `users: null` TOGETHER
 * WITH a `FORBIDDEN` GraphQL error, and Apollo's default `errorPolicy:
 * 'none'` discards `data` entirely whenever an error is present — so a real
 * denial surfaces as `{ data: undefined, error }`, never a null field on
 * live data. There is deliberately no "null folds to empty" branch anywhere
 * this document is read. `skip: !isAdmin` is what stops the request before
 * the server ever gets to deny it — every non-admin visits `page/library`/
 * `page/upload` (the app's default landing pages) and `component/
 * device-form`, all of which read this same document unconditionally.
 */
export const UserListDocument = graphql(`
  query UserList {
    viewer {
      users {
        ...UserRowFragment
        library {
          id
        }
      }
    }
  }
`);

/**
 * `user { … }` mirrors `UserListDocument`'s selection field-for-field
 * (`id`/`username`/`progressCount`/`library { id }`, spread via
 * `UserRowFragment` plus the sibling `library { id }` field there) so the
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
          library {
            id
          }
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

/**
 * A dedicated document, NOT folded into `ViewerBootstrapDocument`: `viewer.
 * syncPassword`'s resolver (`viewer/model.ts`) carries a write side effect
 * inherited from `getSyncPassword` (`app/server/services/password.ts`) — an account with no
 * `sync_password` row yet gets one generated and persisted on first read.
 * Bootstrap fires once per app load for every screen; this document is fetched
 * only when the device-password card actually mounts, keeping that
 * lazy-generation side effect confined to visiting the one screen that reads
 * it — exactly matching REST's `GET /api/my/sync-password`.
 *
 * `syncPassword` is nullable and resolves to a clean `null` (no accompanying
 * error) for the config-based admin, which has no user row — the resolver
 * carries no `authScopes`, unlike `Viewer.users`/`Device.enabledUsers`. Render
 * that null as "not applicable to this account", not as a failure.
 */
export const SyncPasswordDocument = graphql(`
  query SyncPassword {
    viewer {
      syncPassword
    }
  }
`);

/**
 * `userRegenerateSyncPassword` returns `{ syncPassword, user }`, but the field
 * the UI reads is `Viewer.syncPassword` — a different place entirely. The
 * returned payload does not update it; `use-regenerate-sync-password.ts`
 * closes that gap with an explicit `cache.modify` on the `Viewer` singleton
 * (`cache.identify({ __typename: 'Viewer' })`, the same shape `useRegisterUser`
 * uses to append into `Viewer.users`).
 *
 * `user { id }` is selected even though the hook never reads it: an object-
 * typed payload field cannot carry an empty selection set, and selecting the
 * id keeps the returned `User` well-formed for normalization (same reasoning
 * as `UserResetPasswordDocument`'s doc comment above).
 *
 * Single-member union — same reasoning as `UserResetPasswordResult`'s
 * identical note: the mutation's own `authScopes` pins `input.userId` to the
 * caller's own id, so there is no reachable error case to select.
 */
export const UserRegenerateSyncPasswordDocument = graphql(`
  mutation UserRegenerateSyncPassword($input: UserRegenerateSyncPasswordInput!) {
    userRegenerateSyncPassword(input: $input) {
      __typename
      ... on UserRegenerateSyncPasswordPayload {
        syncPassword
        user {
          id
        }
      }
    }
  }
`);

/**
 * **No `userId` variable — deliberately.** `UserChangePasswordInput` takes only
 * `currentPassword`/`newPassword`; the server derives the caller from the
 * viewer (`user/mutation/change-password.ts`'s own doc comment explains why a
 * `userId` field made this mutation unreachable by exactly the users it
 * exists for). Do not add one back.
 *
 * `user { id }` is selected for the same "well-formed reference" reason as
 * `UserResetPasswordDocument` above — the hook never reads it, a successful
 * call logs the caller out immediately (see `page/password-reset/index.tsx`
 * and `component/user-change-password`, which inlined the deleted
 * `use-change-my-password.ts` hook), so there is nothing left to normalize
 * into. An object-typed payload field
 * cannot carry an empty selection set regardless.
 *
 * Only `message` is selected for `InvalidInputError`, not `issues` — the same
 * choice `UserRegisterDocument` above makes for its own `InvalidInputError`
 * branch. Neither call site (`user-change-password`, `password-reset`)
 * attaches a field-level error to an individual input today; both render one
 * flat message. `IncorrectPasswordError` carries only `message` server-side
 * (see its model's doc comment), so this is its complete selection, not a
 * trimmed one.
 */
export const UserChangePasswordDocument = graphql(`
  mutation UserChangePassword($input: UserChangePasswordInput!) {
    userChangePassword(input: $input) {
      __typename
      ... on UserChangePasswordPayload {
        user {
          id
        }
      }
      ... on InvalidInputError {
        message
      }
      ... on IncorrectPasswordError {
        message
      }
    }
  }
`);
