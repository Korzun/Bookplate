import { graphql } from '~/gql';

/**
 * `Book.validation` is nullable — null means "never validated", which is what
 * REST's tri-state `valid?: boolean | null` expressed as `undefined`. The page's
 * `editingBlocked` therefore reads `validation?.valid !== true`, preserving
 * REST's `book.valid !== true` for all three states. VERIFY this mapping against
 * the resolver before relying on it (Task 7, Step 1).
 *
 * `counts` is Task 2's new field; `messages(first: 100)` is a literal page size
 * matching `CONNECTION_LIMITS.validationMessages.maxSize`. The modal has always
 * rendered every message it was handed, and `counts` is now authoritative for the
 * summary regardless of how many messages came back — which is the whole reason
 * the field exists.
 */
export const ValidationFragment = graphql(`
  fragment ValidationFragment on Validation {
    id
    valid
    threshold
    validatedAt
    counts {
      severity
      count
    }
    messages(first: 100) {
      edges {
        node {
          seq
          severity
          message
          code
          path
          line
          column
        }
      }
    }
  }
`);

/**
 * `oldId`/`newId` are RAW content hashes, exposed by the schema for display only
 * ("resolve `oldBook`/`newBook` to navigate" — the SDL says so on both fields).
 * The lineage modal renders them truncated and passes `oldId` to
 * `bookUnlinkDocument`'s `documentId`, which is itself a `String!` document id,
 * not an `ID!` — so this is a display/document id, not a book identifier, and it
 * does not violate "the client never holds a raw book id".
 */
export const LineageEntryFragment = graphql(`
  fragment LineageEntryFragment on LinkedDocument {
    oldId
    newId
    timestamp
    type
  }
`);

/**
 * The richest document this migration has produced: `book` plus its
 * `lineage` list, fanning out from a single `Library.book(id:)` lookup — no
 * list connection above it, so none of these fields amplify the way
 * `LibraryEntries`' ×100 `entries` does (`graphql/library.ts`). Breadth is
 * the tight axis here because breadth counts SELECTED FIELDS, not fan-out
 * — an original version of this document that also carried
 * `validation { ...ValidationFragment }` measured breadth 69 (69.0%), one
 * point off the 70% gate.
 *
 * 2026-08-13, human ruling (task-4 review): that margin was too thin for
 * later migration steps to extend safely, so `validation`'s expensive
 * payload (`threshold`, `validatedAt`, `counts`, `messages`) was split out
 * into `BookValidationDocument` below, fired lazily when the validation
 * modal opens. This document keeps only `validation { id valid }` —
 * load-bearing, not a leftover: `editingBlocked` gates the "Edit metadata"
 * action on `validation?.valid !== true` and is evaluated on page LOAD, not
 * on modal open, so it cannot wait for the lazy query.
 *
 * NOTE for future trims: a page-size cut (e.g. `messages(first: 20)`) only
 * moves COMPLEXITY, which was already a harmless 4.2% here — breadth is 1
 * per selection in the expanded tree, UNWEIGHTED by any connection
 * multiplier (`cost-limit.ts:598-666`). If breadth ever gets tight again on
 * a document like this one, cut FIELDS (or split them out, as here), not
 * page sizes.
 *
 * Measured (`test:cost -w app/server`): breadth 49 (49.0%), complexity 163
 * (0.5%) of budget — comfortably under the 70% gate on both axes after the
 * split (was 69/69.0% breadth, 1371/4.2% complexity with `validation`
 * inline).
 */
export const BookDetailDocument = graphql(`
  query BookDetail($libraryId: ID!, $bookId: ID!) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        book(id: $bookId) {
          id
          title
          author
          description
          publisher
          publishDate
          addedAt
          mtime
          size
          pageCount
          chapterCount
          chapterNames
          chapterSpineMap
          subjects
          seriesIndex
          hasCover
          coverUrl
          deviceEditionCount
          series {
            id
            name
          }
          progress {
            id
            percentage
            currentChapter
          }
          validation {
            id
            valid
          }
          lineage {
            ...LineageEntryFragment
          }
          pendingFix {
            id
          }
        }
      }
    }
  }
`);

/**
 * The lazy half of the 2026-08-13 split (see `BookDetailDocument`'s doc
 * comment): fired only when the validation modal opens, not on page load.
 * `BookDetail` deliberately keeps its own cheap `validation { id valid }`
 * for `editingBlocked`, evaluated eagerly on load — this document carries
 * everything else `ValidationFragment` selects (`threshold`, `validatedAt`,
 * `counts`, `messages`).
 *
 * `Validation.id` is byte-identical to the owning Book's global id
 * (server-side `encodeGlobalID('Book', [userId, bookId])`), so this
 * document's result normalizes onto the SAME `Book` cache entity
 * `BookDetail` already created — Apollo merges the eager `{ id valid }` and
 * this lazy payload onto one object rather than the two competing. That is
 * also why `bookValidate`'s mutation payload will land here for free later:
 * same key, same shape, no manual cache write needed.
 *
 * Measured (`test:cost -w app/server`): breadth 33 (33.0%), complexity 1221
 * (3.7%) of budget — comfortably under the 70% gate on both axes.
 */
export const BookValidationDocument = graphql(`
  query BookValidation($libraryId: ID!, $bookId: ID!) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        book(id: $bookId) {
          id
          validation {
            ...ValidationFragment
          }
        }
      }
    }
  }
`);

