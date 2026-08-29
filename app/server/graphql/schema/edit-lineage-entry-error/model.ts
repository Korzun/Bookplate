import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * `unlinkDocument`'s (`services/book-lineage.ts`) `'edit_row'` result — the
 * matched `book_id_history` row has `type: 'edit'` (an organic re-import lineage
 * entry, written by `reimportBook`), not `'merge'` (a manual
 * `linkDocument`). Mirrors `DELETE /api/books/:id/link/:documentId`
 * (`routes/ui.ts`), whose 400 body is `{ error: 'Cannot unlink an organic
 * edit entry' }`.
 *
 * NOT a thrown domain-error class, for the identical reason
 * `LineageEntryNotFoundError` (`lineage-entry-not-found-error/model.ts`)
 * gives for its sibling `'not_found'` result — see that file's doc comment.
 */
export type EditLineageEntryErrorShape = {
  readonly __typename: 'EditLineageEntryError';
  readonly message: string;
};

export const editLineageEntryError = (): EditLineageEntryErrorShape => ({
  __typename: 'EditLineageEntryError',
  message: 'Cannot unlink an organic edit entry',
});

export const model = builder
  .objectRef<EditLineageEntryErrorShape>('EditLineageEntryError')
  .implement({
    description:
      'This lineage entry was recorded by re-importing an edited EPUB, not a manual link, and cannot be unlinked.',
    interfaces: [userError],
    fields: () => ({}),
  });
