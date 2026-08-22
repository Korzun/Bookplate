import { graphql } from '~/gql';

/**
 * The edit form's read. Deliberately SEPARATE from `BookDetailDocument`
 * (`graphql/book.ts`) rather than an extension of it: the form needs
 * `titleSort`, `authorSort` and `identifiers`, which the detail page never
 * renders, and `BookDetail` already measures breadth 50 (50.0%) against a 70%
 * gate. Two documents keep each screen's selection honest.
 *
 * `documentId` is the display-only RAW content hash. The edit page needs it for
 * the pending-fix guard, which reads the upload queue's raw-keyed in-memory
 * items and stays on REST until step 9 — see `page/book-edit`'s own comment.
 *
 * Measured (`npm run test:cost -w app/server`): breadth 33 (33.0%), complexity
 * 33 (0.1%) of budget — comfortably under the 70% gate on both axes, no
 * trimming needed.
 */
export const BookEditDocument = graphql(`
  query BookEdit($libraryId: ID!, $bookId: ID!) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        book(id: $bookId) {
          id
          documentId
          title
          titleSort
          author
          authorSort
          description
          publisher
          publishDate
          seriesIndex
          subjects
          hasCover
          coverUrl
          series {
            id
            name
          }
          identifiers {
            scheme
            value
          }
          validation {
            id
            valid
          }
        }
      }
    }
  }
`);

/**
 * Every input field except `id` is optional, which matches what the form
 * already computes: `handleSave` sends `undefined` for every UNCHANGED field
 * (`component/book-edit-form/index.tsx`). No reshaping is needed.
 *
 * The payload re-selects the full edited book so Apollo normalizes the result
 * without a hand-written update — EXCEPT when the id changed, which a metadata
 * edit can do (it rewrites the file, so the content hash and therefore the
 * global id both move). `useUpdateBookMetadata` handles that case explicitly.
 *
 * Five error members, the richest union this migration has consumed. Verified
 * against `schema.generated.graphql`'s `union BookUpdateMetadataResult`
 * (line 192): `BookHashCollisionError`, `BookNotValidatedError`,
 * `BookUpdateMetadataPayload`, `EpubValidationError`, `InvalidInputError`,
 * `StagedUploadNotFoundError` — all five error members below match exactly,
 * and each `implements UserError` with its own `message: String!` field.
 *
 * Measured (`npm run test:cost -w app/server`): breadth 37 (37.0%), complexity
 * 37 (0.1%) of budget — comfortably under the 70% gate on both axes.
 */
export const BookUpdateMetadataDocument = graphql(`
  mutation BookUpdateMetadata($input: BookUpdateMetadataInput!) {
    bookUpdateMetadata(input: $input) {
      __typename
      ... on BookUpdateMetadataPayload {
        book {
          id
          documentId
          title
          titleSort
          author
          authorSort
          description
          publisher
          publishDate
          seriesIndex
          subjects
          hasCover
          coverUrl
          series {
            id
            name
          }
          identifiers {
            scheme
            value
          }
        }
      }
      ... on BookHashCollisionError {
        message
      }
      ... on BookNotValidatedError {
        message
      }
      ... on EpubValidationError {
        message
      }
      ... on InvalidInputError {
        message
      }
      ... on StagedUploadNotFoundError {
        message
      }
    }
  }
`);
