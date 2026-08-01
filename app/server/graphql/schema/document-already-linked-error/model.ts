import type { DocumentAlreadyLinkedError as StoreError } from '../../../services/book-store';
import type { Owner } from '../../../types';
import { model as book } from '../book';
import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * `DocumentAlreadyLinkedError(documentId)` — the KOReader document id the
 * caller tried to link already appears in this library's id history.
 *
 * `book` is the book it is already linked to. Resolved through
 * `BookStore.resolveBookId`, the store's own answer to "which live book does
 * this id resolve to", rather than a second reading of `book_id_history` here:
 * `linkDocument`/`reimportBook` flatten those chains (`book-store.ts:907-913`)
 * and `resolveBookId` also covers the device-edition case, so re-deriving the
 * mapping in the schema would be a copy that can drift.
 */
export type DocumentAlreadyLinkedErrorShape = {
  readonly __typename: 'DocumentAlreadyLinkedError';
  readonly message: string;
  readonly owner: Owner;
  readonly documentId: string;
};

export const documentAlreadyLinkedError = (
  error: StoreError,
  owner: Owner
): DocumentAlreadyLinkedErrorShape => ({
  __typename: 'DocumentAlreadyLinkedError',
  message: error.message,
  owner,
  documentId: error.documentId,
});

export const model = builder
  .objectRef<DocumentAlreadyLinkedErrorShape>('DocumentAlreadyLinkedError')
  .implement({
    description: 'This document id is already part of another book’s lineage.',
    interfaces: [userError],
    fields: (t) => ({
      documentId: t.exposeString('documentId'),
      book: t.prismaField({
        type: book,
        resolve: async (query, parent, _args, context) =>
          context.prisma.book.findUniqueOrThrow({
            ...query,
            where: {
              userId_id: {
                userId: parent.owner.userId,
                id: await context.stores.book.resolveBookId(parent.owner.userId, parent.documentId),
              },
            },
          }),
      }),
    }),
  });
