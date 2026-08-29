import type { DocumentAlreadyLinkedError as DomainError } from '../../../services/book-errors';
import { resolveBookId } from '../../../services/book-lineage';
import type { Owner } from '../../../types';
// `../book/model`, not `../book`: `book/index.ts` now also side-effect-imports
// `book/mutation/*.ts` (task 2). Not currently reached from those files, but
// importing the defining module rather than the index keeps this from
// becoming a latent cycle the moment something under `book/mutation/` needs
// this error type too. See `book-hash-collision-error/model.ts` for the case
// that is currently reached.
import { model as book } from '../book/model';
import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * `DocumentAlreadyLinkedError(documentId)` — the KOReader document id the
 * caller tried to link already appears in this library's id history.
 *
 * `book` is the book it is already linked to. Resolved through the imported
 * `resolveBookId` (`services/book-lineage.ts`), that module's own answer to
 * "which live book does this id resolve to", rather than a second reading of
 * `book_id_history` here: `linkDocument` (`services/book-lineage.ts`) and
 * `reimportBook` (`services/book-lifecycle.ts`) flatten those chains, and
 * `resolveBookId` also covers the device-edition case, so re-deriving the
 * mapping in the schema would be a copy that can drift.
 */
export type DocumentAlreadyLinkedErrorShape = {
  readonly __typename: 'DocumentAlreadyLinkedError';
  readonly message: string;
  readonly owner: Owner;
  readonly documentId: string;
};

export const documentAlreadyLinkedError = (
  error: DomainError,
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
                id: await resolveBookId(context.prisma, parent.owner.userId, parent.documentId),
              },
            },
          }),
      }),
    }),
  });
