import { builder } from '../builder';

/**
 * Mirrors `book_id_history.type`: schema default `'edit'`, `linkDocument`
 * writes `'merge'` (`book-store.ts:610`). Member names are SCREAMING_CASE
 * per GraphQL convention; `value:` maps to the stored lowercase — see the
 * cleanup spec, §"1. Enums".
 */
export const model = builder.enumType('LineageType', {
  values: {
    EDIT: { value: 'edit' },
    MERGE: { value: 'merge' },
  } as const,
});
