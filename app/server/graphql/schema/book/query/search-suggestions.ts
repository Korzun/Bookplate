import { builder } from '../../builder';
import { model as library } from '../../library';
import { model as suggestionGroup } from '../../suggestion-group';

/**
 * Narrower than `LibraryFilter` (`../get-all.ts`) on purpose: that input has
 * six fields, but `BookStore.getSearchSuggestions` only reads three
 * (`author`, `seriesName`, `activeSubjects`) — `query`, `status`, and
 * `entryType` would silently do nothing if accepted here. A client passing
 * `LibraryFilter` fields the store ignores would have no way to discover
 * that short of reading the resolver; a filter input scoped to exactly what
 * the store consumes can't misrepresent itself that way.
 */
const searchSuggestionsFilter = builder.inputType('SearchSuggestionsFilter', {
  fields: (t) => ({
    author: t.string({ required: false }),
    seriesName: t.string({ required: false }),
    activeSubjects: t.stringList({ required: false }),
  }),
});

builder.objectField(library, 'searchSuggestions', (t) =>
  t.field({
    type: [suggestionGroup],
    args: {
      query: t.arg.string({ required: true }),
      filter: t.arg({ type: searchSuggestionsFilter, required: false }),
    },
    // Blank/whitespace `query` is not special-cased here — it's handled once,
    // inside `getSearchSuggestions` itself (`normalizeForSearch` short-circuits
    // to `{ groups: [] }`). Duplicating that check here would risk drifting
    // from the store's own definition of "blank".
    resolve: async (owner, args, context) => {
      const response = await context.stores.book.getSearchSuggestions(owner, {
        q: args.query,
        filter: {
          author: args.filter?.author ?? undefined,
          seriesName: args.filter?.seriesName ?? undefined,
          activeSubjects: args.filter?.activeSubjects ?? undefined,
        },
      });
      return response.groups;
    },
  })
);
