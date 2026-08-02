import type { SearchSuggestionsResponse } from '../../../types';
import { builder } from '../builder';
import { model as suggestionType } from '../suggestion-type';
import { model as suggestion, type SuggestionRow } from '../suggestion/model';

// `items` widened to `SuggestionRow[]` (not the raw service type) — see
// `suggestion/model.ts`'s doc comment: `Library.searchSuggestions` stitches
// an internal `userId` onto a `BOOK`-typed group's items so `Suggestion.book`
// can resolve, and that shape has to flow through this type for the resolver
// below to type-check.
type SuggestionGroupRow = Omit<SearchSuggestionsResponse['groups'][number], 'items'> & {
  items: SuggestionRow[];
};

/** `type` is a Pothos enum — see the schema-cleanup spec, §"1. Enums". */
export const model = builder.objectRef<SuggestionGroupRow>('SuggestionGroup').implement({
  fields: (t) => ({
    type: t.field({ type: suggestionType, resolve: (group) => group.type }),
    items: t.field({ type: [suggestion], resolve: (group) => group.items }),
  }),
});
