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

/** The count subtitle on the reader's collapsed card — cheap, no rows. */
export const MyBookRequestCountDocument = graphql(`
  query MyBookRequestCount {
    viewer {
      user {
        id
        pendingBookRequestCount
      }
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
