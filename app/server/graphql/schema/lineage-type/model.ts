import { builder } from '../builder';

/**
 * Mirrors `book_id_history.type`: schema default `'edit'`, `linkDocument`
 * writes `'merge'` (`book-store.ts:610`). Member names are SCREAMING_CASE
 * per GraphQL convention; `value:` maps to the stored lowercase — see the
 * cleanup spec, §"1. Enums". No exported source type exists for this one —
 * the write sites are raw SQL — so the local union below is the source of
 * truth; the `satisfies` guard still pins the `values:` map to it.
 */
type LineageTypeValue = 'edit' | 'merge';

export const model = builder.enumType('LineageType', {
  values: {
    EDIT: { value: 'edit' },
    MERGE: { value: 'merge' },
  } as const satisfies Record<Uppercase<LineageTypeValue>, { value: LineageTypeValue }>,
});
