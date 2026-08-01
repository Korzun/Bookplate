import { z } from 'zod';

import { BookHashCollisionError } from '../../../../services/book-store';
import type { Book, Owner } from '../../../../types';
import { assertUnreachableStoreError, toResult } from '../../../to-result';
import {
  bookHashCollisionError,
  model as bookHashCollisionErrorModel,
} from '../../book-hash-collision-error/model';
import {
  bookNotValidatedError,
  model as bookNotValidatedErrorModel,
} from '../../book-not-validated-error/model';
import { builder } from '../../builder';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { model as user } from '../../user/model';
import { model as bookType } from '../model';

/**
 * `bookId` is the raw content-hash id, not a `Book` global ID — same reason
 * as `bookUpdateMetadataInput.bookId` (see that file's doc comment).
 */
const input = builder.inputType('BookRegenChaptersInput', {
  fields: (t) => ({
    userId: t.globalID({ required: true, for: user }),
    bookId: t.string({ required: true }),
  }),
});

const inputSchema = z.object({
  bookId: z.string().min(1, 'bookId must not be empty'),
});

type BookRegenChaptersPayloadShape = {
  readonly __typename: 'BookRegenChaptersPayload';
  readonly owner: Owner;
  readonly bookId: string;
};

/**
 * `book` is a fresh `t.prismaField` lookup keyed by the owner + the post-
 * regen id the store call reported, exactly like `BookUpdateMetadataPayload.
 * book` (see that file's doc comment for why: the store's `Book` DTO doesn't
 * match what `book/model.ts`'s field resolvers expect off their parent).
 * `reimportBook` can change the book's id (its content-hash fingerprint is
 * recomputed from the re-parsed file), so this must re-read by the id the
 * store call actually returned, never `input.bookId`.
 */
const payload = builder
  .objectRef<BookRegenChaptersPayloadShape>('BookRegenChaptersPayload')
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
const result = builder.unionType('BookRegenChaptersResult', {
  types: [payload, bookHashCollisionErrorModel, bookNotValidatedErrorModel, invalidInputErrorModel],
});

/**
 * `reimportBook` returns `null` only when the file it needs has gone missing
 * from disk between the existence check above and this call — the same edge
 * case `replaceEpubBytes` guards with its own `throw new Error('Re-import
 * returned no book after replace')` (see that function's doc comment, and
 * `bookUpdateMetadata`'s note on it). It is not one of the seven known store
 * errors, so it is not a `toResult`-discharged branch; REST's own fallback
 * here is an untyped 500 ("Failed to re-import book", `routes/ui.ts:1285`).
 * Mirrored the same way: a `throw` kept out of `resolve`'s own body (per
 * `assertUnreachableStoreError`'s precedent in `to-result.ts`), so it still
 * satisfies "resolver bodies: zero try/catch/throw" literally, while
 * reaching yoga's masking exactly like REST's 500 does.
 */
function assertReimportSucceeded(reimported: Book | null): asserts reimported is Book {
  if (reimported === null) throw new Error('Failed to re-import book');
}

/**
 * Mirrors `POST /api/books/:id/regen-chapters` (`routes/ui.ts:1255`). Owner
 * resolution mirrors REST's `resolveOwner` — see `bookUpdateMetadata`'s doc
 * comment for the same `ownerOf`-scoped shape and why REST's "admin without a
 * target" 400 cannot occur here.
 *
 * REST's `book.valid !== true` precondition (409, "This book must pass
 * validation before it can be edited.") is checked before `reimportBook` is
 * ever called — mirrored here exactly like `bookUpdateMetadata` mirrors its
 * own identical gate: an honest, distinct `BookNotValidatedError` (not a
 * store throw), reused as-is since the semantics genuinely match (same
 * message, same `book.valid !== true` test — see that type's doc comment for
 * why it isn't a reused `EpubValidationError`).
 *
 * `BookStore.reimportBook` is traced end to end (`book-store.ts`): it throws
 * `BookHashCollisionError` when the re-parsed content's new fingerprint
 * collides with another book already in the library — the one known store
 * error this path can raise. `expected` below is scoped to exactly that,
 * matching `bookUpdateMetadata`'s narrower-than-all-seven pattern.
 */
builder.mutationField('bookRegenChapters', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Re-parses a book’s EPUB file to regenerate its chapter list. Resolves ' +
      'to null when the book does not exist for the resolved owner.',
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

      if (targetBook.valid !== true) {
        return bookNotValidatedError(owner, targetBook.id);
      }

      const outcome = await toResult<Book | null, BookHashCollisionError>(
        () => context.stores.book.reimportBook(owner, targetBook.id),
        [BookHashCollisionError]
      );
      if ('err' in outcome) {
        if (outcome.err instanceof BookHashCollisionError) {
          return bookHashCollisionError(outcome.err, owner);
        }
        return assertUnreachableStoreError(outcome.err);
      }

      assertReimportSucceeded(outcome.ok);

      return {
        __typename: 'BookRegenChaptersPayload' as const,
        owner,
        bookId: outcome.ok.id,
      };
    },
  })
);
