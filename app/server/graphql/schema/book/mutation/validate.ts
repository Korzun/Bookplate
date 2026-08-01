import { z } from 'zod';

import { revalidateBook } from '../../../../services/revalidate-library';
import type { Owner } from '../../../../types';
import { builder } from '../../builder';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { model as user } from '../../user/model';
import { model as validation } from '../../validation/model';

/**
 * `bookId` is the raw content-hash id, not a `Book` global ID — same reason
 * as `bookUpdateMetadataInput.bookId` (see that file's doc comment).
 */
const input = builder.inputType('BookValidateInput', {
  fields: (t) => ({
    userId: t.globalID({ required: true, for: user }),
    bookId: t.string({ required: true }),
  }),
});

const inputSchema = z.object({
  bookId: z.string().min(1, 'bookId must not be empty'),
});

type BookValidatePayloadShape = {
  readonly __typename: 'BookValidatePayload';
  readonly owner: Owner;
  readonly bookId: string;
};

/**
 * `validation` is a fresh `t.prismaField` lookup, not the `ValidationReport`
 * `revalidateBook` returns — same reason `BookUpdateMetadataPayload.book` and
 * `BookHashCollisionError.collidingBook` are fresh lookups rather than the
 * DTO/report the store call produced (see those files' doc comments):
 * `Validation`'s GraphQL type has a real `messages` connection
 * (`validation/model.ts`) that a plain report object has no relation to
 * satisfy. `findUniqueOrThrow` is safe: `revalidateBook` just persisted this
 * exact row, in the same request, before this payload is built.
 */
const payload = builder.objectRef<BookValidatePayloadShape>('BookValidatePayload').implement({
  fields: (t) => ({
    validation: t.prismaField({
      type: validation,
      resolve: (query, parent, _args, context) =>
        context.prisma.validation.findUniqueOrThrow({
          ...query,
          where: { userId_bookId: { userId: parent.owner.userId, bookId: parent.bookId } },
        }),
    }),
  }),
});

/**
 * No `resolveType`: every member value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 */
const result = builder.unionType('BookValidateResult', {
  types: [payload, invalidInputErrorModel],
});

/**
 * Mirrors `POST /api/books/:id/validate` (`routes/ui.ts:1295`). Owner
 * resolution mirrors REST's `resolveOwner` — see `bookUpdateMetadata`'s doc
 * comment for the same `ownerOf`-scoped shape and why REST's "admin without a
 * target" 400 cannot occur here.
 *
 * `revalidateBook` (`services/revalidate-library.ts`) is NOT wrapped in
 * `toResult`: traced end to end, it throws only by letting
 * `fs.readFileSync(book.path)` escape when the on-disk file is missing — not
 * one of the seven known store errors. Wrapping it would make the `err`
 * branch unreachable and undischargeable except by throwing or mislabelling
 * — the same rule `bookDelete`'s doc comment already explains for
 * `BookStore.deleteBook`. That failure (and any other unexpected one) reaches
 * yoga's masking, same as REST's fallback 500 for the same read failure
 * (REST has no try/catch around this call either).
 *
 * REST 404 (book not found) is modelled as `null`, the same "no such row"
 * convention `progressDelete` established, not a typed error. Unlike
 * `bookUpdateMetadata`/`bookRegenChapters`, REST's `validate` route has no
 * `book.valid !== true` precondition — re-validating is exactly how a book
 * ever becomes valid in the first place, so gating it on validity would make
 * that impossible. A book that fails validation is not an error here: REST
 * returns 200 with `valid: false` in the body, and this mutation does the
 * same by returning a normal `BookValidatePayload` whose `validation.valid`
 * is `false`.
 */
builder.mutationField('bookValidate', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Re-validates a book against the EPUB checker and persists the report. ' +
      'Resolves to null when the book does not exist for the resolved owner.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: (_parent, args) => ({ ownerOf: args.input.userId.id }),
    resolve: async (_parent, args, context) => {
      const parsed = inputSchema.safeParse({ bookId: args.input.bookId });
      if (!parsed.success) return invalidInputError(parsed.error);

      const userId = args.input.userId.id;
      const owner = await context.loadOwner(userId);
      if (owner === null) return null;

      const targetBook = await context.stores.book.getBookById(owner, parsed.data.bookId);
      if (targetBook === null) return null;

      await revalidateBook(
        {
          validationStore: context.stores.validation,
          validationThreshold: context.config.validationThreshold,
        },
        owner,
        targetBook
      );

      return {
        __typename: 'BookValidatePayload' as const,
        owner,
        bookId: targetBook.id,
      };
    },
  })
);
