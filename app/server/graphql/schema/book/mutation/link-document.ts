import { z } from 'zod';

import {
  DocumentAlreadyLinkedError,
  DocumentIsBookError,
  SelfLinkError,
} from '../../../../services/book-store';
import type { Owner } from '../../../../types';
import { assertUnreachableStoreError, toResult } from '../../../to-result';
import { builder } from '../../builder';
import {
  documentAlreadyLinkedError,
  model as documentAlreadyLinkedErrorModel,
} from '../../document-already-linked-error/model';
import {
  documentIsBookError,
  model as documentIsBookErrorModel,
} from '../../document-is-book-error/model';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { model as selfLinkErrorModel, selfLinkError } from '../../self-link-error/model';
import { model as user } from '../../user/model';
import { model as bookType } from '../model';

/**
 * `bookId` is the raw content-hash id, `documentId` the KOReader document id
 * to merge into its lineage — mirrors `POST /api/books/:id/link`
 * (`routes/ui.ts:861`), whose body is `{ documentId: string }`. `userId`
 * follows the same `ownerOf`-scoped shape every other book mutation in this
 * file uses (see `bookUpdateMetadata`'s doc comment).
 */
const input = builder.inputType('BookLinkDocumentInput', {
  fields: (t) => ({
    userId: t.globalID({ required: true, for: user }),
    bookId: t.string({ required: true }),
    documentId: t.string({ required: true }),
  }),
});

/**
 * `bookId.min(1)` mirrors `bookDelete`/`bookUpdateMetadata`'s identical rule
 * (empty path segments can't reach REST; this mutation rejects them
 * explicitly instead — see those files' doc comments).
 *
 * `documentId` is trimmed and rejected when blank, mirroring REST's own
 * check byte-for-byte: `typeof documentId !== 'string' || !documentId.trim()`
 * → 400 `{ error: 'documentId is required' }` (`routes/ui.ts:867-871`). The
 * TRIMMED value is what gets passed to the store below, exactly like REST
 * passes `documentId.trim()` to `linkDocument`.
 */
const inputSchema = z.object({
  bookId: z.string().min(1, 'bookId must not be empty'),
  documentId: z.string().trim().min(1, 'documentId must not be empty'),
});

type BookLinkDocumentPayloadShape = {
  readonly __typename: 'BookLinkDocumentPayload';
  readonly owner: Owner;
  readonly bookId: string;
};

/**
 * `book` is a fresh lookup, not a store-returned DTO — same reasoning as
 * `BookUpdateMetadataPayload.book` (`update-metadata.ts`'s doc comment):
 * `linkDocument` returns a bare `true`, not a `Book`, and `Book`'s field
 * resolvers need the raw Prisma row anyway. Linking never renames the book
 * (unlike an edit), so `bookId` here is always the caller's own `input.bookId`.
 */
const payload = builder
  .objectRef<BookLinkDocumentPayloadShape>('BookLinkDocumentPayload')
  .implement({
    fields: (t) => ({
      book: t.prismaField({
        type: bookType,
        resolve: (query, parent, _args, context) =>
          context.prisma.book.findUniqueOrThrow({
            ...query,
            where: { userId_id: { userId: parent.owner.userId, id: parent.bookId } },
          }),
      }),
    }),
  });

/**
 * No `resolveType`: every member value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 */
const result = builder.unionType('BookLinkDocumentResult', {
  types: [
    payload,
    invalidInputErrorModel,
    selfLinkErrorModel,
    documentAlreadyLinkedErrorModel,
    documentIsBookErrorModel,
  ],
});

/**
 * Mirrors `POST /api/books/:id/link` (`routes/ui.ts:861`). Owner resolution
 * mirrors REST's `resolveOwner` — see `bookUpdateMetadata`'s doc comment.
 *
 * `BookStore.linkDocument` throws exactly three of the seven known store
 * errors, traced end to end (`book-store.ts:560-614`): `SelfLinkError`
 * (`documentId === bookId`, checked before anything else — including book
 * existence, so a self-link on a book that doesn't even exist still yields
 * `SelfLinkError`, matching the store's own check order literally rather
 * than re-ordering it), `DocumentAlreadyLinkedError` and `DocumentIsBookError`
 * (both checked inside the transaction, after the book-existence check).
 * `expected` declares exactly these three — nothing else in `linkDocument`'s
 * body throws.
 *
 * REST 404 (book not found) is modelled as `null`, the same "no such row"
 * convention every other book mutation in this schema uses — `linkDocument`
 * itself returns `null` for that case (`Promise<true | null>`), so the
 * resolver just forwards it rather than adding a second check.
 */
builder.mutationField('bookLinkDocument', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Merges a KOReader document id into a book’s lineage. Resolves to null ' +
      'when the book does not exist for the resolved owner.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: (_parent, args) => ({ ownerOf: args.input.userId.id }),
    resolve: async (_parent, args, context) => {
      const parsed = inputSchema.safeParse({
        bookId: args.input.bookId,
        documentId: args.input.documentId,
      });
      if (!parsed.success) return invalidInputError(parsed.error);

      const userId = args.input.userId.id;
      const owner = await context.loadOwner(userId);
      if (owner === null) return null;

      const outcome = await toResult<
        true | null,
        SelfLinkError | DocumentAlreadyLinkedError | DocumentIsBookError
      >(
        () => context.stores.book.linkDocument(owner, parsed.data.bookId, parsed.data.documentId),
        [SelfLinkError, DocumentAlreadyLinkedError, DocumentIsBookError]
      );
      if ('err' in outcome) {
        if (outcome.err instanceof SelfLinkError) return selfLinkError(outcome.err);
        if (outcome.err instanceof DocumentAlreadyLinkedError) {
          return documentAlreadyLinkedError(outcome.err, owner);
        }
        if (outcome.err instanceof DocumentIsBookError) {
          return documentIsBookError(outcome.err, owner);
        }
        return assertUnreachableStoreError(outcome.err);
      }
      if (outcome.ok === null) return null;

      return {
        __typename: 'BookLinkDocumentPayload' as const,
        owner,
        bookId: parsed.data.bookId,
      };
    },
  })
);
