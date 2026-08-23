import { graphql } from '~/gql';

/**
 * One progress row. `book` is NULLABLE by design — a device syncs progress for
 * documents that are not in this library, and those rows still render with the
 * raw `document` hash and no book link.
 *
 * `id` is `Progress`'s computed global id — the cache key AND `progressDelete`'s
 * argument. It is deliberately NOT resolvable through `node(id:)`; `Progress` is
 * not a `Node`. `document` is the RAW content hash and is what `progressSet`
 * takes.
 */
export const ProgressRowFragment = graphql(`
  fragment ProgressRowFragment on Progress {
    id
    document
    percentage
    currentChapter
    device
    timestamp
    book {
      id
      title
      author
      hasCover
      thumbnailUrl(width: 88)
    }
  }
`);

/**
 * The viewer's own progress. Forward-only — `Library.progress` rejects
 * `last`/`before`. Callers should pass `first: 50`, matching
 * `CONNECTION_LIMITS.libraryProgress.defaultSize`; the server's cap is 100.
 *
 * `$first` is a VARIABLE in this document (not a literal), so
 * `Library.progress` is PRICED at its `maxSize` (100) regardless of what a
 * caller actually passes (`cost-limit.ts`'s `multiplierFor` prices a
 * variable-valued `first`/`last` at the field's max, not its default) — the
 * measured numbers below already reflect that worst case, not the 50 a
 * well-behaved caller sends.
 *
 * Measured (`npm run test:cost -w app/server`): breadth 32 (32.0%), complexity
 * 2507 (7.6%) of budget.
 */
