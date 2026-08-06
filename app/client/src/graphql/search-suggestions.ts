import { graphql } from '~/gql';

/**
 * `Suggestion.book` (a nullable `Book`) is deliberately NOT selected here.
 * `component/search-bar/index.tsx`'s dropdown renders a suggestion from its
 * own `label`/`value`/`matchStart`/`matchLength`/`additive` fields only — it
 * never reads a nested book. For a `BOOK`-typed suggestion, `value` is
 * already the book's own content-hash id (server's `suggestion/model.ts` doc
 * comment), which `path.book(value)` navigates with directly, so there is no
 * caller that needs `Suggestion.book` at all. Selecting it — let alone
 * spreading `BookRowFragment` into it — would hang a whole `Book` type off
 * every item of every group, multiplying this document's cost for a
 * dropdown that shows a label. `node(id:) { id ... on Library { id ... } }`
 * selects `id` at both levels for the same cache-key reason as
 * `LibraryEntriesDocument` (`graphql/library.ts`).
 */
export const SearchSuggestionsDocument = graphql(`
  query SearchSuggestions($libraryId: ID!, $query: String!, $filter: SearchSuggestionsFilter) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        searchSuggestions(query: $query, filter: $filter) {
          type
          items {
            label
            value
            matchStart
            matchLength
          }
        }
      }
    }
  }
`);
