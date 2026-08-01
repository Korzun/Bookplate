import type { SearchSuggestionsResponse } from '../../../../types';
import { builder } from '../../builder';
import { model as library } from '../../library';

type SuggestionGroupRow = SearchSuggestionsResponse['groups'][number];
type SuggestionRow = SuggestionGroupRow['items'][number];

const suggestion = builder.objectRef<SuggestionRow>('Suggestion').implement({
  fields: (t) => ({
    label: t.exposeString('label'),
    value: t.exposeString('value'),
    matchStart: t.exposeInt('matchStart'),
    matchLength: t.exposeInt('matchLength'),
  }),
});

/**
 * `type` is exposed as a plain string, not a Pothos enum (contrast
 * `LibraryEntryStatus`/`LibraryEntryKind` in `../get-all.ts`). Those two
 * enums exist only as *input* filters today, so there's no precedent in this
 * codebase for what an enum's wire value looks like on *output*. Standard
 * GraphQL enum serialization returns the enum member's name (e.g. `BOOK`),
 * not the internal value it's mapped from (`'book'`) — so a
 * `SCREAMING_SNAKE_CASE` enum, consistent with those two siblings, would
 * change the wire shape from what the store already returns. A string field
 * mirrors `SearchSuggestionsResponse['groups'][number]['type']` exactly, with
 * no mapping step to keep in sync as the store's four literal values evolve.
 */
const suggestionGroup = builder.objectRef<SuggestionGroupRow>('SuggestionGroup').implement({
  fields: (t) => ({
    type: t.exposeString('type'),
    items: t.field({ type: [suggestion], resolve: (group) => group.items }),
  }),
});

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
