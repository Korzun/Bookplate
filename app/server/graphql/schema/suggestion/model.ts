import type { SearchSuggestionsResponse } from '../../../types';
import { builder } from '../builder';

type SuggestionRow = SearchSuggestionsResponse['groups'][number]['items'][number];

export const model = builder.objectRef<SuggestionRow>('Suggestion').implement({
  fields: (t) => ({
    label: t.exposeString('label'),
    value: t.exposeString('value'),
    matchStart: t.exposeInt('matchStart'),
    matchLength: t.exposeInt('matchLength'),
  }),
});
