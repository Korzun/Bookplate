import { graphql } from '~/gql';

/**
 * The edit form's read. Deliberately SEPARATE from `BookDetailDocument`
 * (`graphql/book.ts`) rather than an extension of it: the form needs
 * `titleSort`, `authorSort` and `identifiers`, which the detail page never
 * renders, and `BookDetail` already measures breadth 50 (50.0%) against a 70%
 * gate. Two documents keep each screen's selection honest.
 *
 * `documentId` is the display-only RAW content hash.
 *
 * `pendingFix` (Task 11) is the book-edit page's own pending-fix guard: since
 * this document already loads the whole book, a book with an unresolved
 * upload fix is answered right here instead of through a second,
 * queue-keyed lookup (`usePendingFixesForBook`, deleted this task — see its
 * removal for why a per-book lookup was redundant once this field exists).
 * The proposal fields are selected INLINE rather than via
 * `...MetadataFixFragment` (controller ruling, 2026-08-24): every document
 * file under `graphql/` is self-contained — none spreads a fragment defined
 * in another file — and `MetadataFixFragment` lives in `graphql/upload.ts`.
 *
 * Measured (`npm run test:cost -w app/server`): breadth 46 (46.0%), complexity
 * 46 (0.1%) of budget — comfortably under the 70% gate on both axes, no
 * trimming needed. (Before `pendingFix`: breadth 31 (31.0%), complexity 31
 * (0.1%) — a +15/+15 delta for the field added here, close to but not
 * exactly the brief's own standalone estimate for this selection, breadth 14
 * / complexity 14.)
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
          pendingFix {
            id
            state {
              proposals {
                field
                kind
                from
                to
                reason
                fromChips
                toChips
                changes
              }
            }
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
 * Measured (`npm run test:cost -w app/server`): breadth 35 (35.0%), complexity
 * 35 (0.1%) of budget — comfortably under the 70% gate on both axes.
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
