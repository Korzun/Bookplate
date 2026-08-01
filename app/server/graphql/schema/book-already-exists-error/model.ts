import type { BookAlreadyExistsError as StoreError } from '../../../services/book-store';
import type { Owner } from '../../../types';
import { model as book } from '../book';
import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * `BookAlreadyExistsError(existingId)`, upgraded from an id into the `Book`
 * that already occupies it. Carries its own `owner` for the same reason
 * `BookHashCollisionError` does — see that file's doc comment.
 */
export type BookAlreadyExistsErrorShape = {
  readonly __typename: 'BookAlreadyExistsError';
  readonly message: string;
  readonly owner: Owner;
  readonly existingId: string;
};

export const bookAlreadyExistsError = (
  error: StoreError,
  owner: Owner
): BookAlreadyExistsErrorShape => ({
  __typename: 'BookAlreadyExistsError',
  message: error.message,
  owner,
  existingId: error.existingId,
});

export const model = builder
  .objectRef<BookAlreadyExistsErrorShape>('BookAlreadyExistsError')
  .implement({
    description: 'A book with this id is already in the library.',
    interfaces: [userError],
    fields: (t) => ({
      existingBook: t.prismaField({
        type: book,
        resolve: (query, parent, _args, context) =>
          context.prisma.book.findUniqueOrThrow({
            ...query,
            where: { userId_id: { userId: parent.owner.userId, id: parent.existingId } },
          }),
      }),
    }),
  });
