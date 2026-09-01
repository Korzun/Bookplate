import { graphql } from '~/gql';

/**
 * Fired by the upload queue when an item bound to a request lands, and by the
 * admin's "link an existing book" picker. Both take GLOBAL ids — the raw
 * content-hash book id must never appear under `provider/upload/`.
 */
export const BookRequestFulfillDocument = graphql(`
  mutation BookRequestFulfill($id: ID!, $bookId: ID!) {
    bookRequestFulfill(id: $id, bookId: $bookId) {
      __typename
      ... on BookRequestFulfillPayload {
        bookRequest {
          id
          status
          resolvedAt
          book {
            id
            title
          }
        }
      }
      ... on BookRequestNotPendingError {
        message
        status
      }
      ... on InvalidInputError {
        message
      }
    }
  }
`);

/**
 * Fired by the admin's Decline button (`component/book-request-row`, Task
 * 14). `reason` is optional on both ends — the client omits the variable
 * entirely for an empty prompt, and the server defaults it to `''` when
 * omitted (`graphql/schema/book-request/mutation/decline.ts`). No
 * `InvalidInputError` member: unlike `bookRequestFulfill`, this mutation
 * takes no second identifier a client could get wrong, so a malformed `id`
 * resolves `null` (the `missing` case `unwrapResult` already handles) rather
 * than a typed error.
 */
export const BookRequestDeclineDocument = graphql(`
  mutation BookRequestDecline($id: ID!, $reason: String) {
    bookRequestDecline(id: $id, reason: $reason) {
      __typename
      ... on BookRequestDeclinePayload {
        bookRequest {
          id
          ...BookRequestRowFragment
        }
      }
      ... on BookRequestNotPendingError {
        message
        status
      }
    }
  }
`);

/**
 * One request row, in both readings — the reader's own card and the admin's
 * per-user list. `book` is null in two cases the row renders differently: the
 * request is not fulfilled yet, and the book it was fulfilled with has since
 * been deleted (`onDelete: SetNull` on the server).
 */
export const BookRequestRowFragment = graphql(`
  fragment BookRequestRowFragment on BookRequest {
    id
    title
    author
    note
    status
    declineReason
    createdAt
    resolvedAt
    book {
      id
      title
    }
  }
`);

/**
 * The reader's own list. `first: 20` is a LITERAL, not a variable: the cost
 * model prices a variable page size at the field's `maxSize` (100), not the
 * value passed.
 */
export const MyBookRequestListDocument = graphql(`
  query MyBookRequestList($after: String) {
    viewer {
      user {
        id
        bookRequests(first: 20, after: $after) {
          edges {
            cursor
            node {
              id
              ...BookRequestRowFragment
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`);

export const BookRequestCreateDocument = graphql(`
  mutation BookRequestCreate($input: BookRequestCreateInput!) {
    bookRequestCreate(input: $input) {
      __typename
      ... on BookRequestCreatePayload {
        bookRequest {
          id
          ...BookRequestRowFragment
        }
      }
      ... on InvalidInputError {
        message
        issues {
          path
          message
        }
      }
      ... on BookRequestLimitExceededError {
        message
        limit
      }
      ... on DuplicateBookRequestError {
        message
        existingRequestId
      }
    }
  }
`);

export const BookRequestDeleteDocument = graphql(`
  mutation BookRequestDelete($id: ID!) {
    bookRequestDelete(id: $id) {
      deletedId
    }
  }
`);

/**
 * The admin's view of ONE user's requests. Rooted at `Query.user(id:)`, which
 * is admin-only — correct here, since this list renders only for admins.
 *
 * `first: 20` is a LITERAL for the same pricing reason as the reader's list.
 *
 * `library { id }` and `username` (Task 14) are what `UserRequestList` builds
 * each row's `target` prop from — the requesting reader's Library global id
 * and username, both of which `addFiles` must capture at add time so an
 * upload from a request row reaches THAT reader's library and username
 * regardless of the admin's global library switcher. Reading them off this
 * SAME query, rather than threading a prop down from `UserRowContent`,
 * keeps this component self-contained — `UserRowContent`/`UserRow` need no
 * new prop.
 */
export const UserRequestListDocument = graphql(`
  query UserRequestList($userId: ID!, $after: String) {
    user(id: $userId) {
      id
      username
      library {
        id
      }
      bookRequests(first: 20, after: $after) {
        edges {
          cursor
          node {
            id
            ...BookRequestRowFragment
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`);
