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
 * `validation` (with a nested `messages(first: 100)` connection) and
 * `lineage` list, all fanning out from a single `Library.book(id:)` lookup —
 * no list connection above it, so none of these fields amplify the way
 * `LibraryEntries`' ×100 `entries` does (`graphql/library.ts`). Breadth is
 * the tight axis here (69.0%, one point off the 70% gate) because breadth
 * counts SELECTED FIELDS, not fan-out, and this document simply selects a
 * lot of them across `book`, `validation` (incl. `counts`, `messages`'
 * connection wrapper and its 7-field `node`), and `lineage`'s 4-field
 * fragment; complexity stays low (4.2%) precisely because none of that is
 * multiplied by a list.
 *
 * Measured (`test:cost -w app/server`): breadth 69 (69.0%), complexity 1371
 * (4.2%) of budget — under the 70% gate on both axes; no trimming lever
 * (brief step 4: `messages(first: 20)`, then splitting `validation` into its
 * own lazy query) was needed. Breadth's 1-point margin is real, not noise —
 * adding any further field here should be re-measured before shipping.
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
            ...ValidationFragment
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
