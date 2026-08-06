import { graphql } from '~/gql';

/**
 * `LibraryEntries` is the most expensive document in this migration:
 * `Library.entries` is priced at `maxSize` (100) because `first` is a
 * variable, and every edge fans out into a `Book` or a `Series`.
 *
 * `SeriesRowFragment` DOES select `Series.books` — `books(first: 3)`, a
 * LITERAL page size, priced at 3 (`literalIntArg`/`pageSizeMultiplier` in
 * `cost-limit.ts`), not the 100 a variable `$first` would price at. Nesting
 * a ×3 connection inside the ×100 `entries` connection is what feeds
 * `CoverStack` its three cover books directly from this document instead of
 * a separate, REST-list-backed fetch — the REST list only ever holds page 1
 * (`page/library`'s grid grows via this document's own `fetchMore`, not the
 * REST list, so nothing keeps that list current past entry 20; see
 * `component/cover-stack`'s doc comment for the regression this replaces).
 *
 * Measured (`test:cost -w app/server`): breadth 47 (47.0%), complexity 6007
 * (18.2%) of budget — comfortably under the 70% gate on both axes. (Before
 * adding `books(first: 3)`: breadth 36 (36.0%), complexity 2907 (8.8%) —
 * confirming the ×3, not ×100, nesting: +11 breadth and +3100 complexity for
 * three books' worth of `id`/`title`/`hasCover`/`mtime`/`thumbnailUrl`,
 * scaled by `entries`' own ×100.)
 */
export const BookRowFragment = graphql(`
  fragment BookRowFragment on Book {
    id
    title
    author
    seriesIndex
    hasCover
    thumbnailUrl(width: 88)
    progress {
      id
      percentage
    }
  }
`);

/**
 * `Series.progressPercentage` — not the bare `progress` this field's server
 * counterpart carried in an earlier revision of task 14 (review round 1).
 * That name would have needed an alias here anyway: `SeriesRowFragment` is
 * spread alongside `BookRowFragment` inside the SAME selection set
 * (`LibraryEntriesDocument`'s `node { ... on Book {...} ... on Series {...} }`,
 * where `LibraryEntry` is the union `Book | Series`), and `Book.progress` is
 * an OBJECT field (`Progress`) — a bare `Series.progress: Float` would have
 * collided on response shape (GraphQL's `SameResponseShape` rule, spec
 * §5.3.2, applies to any two same-response-name fields in a merged selection
 * set regardless of the two fields' parent types being mutually exclusive
 * union members; verified directly against `graphql-js`'s own `validate()`).
 * The rename sidesteps that collision for free, so no alias is needed here.
 */
export const SeriesRowFragment = graphql(`
  fragment SeriesRowFragment on Series {
    id
    name
    author
    bookCount
    progressPercentage
    books(first: 3) {
      edges {
        node {
          id
          title
          hasCover
          mtime
          thumbnailUrl(width: 88)
        }
      }
    }
  }
`);

/**
 * `node(id: $libraryId) { id ... on Library { id ... } }` selects `id` at
 * BOTH levels deliberately: `node` resolves to the `Node` INTERFACE, which
 * declares its own `id`, and an inline `... on Library { id }` alone
 * satisfies `Library`'s cache key but not `Node`'s — the interface selection
 * needs its own `id` for Apollo's normalized cache to key the result
 * (`src/provider/apollo/selection-ids.test.ts` guards this).
 */
export const LibraryEntriesDocument = graphql(`
  query LibraryEntries($libraryId: ID!, $first: Int!, $after: String, $filter: LibraryFilter) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        entries(first: $first, after: $after, filter: $filter) {
          edges {
            cursor
            node {
              __typename
              ... on Book {
                ...BookRowFragment
              }
              ... on Series {
                ...SeriesRowFragment
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

/**
 * `Library.subjects` is a flat `[String!]!` — no connection, no fragment, a
 * single scalar list. Feeds the filter chip picker in `component/search-bar`.
 * Same `node(id:) { id ... on Library { id ... } }` double-`id` shape as
 * `LibraryEntriesDocument` above, for the same cache-key reason.
 */
export const LibrarySubjectsDocument = graphql(`
  query LibrarySubjects($libraryId: ID!) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        subjects
      }
    }
  }
`);
