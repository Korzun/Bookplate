import type { SearchSuggestionsResponse } from '../../../types';
import { builder } from '../builder';
import { model as suggestion } from '../suggestion';
import { model as suggestionType } from '../suggestion-type';

type SuggestionGroupRow = SearchSuggestionsResponse['groups'][number];

/** `type` is a Pothos enum — see the schema-cleanup spec, §"1. Enums". */
export const model = builder.objectRef<SuggestionGroupRow>('SuggestionGroup').implement({
  fields: (t) => ({
    type: t.field({ type: suggestionType, resolve: (group) => group.type }),
    items: t.field({ type: [suggestion], resolve: (group) => group.items }),
  }),
});
