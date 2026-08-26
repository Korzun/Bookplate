import { graphql } from '~/gql';

/**
 * One `MetadataFix`. `changes` is a `JSON` scalar leaf — a heterogeneous
 * per-field patch payload with no natural GraphQL representation.
 */
export const MetadataFixFragment = graphql(`
  fragment MetadataFixFragment on MetadataFix {
    field
    kind
    from
    to
    reason
    fromChips
    toChips
    changes
  }
`);

/**
 * One pending-fix row.
 *
 * `undo { kind }` and NOTHING else is deliberate. The snapshot's own
 * `proposals`/`appliedFixes` are what the server restores on an `UNDO`, and
 * `originalMetadata` is not exposed at all — the client renders only whether
 * an undo is armed and its kind, for the button label
 * (`fix-review/index.tsx`). `appliedFixes` itself IS selected despite this —
 * the auto-fix toast in `page/upload/index.tsx` and `FixReview` both render
 * it — so this fragment's host query, `LibraryPendingFixesDocument`, ships
 * at breadth 55 (55.0%) (measured: `npm run test:cost -w app/server`), not
 * the leaner shape a pre-planning probe without `appliedFixes` once measured.
 *
 * `book` is non-null on this type (`PendingFix.book: Book!`), unlike
 * `Progress.book`.
 */
export const PendingFixRowFragment = graphql(`
  fragment PendingFixRowFragment on PendingFix {
    id
    fileName
    fileSize
    book {
      id
      title
      author
    }
    state {
      autoFixes {
        ...MetadataFixFragment
      }
      appliedFixes {
        ...MetadataFixFragment
      }
      proposals {
        ...MetadataFixFragment
      }
      undo {
        kind
      }
    }
  }
`);

/**
 * Every pending-fix row in the current library. `Library.pendingFixes` is an
 * unpaginated `[PendingFix!]!` — measured and admitted (see this document's
 * recorded numbers below), so no `first` argument is needed.
 *
 * Rooted at `node(id:)` because a `Library` global ID is what
 * `useCurrentLibraryId()` hands out, and that id serves admins (viewing
 * another user's library) and non-admins alike.
 *
 * `node(id: $libraryId) { id ... on Library { id ... } }` selects `id` at
 * BOTH levels deliberately, matching `LibraryEntriesDocument`
 * (`src/page/library/index.tsx`): `node` resolves to the `Node` INTERFACE, which
 * declares its own `id`, and an inline `... on Library { id }` alone
 * satisfies `Library`'s cache key but not `Node`'s — the interface selection
 * needs its own `id` for Apollo's normalized cache to key the result
 * (`src/provider/apollo/selection-ids.test.ts` guards this).
 *
 * Measured (`npm run test:cost -w app/server`): breadth 55 (55.0%), complexity
 * 4807 (14.6%) of budget.
 */
export const LibraryPendingFixesDocument = graphql(`
  query LibraryPendingFixes($libraryId: ID!) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        pendingFixes {
          ...PendingFixRowFragment
        }
      }
    }
  }
`);

/**
 * Accept / dismiss / undo / clear, all four through one mutation.
 *
 * `library { id pendingFixes }` is selected so the row list reconciles IN
 * PLACE — the payload carries `library` for exactly this purpose (see the
 * resolver's own field comment). Without it, every action would need a
 * follow-up refetch.
 *
 * `book { id }` is selected because an `ACCEPT` (or an `UNDO` of one) rewrites
 * the EPUB and mints a NEW content-hash id; callers need the new id to keep
 * pointing at the right book.
 *
 * Measured (`npm run test:cost -w app/server`): breadth 67 (67.0%), complexity
 * 4819 (14.6%) of budget — close to the 70% breadth gate, driven by
 * `PendingFixRowFragment`'s three `MetadataFix` arrays appearing twice (once
 * directly, once inside `library { pendingFixes }`).
 */
export const BookResolvePendingFixDocument = graphql(`
  mutation BookResolvePendingFix(
    $id: ID!
    $action: PendingFixResolution!
    $fixes: [MetadataFixKeyInput!]
  ) {
    bookResolvePendingFix(input: { id: $id, action: $action, fixes: $fixes }) {
      __typename
      ... on BookResolvePendingFixPayload {
        book {
          id
          title
          author
        }
        library {
          id
          pendingFixes {
            ...PendingFixRowFragment
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
    }
  }
`);

/**
 * Replaces `GET /api/config`. The upload queue reads only the concurrency cap.
 *
 * Measured (`npm run test:cost -w app/server`): breadth 4 (4.0%), complexity
 * 4 (0.0%) of budget.
 */
export const UploadConfigDocument = graphql(`
  query UploadConfig {
    config {
      maxConcurrentUploads
    }
  }
`);

/**
 * Read-only analysis of a staged EPUB as a replacement candidate. The staged
 * upload is NOT consumed, so a user can analyze, review the proposed fixes,
 * and then commit the same `stagedUploadId` via `BookReplace`.
 *
 * `messages` (epubcheck findings) is NOT selected — the replace modal does
 * not render them today, and every selection costs breadth.
 *
 * Measured (`npm run test:cost -w app/server`): breadth 31 (31.0%), complexity
 * 31 (0.1%) of budget.
 */
export const BookAnalyzeReplaceDocument = graphql(`
  mutation BookAnalyzeReplace($id: ID!, $stagedUploadId: String!) {
    bookAnalyzeReplace(input: { id: $id, stagedUploadId: $stagedUploadId }) {
      __typename
      ... on BookAnalyzeReplacePayload {
        valid
        autoFixes {
          ...MetadataFixFragment
        }
        proposals {
          ...MetadataFixFragment
        }
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

/**
 * Commits the staged replacement. Returns the post-replace book, whose id may
 * have rotated.
 *
 * `$acceptedFixKeys: [String!]!` is required, NOT `[MetadataFixKeyInput!]` —
 * `BookReplaceInput.acceptedFixKeys` takes joined "field:kind:from" strings,
 * unlike `BookResolvePendingFixInput.fixes`. The two mutations genuinely
 * differ in how they address fixes; that asymmetry is pre-existing.
 *
 * Measured (`npm run test:cost -w app/server`): breadth 17 (17.0%), complexity
 * 17 (0.1%) of budget.
 */
export const BookReplaceDocument = graphql(`
  mutation BookReplace($id: ID!, $stagedUploadId: String!, $acceptedFixKeys: [String!]!) {
    bookReplace(
      input: { id: $id, stagedUploadId: $stagedUploadId, acceptedFixKeys: $acceptedFixKeys }
    ) {
      __typename
      ... on BookReplacePayload {
        book {
          id
          title
          author
        }
      }
      ... on BookHashCollisionError {
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
