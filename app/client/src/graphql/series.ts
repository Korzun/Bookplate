import { graphql } from '~/gql';

/**
 * One row of the series' book list. Deliberately NOT `BookRowFragment`
 * (`component/book-row/from-entry.tsx`): that one selects `thumbnailUrl(width: 88)` for the
 * grid and is spread inside the `LibraryEntry` union, where `Series`'s own
 * fields sit beside it. This is a plain `Series.books` edge — no union, no
 * collision — and the series page shows no author per row (`showAuthor={false}`),
 * so `author` is dropped.
 */
export const SeriesBookRowFragment = graphql(`
  fragment SeriesBookRowFragment on Book {
    id
    title
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
 * Rooted at `node(id: $libraryId)` like every library-scoped screen (spec §2):
 * `Query.user(id:)` is admin-only and `viewer.library` is null for the
 * config-based admin, so `node(id:)` is the only single root serving both roles.
 *
 * `books(first: 100)` is a LITERAL page size, priced at 100 rather than the
 * `maxSize` a variable `$first` would price at — identical to
 * `SeriesRowFragment`'s `books(first: 3)` in `component/series-row/index.tsx`. 100 matches
 * `CONNECTION_LIMITS.seriesBooks.maxSize` and the `MAX_TAKE` the REST hook this
 * replaces used, so a >100-book series truncates exactly as it did before; that
 * is a carried limitation, not a new one.
 *
 * `progressPercentage` replaces `useMySeriesProgress`'s client-side tally —
 * the server field added in step 5 whose semantics were verified to match it
 * exactly (parent spec §15).
 *
 * Measured (`test:cost -w app/server`): breadth 33 (33.0%), complexity 1617
 * (4.9%) of budget — comfortably under the 70% gate on both axes.
 */
export const SeriesDetailDocument = graphql(`
  query SeriesDetail($libraryId: ID!, $name: String!) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        seriesByName(name: $name) {
          id
          name
          author
          publisher
          totalPages
          totalSize
          subjects
          progressPercentage
          books(first: 100) {
            edges {
              node {
                id
                ...SeriesBookRowFragment
              }
            }
          }
        }
      }
    }
  }
`);
