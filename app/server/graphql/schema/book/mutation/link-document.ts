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
import { NO_MATCH_USER_ID, parseCompoundId } from '../../node-scope';
import { model as selfLinkErrorModel, selfLinkError } from '../../self-link-error/model';
import { model as bookType } from '../model';

/**
 * `documentId` is the KOReader document id to merge into the book's lineage
 * — mirrors `POST /api/books/:id/link` (`routes/ui.ts:861`), whose body is
 * `{ documentId: string }`. The `Book` global ID IS the input's `id` field —
 * no separate `userId`/`bookId` pair. Same shape as `bookValidate`'s
 * `BookValidateInput` (see that file's doc comment for the full rationale):
 * the id's compound-key local part already carries the owner, so decoding it
 * at the resolver boundary yields both halves the old two-argument shape
 * used to require. `documentId` stays a raw string, not a `Book`-scoped or
 * global id: it names a KOReader document, which has no `Node` type of its
 * own in this schema.
 */
const input = builder.inputType('BookLinkDocumentInput', {
  fields: (t) => ({
    id: t.globalID({ required: true, for: bookType }),
    documentId: t.string({ required: true }),
  }),
});

/**
 * `documentId` is trimmed and rejected when blank, mirroring REST's own
 * check byte-for-byte: `typeof documentId !== 'string' || !documentId.trim()`
 * → 400 `{ error: 'documentId is required' }` (`routes/ui.ts:867-871`). The
 * TRIMMED value is what gets passed to the store below, exactly like REST
 * passes `documentId.trim()` to `linkDocument`. `bookId` has no zod rule
 * here any more — it is no longer a plain string field at all, having been
 * absorbed into the `id` global ID's compound-key local part
 * (`InvalidInputError` for an empty `bookId` is unreachable now the same way
 * it became unreachable for `bookDelete`'s identical field in task 2: an id
 * that doesn't parse is the `parsed === null` early return below, not a zod
 * issue).
 */
const inputSchema = z.object({
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
 * (unlike an edit), so `bookId` here is always the decoded `id`'s local part.
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
 * Mirrors `POST /api/books/:id/link` (`routes/ui.ts:861`). Input is the
 * `Book` global ID alone plus `documentId` (design doc's 10-mutation input
 * collapse), decoded with the same `parseCompoundId`/`NO_MATCH_USER_ID`
 * convention `bookValidate` established — see that file's resolver doc
 * comment for the full malformed-id / wrong-type-id reasoning, which applies
 * here unchanged. `authScopes` runs `ownerOf` on the decoded userId, the
 * same way REST's `resolveOwner` lets a regular viewer act only on their own
 * library and an admin target any.
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
    authScopes: (_parent, args) => {
      const parsed = parseCompoundId(args.input.id.id);
      return { ownerOf: parsed === null ? NO_MATCH_USER_ID : parsed[0] };
    },
    resolve: async (_parent, args, context) => {
      const parsed = parseCompoundId(args.input.id.id);
      if (parsed === null) return null; // admin passed scope on a malformed id: same "no such row" convention
      const [userId, bookId] = parsed;

      const parsedInput = inputSchema.safeParse({ documentId: args.input.documentId });
      if (!parsedInput.success) return invalidInputError(parsedInput.error);

      const owner = await context.loadOwner(userId);
      if (owner === null) return null;

      const outcome = await toResult<
        true | null,
        SelfLinkError | DocumentAlreadyLinkedError | DocumentIsBookError
      >(
        () => context.stores.book.linkDocument(owner, bookId, parsedInput.data.documentId),
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
        bookId,
      };
    },
  })
);
