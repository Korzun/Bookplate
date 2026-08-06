import { graphql } from '~/gql';

/**
 * `LibraryEntries` is the most expensive document in this migration:
 * `Library.entries` is priced at `maxSize` (100) because `first` is a
 * variable, and every edge fans out into a `Book` or a `Series`.
 *
 * `Series.books` is deliberately NOT selected here — it is itself a
 * connection, and selecting a connection inside a ×100-priced connection is
 * the shape most likely to blow the cost budget. `SeriesRowFragment` reads
 * `bookCount`, `author` and `progress` (all scalars on `Series`) instead;
 * the cover stack gets its own fetch, decided separately when the grid row
 * is built.
 *
 * Measured (`test:cost -w app/server`): breadth 36 (36.0%), complexity 2907
 * (8.8%) of budget — comfortably under the 70% gate on both axes. (Before
 * task 14 added `Series.progress` to `SeriesRowFragment`: breadth 35
 * (35.0%), complexity 2807 (8.5%) — a scalar leaf adds a flat +1 breadth and
 * +1×the connection's own page-size multiplier (100, since `first` is a
 * variable here) to complexity, exactly the "page-size multiplier applies
 * to complexity only" rule `cost-limit.ts`'s own doc comment states.)
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
 * `seriesProgress: progress`, not a bare `progress` — `SeriesRowFragment` is
 * spread alongside `BookRowFragment` inside the SAME selection set
 * (`LibraryEntriesDocument`'s `node { ... on Book {...} ... on Series {...} }`,
 * where `LibraryEntry` is the union `Book | Series`). `Book.progress` is an
 * OBJECT field (`Progress`); `Series.progress` (this task) is a `Float`
 * scalar — same response name, incompatible response shapes. GraphQL's
 * field-merging rule (`SameResponseShape`, spec §5.3.2) requires every field
 * with a given response name in a merged selection set to agree on shape
 * REGARDLESS of the two fields' parent types being mutually exclusive union
 * members — verified against this schema directly: `graphql-js`'s own
 * `validate()` with `specifiedRules` rejects the bare-name version with
 * "Fields \"progress\" conflict because they return conflicting types
 * \"Progress\" and \"Float\"." The alias is the fix the error message itself
 * names ("Use different aliases on the fields to fetch both").
 */
export const SeriesRowFragment = graphql(`
  fragment SeriesRowFragment on Series {
    id
    name
    author
    bookCount
    seriesProgress: progress
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
