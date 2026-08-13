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
