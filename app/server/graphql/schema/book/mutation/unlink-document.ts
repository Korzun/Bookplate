import { z } from 'zod';

import type { Owner } from '../../../../types';
import { builder } from '../../builder';
import {
  editLineageEntryError,
  model as editLineageEntryErrorModel,
} from '../../edit-lineage-entry-error/model';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import {
  lineageEntryNotFoundError,
  model as lineageEntryNotFoundErrorModel,
} from '../../lineage-entry-not-found-error/model';
import { model as user } from '../../user/model';
import { model as bookType } from '../model';

/**
 * Mirrors `DELETE /api/books/:id/link/:documentId` (`routes/ui.ts:897`) —
 * both `bookId` and `documentId` are REST path segments there, so neither is
 * trimmed here (an empty path segment can't reach REST in the first place;
 * see `inputSchema`'s doc comment for why this mutation still rejects one
 * explicitly).
 */
const input = builder.inputType('BookUnlinkDocumentInput', {
  fields: (t) => ({
    userId: t.globalID({ required: true, for: user }),
    bookId: t.string({ required: true }),
    documentId: t.string({ required: true }),
  }),
});

/**
 * `min(1)` on both, for the same reason `bookDelete`'s `bookId` gets it:
 * REST's path segments cannot structurally be empty, so this is the one
 * input REST never had to reject — this mutation rejects it explicitly
 * instead, since GraphQL has no equivalent route-matching floor.
 */
const inputSchema = z.object({
  bookId: z.string().min(1, 'bookId must not be empty'),
  documentId: z.string().min(1, 'documentId must not be empty'),
});

type BookUnlinkDocumentPayloadShape = {
  readonly __typename: 'BookUnlinkDocumentPayload';
  readonly owner: Owner;
  readonly bookId: string;
};

/**
 * `book` is a fresh lookup — see `BookLinkDocumentPayload`'s identical note.
 * Unlinking never renames the book, so `bookId` here is always the caller's
 * own `input.bookId`.
 */
const payload = builder
  .objectRef<BookUnlinkDocumentPayloadShape>('BookUnlinkDocumentPayload')
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
const result = builder.unionType('BookUnlinkDocumentResult', {
  types: [
    payload,
    invalidInputErrorModel,
    lineageEntryNotFoundErrorModel,
    editLineageEntryErrorModel,
  ],
});

/**
 * Mirrors `DELETE /api/books/:id/link/:documentId` (`routes/ui.ts:897-914`).
 * Owner resolution mirrors REST's `resolveOwner` — see `bookUpdateMetadata`'s
 * doc comment.
 *
 * `BookStore.unlinkDocument` is NOT wrapped in `toResult`: traced end to end
 * (`book-store.ts:616-637`), it never throws any of the seven known store
 * errors — it returns a plain `'deleted' | 'not_found' | 'edit_row'`
 * discriminator instead, which this resolver maps directly onto the result
 * union (`LineageEntryNotFoundError` / `EditLineageEntryError` — see those
 * files' doc comments for why they exist as honest, REST-mirrored members
 * rather than a reused error or a collapsed `null`). Wrapping a call that
 * raises none of the seven would make `toResult`'s `err` branch
 * undischargeable — see `to-result.ts`'s doc comment.
 *
 * REST's route itself has no separate book-existence check ahead of the
 * `unlinkDocument` call (traced: `routes/ui.ts:897-914` goes straight from
 * `resolveOwner` to `bookStore.unlinkDocument`), so this resolver doesn't add
 * one either — an unknown `bookId` simply yields no matching lineage row,
 * i.e. `'not_found'`, exactly like REST's own behaviour.
 */
builder.mutationField('bookUnlinkDocument', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Removes a manually-linked (merge) lineage entry from a book. Fails ' +
      'with LineageEntryNotFoundError when no such entry exists, and with ' +
      'EditLineageEntryError for an organic edit-history entry, which cannot ' +
      'be unlinked this way.',
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

      const outcome = await context.stores.book.unlinkDocument(
        owner,
        parsed.data.bookId,
        parsed.data.documentId
      );
      if (outcome === 'not_found') return lineageEntryNotFoundError();
      if (outcome === 'edit_row') return editLineageEntryError();

      return {
        __typename: 'BookUnlinkDocumentPayload' as const,
        owner,
        bookId: parsed.data.bookId,
      };
    },
  })
);
