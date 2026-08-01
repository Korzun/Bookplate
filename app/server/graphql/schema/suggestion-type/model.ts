import type { SearchSuggestionsResponse } from '../../../types';
import { builder } from '../builder';

type SuggestionTypeValue = SearchSuggestionsResponse['groups'][number]['type'];

/**
 * Mirrors `SearchSuggestionsResponse['groups'][number]['type']` in
 * `types.ts`. Member names are SCREAMING_CASE per GraphQL convention;
 * `value:` maps to the stored lowercase — see the cleanup spec, §"1. Enums".
 * The value union is `satisfies`-checked against that source type
 * (imported, not hand-duplicated) so the two cannot silently drift apart.
 */
export const model = builder.enumType('SuggestionType', {
  values: {
    AUTHOR: { value: 'author' },
    SERIES: { value: 'series' },
    BOOK: { value: 'book' },
    SUBJECT: { value: 'subject' },
  } as const satisfies Record<Uppercase<SuggestionTypeValue>, { value: SuggestionTypeValue }>,
});
