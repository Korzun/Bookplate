import type { DocumentIsBookError as StoreError } from '../../../services/book-errors';
import type { Owner } from '../../../types';
// `../book/model`, not `../book`: see `book-hash-collision-error/model.ts`'s
// note — `book/index.ts` now also side-effect-imports `book/mutation/*.ts`
// (task 2).
import { model as book } from '../book/model';
import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * `DocumentIsBookError(documentId)` — the id the caller tried to link is
 * itself a book in this library (`book-store.ts:576-580`), so `book` is
 * simply that book, looked up by the id the error carries under the owner the
 * mutation was acting for.
 */
export type DocumentIsBookErrorShape = {
  readonly __typename: 'DocumentIsBookError';
  readonly message: string;
  readonly owner: Owner;
  readonly documentId: string;
};

export const documentIsBookError = (error: StoreError, owner: Owner): DocumentIsBookErrorShape => ({
  __typename: 'DocumentIsBookError',
  message: error.message,
  owner,
  documentId: error.documentId,
});

export const model = builder.objectRef<DocumentIsBookErrorShape>('DocumentIsBookError').implement({
  description: 'This document id is an existing book — link through that book’s lineage instead.',
  interfaces: [userError],
  fields: (t) => ({
    book: t.prismaField({
      type: book,
      resolve: (query, parent, _args, context) =>
        context.prisma.book.findUniqueOrThrow({
          ...query,
          where: { userId_id: { userId: parent.owner.userId, id: parent.documentId } },
        }),
    }),
  }),
});
