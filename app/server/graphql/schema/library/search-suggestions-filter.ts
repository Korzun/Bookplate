import { builder } from '../builder';

/**
 * Narrower than `LibraryFilter` (`./entries-filter.ts`) on purpose: that input
 * has six fields, but `getSearchSuggestions` (`services/search-suggestions.ts`)
 * only reads three (`author`, `seriesName`, `activeSubjects`) — `query`,
 * `status`, and `entryType` would silently do nothing if accepted here. A
 * client passing `LibraryFilter` fields `getSearchSuggestions` ignores would
 * have no way to discover that short of reading the resolver; a filter input
 * scoped to exactly what it consumes can't misrepresent itself that way.
 */
export const searchSuggestionsFilter = builder.inputType('SearchSuggestionsFilter', {
  fields: (t) => ({
    author: t.string({ required: false }),
    seriesName: t.string({ required: false }),
    activeSubjects: t.stringList({ required: false }),
  }),
});
