import type { Owner } from '../../../types';
import { builder } from '../builder';
import { model as userError } from '../user-error';
import { model as validation } from '../validation/model';

/**
 * REST's `book.valid !== true` gate (`routes/ui.ts:1127-1132`, `PATCH
 * /api/books/:id/metadata`'s 409 "This book must pass validation before it
 * can be edited.") — a route-level precondition checked *before*
 * `applyEpubChanges` is ever called, not a store throw. See
 * `book/mutation/update-metadata.ts`'s doc comment for the full trace of why
 * this exists and how it differs from a genuine post-edit `EpubValidationError`.
 *
 * `validation` carries the book's stored `Validation` row when one exists
 * (`valid: false`, real epubcheck findings a client can render) and `null`
 * when the book has never been validated at all (`valid === null`, no row).
 * Deliberately NOT a reused `EpubValidationError` built from placeholder
 * arguments for the never-validated case: a book that was never validated has
 * not "failed validation" in any sense a client should be told happened, and
 * `EpubValidationError`'s own `message` (`EPUB failed validation (threshold
 * X): …`) would assert exactly that falsehood. This type says the true thing
 * instead — see task-2's review, Adjudication 2, for the full reasoning
 * behind replacing the earlier reuse.
 *
 * `t.prismaField`, resolved by a fresh lookup rather than carrying the
 * `StoredValidation` DTO `ValidationStore.getValidation` returns: same reason
 * `BookHashCollisionError.collidingBook` and `BookUpdateMetadataPayload.book`
 * are fresh lookups rather than DTOs — `Validation`'s GraphQL type
 * (`validation/model.ts`) is Prisma-row-backed (its `messages` field is a
 * real `t.relatedConnection`), and the DTO's already-parsed `messages` array
 * has no relation to merge a connection query against.
 */
export type BookNotValidatedErrorShape = {
  readonly __typename: 'BookNotValidatedError';
  readonly message: string;
  readonly owner: Owner;
  readonly bookId: string;
};

export const bookNotValidatedError = (
  owner: Owner,
  bookId: string
): BookNotValidatedErrorShape => ({
  __typename: 'BookNotValidatedError',
  message: 'This book must pass validation before it can be edited.',
  owner,
  bookId,
});

export const model = builder
  .objectRef<BookNotValidatedErrorShape>('BookNotValidatedError')
  .implement({
    description:
      'The book has not passed validation (or has never been validated), so ' +
      'its metadata cannot be edited until that is resolved.',
    interfaces: [userError],
    fields: (t) => ({
      validation: t.prismaField({
        type: validation,
        nullable: true,
        resolve: (query, parent, _args, context) =>
          context.prisma.validation.findUnique({
            ...query,
            where: { userId_bookId: { userId: parent.owner.userId, bookId: parent.bookId } },
          }),
      }),
    }),
  });
