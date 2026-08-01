import type { SearchSuggestionsResponse } from '../../../types';
import { builder } from '../builder';
import { model as suggestion } from '../suggestion';

type SuggestionGroupRow = SearchSuggestionsResponse['groups'][number];

/**
 * `type` is exposed as a plain string, not a Pothos enum (contrast
 * `LibraryEntryStatus`/`LibraryEntryKind` in `book/query/get-all.ts`). Those
 * two enums exist only as *input* filters today, so there's no precedent in
 * this codebase for what an enum's wire value looks like on *output*.
 * Standard GraphQL enum serialization returns the enum member's name (e.g.
 * `BOOK`), not the internal value it's mapped from (`'book'`) — so a
 * `SCREAMING_SNAKE_CASE` enum, consistent with those two siblings, would
 * change the wire shape from what the store already returns. A string field
 * mirrors `SearchSuggestionsResponse['groups'][number]['type']` exactly, with
 * no mapping step to keep in sync as the store's four literal values evolve.
 */
export const model = builder.objectRef<SuggestionGroupRow>('SuggestionGroup').implement({
  fields: (t) => ({
    type: t.exposeString('type'),
    items: t.field({ type: [suggestion], resolve: (group) => group.items }),
  }),
});
