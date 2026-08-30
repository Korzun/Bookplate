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
