import { graphql } from '~/gql';

/**
 * The book-edit form's save. Kept in `~/graphql/` rather than colocated on
 * its single consumer for the same reason `graphql/device.ts` keeps
 * `DeviceCreate`/`DeviceUpdate` (Task 1): a MUTATION document has no fragment
 * to colocate, and every module under `~/graphql/` imports nothing but
 * `~/gql`, which keeps it out of this repo's ~70-cycle import graph.
 * `BookEditDocument` — the READ this form's fragment composes into — moved
 * to `page/book-edit/index.tsx` instead, because a route owns its own query.
 *
 * Every input field except `id` is optional, which matches what the form
 * already computes: `handleSave` sends `undefined` for every UNCHANGED field
 * (`component/book-edit-form/index.tsx`). No reshaping is needed.
 *
 * The payload re-selects the full edited book so Apollo normalizes the result
 * without a hand-written update — EXCEPT when the id changed, which a metadata
 * edit can do (it rewrites the file, so the content hash and therefore the
 * global id both move). `component/book-edit-form`'s own `update` — the
 * mutation's only call site — handles that case explicitly.
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
