import { builder } from '../builder';

/**
 * Mirrors `SearchSuggestionsResponse['groups'][number]['type']` in
 * `types.ts`. Member names are SCREAMING_CASE per GraphQL convention;
 * `value:` maps to the stored lowercase — see the cleanup spec, §"1. Enums".
 */
export const model = builder.enumType('SuggestionType', {
  values: {
    AUTHOR: { value: 'author' },
    SERIES: { value: 'series' },
    BOOK: { value: 'book' },
    SUBJECT: { value: 'subject' },
  } as const,
});
