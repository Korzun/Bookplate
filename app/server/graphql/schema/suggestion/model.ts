import type { SearchSuggestionsResponse } from '../../../types';
import { model as book } from '../book/model';
import { builder } from '../builder';

/**
 * `userId` is internal only — not an SDL field. Traced against
 * `getSearchSuggestions` (`services/search-suggestions.ts`): of the four suggestion
 * group types (`author`, `series`, `book`, `subject`), only `book`'s `value`
 * is semantically a book id (`bookRows.map((r) => ({ label: r.title, value:
 * r.id }))` — the book's own content-hash `id`, the same id `LinkedDocument.
 * oldId`/`newId` carry). `author`/`series`/`subject` values are the label
 * text itself, never a book id, so `userId` stays `undefined` for their
 * items and `book` resolves null without a lookup. `Library.searchSuggestions`
 * (`library/model.ts`) is the one place that stitches `userId` onto a
 * `book`-typed group's items, from the `Owner` it already resolved — the
 * same "thread the owner the parent already resolved" shape `Book.lineage`
 * uses for `LinkedDocument.oldBook`/`newBook`.
 */
export type SuggestionRow = SearchSuggestionsResponse['groups'][number]['items'][number] & {
  userId?: string;
};

export const model = builder.objectRef<SuggestionRow>('Suggestion').implement({
  fields: (t) => ({
    label: t.exposeString('label'),
    value: t.exposeString('value'),
    matchStart: t.exposeInt('matchStart'),
    matchLength: t.exposeInt('matchLength'),
    // Nullable: resolvable only for a `BOOK`-typed suggestion (see this
    // file's `SuggestionRow` doc comment) — every other type's `value` isn't
    // a book id at all, so a lookup would be meaningless even if it happened
    // to match a row.
    book: t.prismaField({
      type: book,
      nullable: true,
      resolve: (query, suggestion, _args, context) =>
        suggestion.userId === undefined
          ? null
          : context.prisma.book.findUnique({
              ...query,
              where: { userId_id: { userId: suggestion.userId, id: suggestion.value } },
            }),
    }),
  }),
});