/**
 * `BookDeleteResult` is a single-member union today (schema-verified,
 * `app/server/graphql/schema/book/mutation/delete.ts`) — no error branch is
 * added here, matching the "no speculative error members" rule (spec 1's
 * traced-union-drop precedent). `deletedId` is the ONLY field
 * `useDeleteBook`'s cache update needs to `cache.identify` and evict the
 * `Book` entity; `library { id }` is what lets it ALSO evict the owning
 * `Library`'s `entries` connection field (see that hook's doc comment for
 * why eviction of the `Book` entity alone is not enough).
 */
export const BookDeleteDocument = graphql(`
  mutation BookDelete($id: ID!) {
    bookDelete(input: { id: $id }) {
      __typename
      ... on BookDeletePayload {
        deletedId
        library {
          id
        }
      }
    }
  }
`);

/**
 * `BookValidateResult` is a single-member union today (schema-verified,
 * `app/server/graphql/schema/book/mutation/validate.ts`) — no error branch.
 * `validation` is spread through `ValidationFragment` rather than selected
 * inline: `Validation.id` is byte-identical to the owning Book's global id
 * server-side (`encodeGlobalID('Book', [userId, bookId])` — see
 * `BookValidationDocument`'s doc comment above), so this payload normalizes
 * onto the SAME `Book`/`Validation` cache entities `BookDetailDocument` and
 * `BookValidationDocument` already read. No hand-written `update` function:
 * Apollo's own normalization does the work, asserted in
 * `use-validate-book.test.tsx` rather than reconstructed here.
 */
export const BookValidateDocument = graphql(`
  mutation BookValidate($id: ID!) {
    bookValidate(input: { id: $id }) {
      __typename
      ... on BookValidatePayload {
        book {
          id
        }
        validation {
          ...ValidationFragment
        }
      }
    }
  }
`);

/**
 * `BookRegenChaptersResult` genuinely has two error members today
 * (schema-verified, `app/server/graphql/schema/book/mutation/
 * regen-chapters.ts`): `BookHashCollisionError` and `BookNotValidatedError`,
 * both mapped to `useRegenChapters`'s `errorMessage`. `book { id
 * chapterCount chapterNames chapterSpineMap }` re-selects every field the
 * REST `regen-chapters` response updated — normalization alone would
 * refresh those on the EXISTING `Book` entity, but `reimportBook` can also
 * change the book's global id (its raw content hash is recomputed from the
 * re-parsed file), in which case the payload's `book.id` differs from the
 * requested `$id` and normalization writes a NEW entity instead of updating
 * the old one — the hand-written `update` function evicts the stale
 * `Book:<old-id>` entity in that case. See that hook's doc comment for the
 * seen-to-fail evidence.
 */
export const BookRegenChaptersDocument = graphql(`
  mutation BookRegenChapters($id: ID!) {
    bookRegenChapters(input: { id: $id }) {
      __typename
      ... on BookRegenChaptersPayload {
        book {
          id
          chapterCount
          chapterNames
          chapterSpineMap
        }
      }
      ... on BookHashCollisionError {
        message
      }
      ... on BookNotValidatedError {
        message
      }
    }
  }
`);

/**
 * `BookClearEditionsResult` is a single-member union today (schema-verified,
 * `app/server/graphql/schema/book/mutation/clear-editions.ts`) — no error
 * branch. `book { id deviceEditionCount }` re-selects the one field REST's
 * `clear editions` response updated, so Apollo's own normalization writes
 * the new `deviceEditionCount` onto the existing `Book` entity with no
 * hand-written `update` function — asserted in
 * `use-clear-book-editions.test.tsx`.
 */
export const BookClearEditionsDocument = graphql(`
  mutation BookClearEditions($id: ID!) {
    bookClearEditions(input: { id: $id }) {
      __typename
      ... on BookClearEditionsPayload {
        clearedCount
        book {
          id
          deviceEditionCount
        }
      }
    }
  }
`);

/**
 * `BookUnlinkDocumentResult` genuinely has three error members
 * (schema-verified against `app/server/graphql/schema/book/mutation/
 * unlink-document.ts`): `LineageEntryNotFoundError` (no lineage row matches
 * `documentId`), `EditLineageEntryError` (the row exists but is an organic
 * edit-history entry, which this mutation refuses to remove — only manual
 * `merge` links can be unlinked), and `InvalidInputError` (an empty
 * `documentId`, the one input REST's path-segment routing could never
 * receive, per that file's own doc comment — unreachable in practice but
 * declared, so kept here rather than speculatively dropped).
 *
 * `book { id lineage { ...LineageEntryFragment } }` re-selects the FULL
 * lineage list, so Apollo's own normalization overwrites the whole array on
 * the existing `Book:<id>` entity — the removed entry is simply absent from
 * the new array on the next read. No hand-written `update` function, and no
 * client-side refetch: `BookLineageModal` (task 10) takes `lineage` as a
 * prop rather than fetching it itself, so once a LIVE consumer (`
 * useBookDetail`, wired in a later task) watches `Book.lineage` through
 * `BookDetailDocument`, this mutation's normalization alone is what makes
 * the unlinked row disappear — asserted directly against the cache/DOM in
 * `book-lineage-modal/index.test.tsx`, per Global Constraints' instruction
 * not to reconstruct what normalization already does.
 */
export const BookUnlinkDocumentDocument = graphql(`
  mutation BookUnlinkDocument($id: ID!, $documentId: String!) {
    bookUnlinkDocument(input: { id: $id, documentId: $documentId }) {
      __typename
      ... on BookUnlinkDocumentPayload {
        book {
          id
          lineage {
            ...LineageEntryFragment
          }
        }
      }
      ... on LineageEntryNotFoundError {
        message
      }
      ... on EditLineageEntryError {
        message
      }
      ... on InvalidInputError {
        message
      }
    }
  }
`);
