import { graphql } from '~/gql';

/**
 * `LibraryEntriesDocument`, `BookRowFragment`, and `SeriesRowFragment` no
 * longer live here (task 5): the document is composed at
 * `page/library/index.tsx` (its only reader), and the two fragments are
 * colocated on the components that render them —
 * `component/book-row/from-entry.tsx` and `component/series-row/index.tsx`
 * respectively. This file keeps only the documents with no single natural
 * route/component owner.
 */

/**
 * `Library.subjects` is a flat `[String!]!` — no connection, no fragment, a
 * single scalar list. Feeds the filter chip picker in `component/search-bar`.
 * Same `node(id:) { id ... on Library { id ... } }` double-`id` shape as
 * `LibraryEntriesDocument` (now `page/library/index.tsx`), for the same
 * cache-key reason.
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

/**
 * `Library.series` feeds the book edit form's series autocomplete
 * (`useSeriesNames`). Same `node(id:) { id ... on Library { id ... } }`
 * double-`id` shape as `LibrarySubjectsDocument` above, for the same
 * cache-key reason. Unlike `subjects`, `series` is `[Series!]!` — each
 * entry is a real `Series` node (its own `id`), so it is selected as an
 * object (`id`, `name`), not a flat scalar list.
 */
export const SeriesNamesDocument = graphql(`
  query SeriesNames($libraryId: ID!) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        series {
          id
          name
        }
      }
    }
  }
`);

/**
 * `Library.seriesNextIndex(name:)` backs `useFetchSeriesNextIndex` — an
 * on-demand lookup fired only once the user picks a series in the book edit
 * form, never on mount. That is why its consuming hook uses `useLazyQuery`
 * rather than `useQuery`; see that hook's doc comment for the variables
 * trap this shape guards against.
 */
export const SeriesNextIndexDocument = graphql(`
  query SeriesNextIndex($libraryId: ID!, $name: String!) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        seriesNextIndex(name: $name)
      }
    }
  }
`);

/**
 * Existence/type check for an admin's stored `targetLibraryId`, backing the
 * self-heal effect in `useCurrentLibraryId` (Task 11). No inline `... on
 * Library { ... }` fragment — the ONLY thing this document needs is whether
 * `node(id:)` resolved at all and, via the auto-injected `__typename`
 * (`codegen.ts`'s `addTypenameSelectionDocumentTransform`), to WHICH type;
 * no `Library` field is ever read off the result.
 *
 * Re-homed from `useFetchBookList`'s dead 404 branch
 * (`provider/book/hook/use-fetch-book-list.ts:77`, its last live caller
 * removed by an earlier task): that REST-era clear fired only when
 * something happened to call `fetchBookList`. Rooting the same check here
 * fires wherever the library is actually read, not only from an
 * action-triggered fetch.
 *
 * Measured (`npm run test:cost -w app/server`): breadth 4 (4.0%), complexity
 * 4 (0.0%) of budget.
 */
export const LibraryTargetResolveDocument = graphql(`
  query LibraryTargetResolve($libraryId: ID!) {
    node(id: $libraryId) {
      id
    }
  }
`);
