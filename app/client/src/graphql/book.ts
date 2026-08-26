import { graphql } from '~/gql';

/**
 * `Book.validation` is nullable — null means "never validated", which is what
 * REST's tri-state `valid?: boolean | null` expressed as `undefined`. The page's
 * `editingBlocked` therefore reads `validation?.valid !== true`, preserving
 * REST's `book.valid !== true` for all three states. (This carried a stale
 * "VERIFY this mapping against the resolver … (Task 7, Step 1)" instruction
 * from the PREDECESSOR project, whose task numbering does not match this
 * one's — "Task 7" here names a different, already-shipped task. The
 * mapping was verified and shipped; nothing is outstanding.)
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
          segments {
            text
            subject
          }
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
 *
 * **Why this fragment is NOT colocated into `control/book-lineage-modal`**,
 * the component that actually renders it (2026-08-26, the lazy-split task).
 * It has TWO spread sites in two different modules — `BookLineageDocument`
 * (`page/book/query.ts`, the route's lazy read) and
 * `BookUnlinkDocumentDocument` below, whose payload re-selects the whole
 * list so the cache refreshes without a refetch — which makes it a SHARED
 * leaf, and shared GraphQL leaves live here. The placement is also forced:
 * every file under `~/graphql/` imports nothing but `~/gql`, and moving
 * this fragment into the modal would make THIS file import that component
 * and close a real import cycle back through the modal's own subtree
 * (`book-lineage-modal → book-lineage-row → book-lineage-merge-row →
 * unlink-book-lineage-button → ~/graphql/book.ts`) — precisely the hazard
 * `src/test-utils.tsx`'s standing note documents.
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
 * `BookDeleteResult` is a single-member union today (schema-verified,
 * `app/server/graphql/schema/book/mutation/delete.ts`) — no error branch is
 * added here, matching the "no speculative error members" rule (spec 1's
 * traced-union-drop precedent). `deletedId` is the ONLY field
 * `page/book`'s delete `update` needs to `cache.identify` and evict the
 * `Book` entity; `library { id }` is what lets it ALSO evict the owning
 * `Library`'s `entries` connection field (see that handler's doc comment for
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
 * `BookValidationDocument`'s doc comment, now in `page/book/query.ts`), so
 * this payload normalizes
 * onto the SAME `Book`/`Validation` cache entities `BookDetailDocument` and
 * `BookValidationDocument` already read. No hand-written `update` function:
 * Apollo's own normalization does the work, asserted in `page/book`'s own
 * test ("writes the fresh validation onto the book via normalization, with no
 * manual update") rather than reconstructed here.
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
 * both toasted by `page/book`'s regen handler. `book { id
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
 * hand-written `update` function — asserted in `page/book`'s own test
 * ("zeroes deviceEditionCount in the cache with no hand-written update").
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
 * client-side refetch: `BookLineageModal` takes `lineage` as a prop rather
 * than fetching it itself, and its LIVE consumer — `page/book`'s
 * `BookLineageDocument` (`page/book/query.ts`), which roots identically to
 * this payload's `book { id … }` and therefore shares the SAME `Book:<id>`
 * entity — watches `Book.lineage` through the cache, so this mutation's
 * normalization alone is what makes the unlinked row disappear. Asserted
 * directly against the cache/DOM in `book-lineage-modal/index.test.tsx`,
 * per Global Constraints' instruction not to reconstruct what
 * normalization already does.
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