export const MyProgressListDocument = graphql(`
  query MyProgressList($libraryId: ID!, $first: Int!, $after: String) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        progress(first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              ...ProgressRowFragment
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

/**
 * The collapsed card's subtitle, with NO rows fetched.
 *
 * `viewer.user`, not `Query.user(id:)` — the latter is admin-only and refuses a
 * non-admin even for their own id. `Viewer.user` is NULLABLE and is null for the
 * config-based admin, which has no `User` row (the same reason `viewer.library`
 * is null for it).
 *
 * Measured (`npm run test:cost -w app/server`): breadth 7 (7.0%), complexity 7
 * (0.0%) of budget.
 */
export const MyProgressCountDocument = graphql(`
  query MyProgressCount {
    viewer {
      user {
        id
        progressCount
      }
    }
  }
`);

/**
 * An admin viewing ANOTHER user's progress. Roots at `Query.user(id:)`, not
 * `node(id: $libraryId)` — the target is a different user's library, and
 * `UserRow` already holds their `userId`. `Query.user(id:)` is admin-only, which
 * is correct here: this row renders only for admins.
 *
 * Same `$first`-is-a-variable pricing as `MyProgressListDocument` above: the
 * `progress` connection prices at `maxSize` (100), not the 50 passed.
 *
 * Measured (`npm run test:cost -w app/server`): breadth 33 (33.0%), complexity
 * 2508 (7.6%) of budget.
 */
export const UserProgressListDocument = graphql(`
  query UserProgressList($userId: ID!, $first: Int!, $after: String) {
    user(id: $userId) {
      id
      library {
        id
        progress(first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              ...ProgressRowFragment
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

/**
 * `ProgressSetResult` genuinely has two members (schema-verified,
 * `app/server/graphql/schema.generated.graphql`): `ProgressSetPayload` and
 * `InvalidInputError` — unlike `ProgressDeleteResult` below, which has only
 * one. Both branches are selected; omitting `InvalidInputError` would
 * silently swallow a real rejected-input error at runtime.
 *
 * `user { id progressCount }` (I-2, final whole-branch review): the profile
 * card's "N books synced" subtitle (`MyProgressCountDocument`, read off the
 * SAME `Viewer.user`/`User:<id>` entity) and the admin's per-row subtitle
 * (`UserListDocument`) both key off `User.progressCount`. Neither this
 * document nor `ProgressDeleteDocument` below wrote to a `User` at all
 * before this fix, so a set/delete left those subtitles stale until an
 * unrelated refetch. No hand-written `update` is needed for it: `id` is
 * enough for Apollo to identify the ALREADY-cached `User:<id>` entity (every
 * signed-in viewer has been through `ViewerBootstrapDocument` or
 * `UserListDocument` by the time this mutation is reachable), and normal
 * normalization overwrites `progressCount` on it directly.
 *
 * Measured (`npm run test:cost -w app/server`): breadth 30 (30.0%), complexity
 * 30 (0.1%) of budget.
 */
export const ProgressSetDocument = graphql(`
  mutation ProgressSet($input: ProgressSetInput!) {
    progressSet(input: $input) {
      __typename
      ... on ProgressSetPayload {
        progress {
          id
          ...ProgressRowFragment
        }
        library {
          id
        }
        user {
          id
          progressCount
        }
      }
      ... on InvalidInputError {
        message
      }
    }
  }
`);

/**
 * `ProgressDeleteResult` is a single-member union today (schema-verified,
 * `app/server/graphql/schema.generated.graphql`) — no error branch is added,
 * matching the "no speculative error members" rule (spec 1's
 * traced-union-drop precedent).
 *
 * `user { id progressCount }` (I-2, final whole-branch review): see
 * `ProgressSetDocument`'s identical note above — same reasoning, and it
 * matters MORE here, since `progressDelete` is admin-capable
 * (`ProgressDeleteInput.id` can name another user's row): the payload's
 * `user` is the row's actual OWNER (decoded server-side from the input id),
 * never the admin caller, so this is what makes normalization decrement the
 * RIGHT person's count.
 *
 * Measured (`npm run test:cost -w app/server`): breadth 12 (12.0%), complexity
 * 12 (0.0%) of budget.
 */
export const ProgressDeleteDocument = graphql(`
  mutation ProgressDelete($id: ID!) {
    progressDelete(input: { id: $id }) {
      __typename
      ... on ProgressDeletePayload {
        deletedId
        library {
          id
        }
        user {
          id
          progressCount
        }
      }
    }
  }
`);

/**
 * `BookLinkDocumentResult` genuinely has four error members plus the payload
 * (schema-verified, `app/server/graphql/schema.generated.graphql`):
 * `DocumentAlreadyLinkedError`, `DocumentIsBookError`, `InvalidInputError`,
 * and `SelfLinkError`, each `implements UserError` and exposes `message`. All
 * four are selected here.
 *
 * `book { id lineage { oldId newId type } }` re-selects the full lineage list
 * so Apollo's own normalization overwrites the array on the existing
 * `Book:<id>` entity, matching `BookUnlinkDocumentDocument`'s convention
 * (`graphql/book.ts`).
 *
 * Measured (`npm run test:cost -w app/server`): breadth 20 (20.0%), complexity
 * 96 (0.3%) of budget.
 */
export const BookLinkDocumentDocument = graphql(`
  mutation BookLinkDocument($id: ID!, $documentId: String!) {
    bookLinkDocument(input: { id: $id, documentId: $documentId }) {
      __typename
      ... on BookLinkDocumentPayload {
        book {
          id
          lineage {
            oldId
            newId
            type
          }
        }
      }
      ... on DocumentAlreadyLinkedError {
        message
      }
      ... on DocumentIsBookError {
        message
      }
      ... on SelfLinkError {
        message
      }
      ... on InvalidInputError {
        message
      }
    }
  }
`);

/**
 * The link modal's book picker. Server-side filtered via `LibraryFilter.query`
 * — `entryType` was deliberately NOT added, despite the brief's original
 * draft: the `LibraryEntryType` enum (schema-verified,
 * `app/server/graphql/schema.generated.graphql`) has only `SERIES` and
 * `STANDALONE`, no `BOOK` value. `STANDALONE` looks like the obvious
 * substitute but is wrong, not just imprecise — `entries-filter.test.ts:172`
 * proves it returns ONLY ungrouped books, so filtering by it would silently
 * hide every series-grouped book from the picker, which is worse than no
 * filter at all for a "link this document to a book" flow.
 *
 * That means `Library.entries` is queried unfiltered by type, so a page can
 * be diluted with `Series` entries this document doesn't select (it only
 * has an inline fragment on `Book`) — a `Series`-heavy library can return
 * materially fewer than `first` usable rows. The compensation is `first:
 * 100` (`CONNECTION_LIMITS.libraryEntries.maxSize`, the most the server will
 * serve — schema-verified, `app/server/graphql/schema/pagination.ts:186`)
 * plus `pageInfo`/`cursor` so a caller CAN page past a dilute page if it
 * needs to. Raising the literal page size from 20 to 100 is free on the
 * tight axis: breadth counts selected fields, unweighted by any connection
 * multiplier, so it costs zero additional breadth — only complexity moves,
 * and only moderately (fans a fixed per-edge cost ×100 instead of ×20). This
 * document does not decide whether the picker actually offers a "Load more"
 * — that is left to whichever task wires up the UI.
 *
 * Replaces a fetch-the-whole-library-then-filter-locally REST hook with a
 * server-side `query` filter and a `first: 100` page size (moved off the
 * REST hook's implicit "fetch everything" behavior onto the same
 * `after`-only forward pagination every other list document here uses).
 *
 * Measured (`npm run test:cost -w app/server`): breadth 21 (21.0%), complexity
 * 1407 (4.3%) of budget.
 */
export const LinkPickerBooksDocument = graphql(`
  query LinkPickerBooks($libraryId: ID!, $query: String, $after: String) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        entries(first: 100, after: $after, filter: { query: $query }) {
          edges {
            cursor
            node {
              __typename
              ... on Book {
                id
                title
                author
              }
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
