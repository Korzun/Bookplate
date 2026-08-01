import type { BookHashCollisionError as StoreError } from '../../../services/book-store';
import type { Owner } from '../../../types';
import { model as book } from '../book';
import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * The store throws `BookHashCollisionError(collidingId)` — an id and nothing
 * more. The graph upgrades it into the colliding `Book` itself (spec, §"Error
 * model": "so the UI can render 'this matches *Dune*' with a working link
 * instead of refetching to turn an id into a title").
 *
 * That upgrade needs an owner, and book ids are partial MD5s of file content,
 * so two users legitimately hold the same id for the same EPUB. The owner is
 * therefore carried on the error *value*, taken from the mutation that raised
 * it, and never re-derived from the viewer here — re-deriving would resolve
 * the viewer's own copy of an identically-hashed book and look perfectly
 * correct in every single-tenant test (spec, §"a self-read cannot discriminate
 * owner-derivation").
 */
export type BookHashCollisionErrorShape = {
  readonly __typename: 'BookHashCollisionError';
  readonly message: string;
  readonly owner: Owner;
  readonly collidingId: string;
};

export const bookHashCollisionError = (
  error: StoreError,
  owner: Owner
): BookHashCollisionErrorShape => ({
  __typename: 'BookHashCollisionError',
  message: error.message,
  owner,
  collidingId: error.collidingId,
});

export const model = builder
  .objectRef<BookHashCollisionErrorShape>('BookHashCollisionError')
  .implement({
    description: 'The edited content hashes to a book that already exists in this library.',
    interfaces: [userError],
    fields: (t) => ({
      collidingBook: t.prismaField({
        type: book,
        resolve: (query, parent, _args, context) =>
          context.prisma.book.findUniqueOrThrow({
            ...query,
            where: { userId_id: { userId: parent.owner.userId, id: parent.collidingId } },
          }),
      }),
    }),
  });
