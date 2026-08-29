import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * `unlinkDocument`'s (`services/book-lineage.ts`) `'not_found'` result — no
 * `book_id_history`
 * row matches `(userId, old_id: documentId, current_id: bookId)`. Mirrors
 * `DELETE /api/books/:id/link/:documentId` (`routes/ui.ts`), whose 404 body
 * is `{ error: 'Lineage entry not found' }`.
 *
 * NOT a thrown store class: `unlinkDocument` returns a plain string
 * discriminator (`'deleted' | 'not_found' | 'edit_row'`), never an
 * exception, for this case — so, exactly like `BookNotValidatedError`
 * (`book-not-validated-error/model.ts`), this factory's message is a direct
 * literal mirror of REST's own text rather than copied off an `Error`
 * instance.
 */
export type LineageEntryNotFoundErrorShape = {
  readonly __typename: 'LineageEntryNotFoundError';
  readonly message: string;
};

export const lineageEntryNotFoundError = (): LineageEntryNotFoundErrorShape => ({
  __typename: 'LineageEntryNotFoundError',
  message: 'Lineage entry not found',
});

export const model = builder
  .objectRef<LineageEntryNotFoundErrorShape>('LineageEntryNotFoundError')
  .implement({
    description: 'No lineage entry links this document id to this book.',
    interfaces: [userError],
    fields: () => ({}),
  });
