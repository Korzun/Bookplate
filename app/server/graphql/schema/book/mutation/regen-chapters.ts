import { getBookById } from '../../../../services/book-catalog';
import { BookHashCollisionError } from '../../../../services/book-errors';
import { reimportBook } from '../../../../services/book-lifecycle';
import type { Book, Owner } from '../../../../types';
import { assertUnreachableDomainError, toResult } from '../../../to-result';
import {
  bookHashCollisionError,
  model as bookHashCollisionErrorModel,
} from '../../book-hash-collision-error/model';
import {
  bookNotValidatedError,
  model as bookNotValidatedErrorModel,
} from '../../book-not-validated-error/model';
import { builder } from '../../builder';
import { NO_MATCH_USER_ID, parseCompoundId } from '../../node-scope';
import { model as book } from '../model';

/**
 * The `Book` global ID IS the input — no separate `userId`/`bookId` pair.
 * Same shape as `bookValidate`'s `BookValidateInput` (see that file's doc
 * comment for the full rationale): the id's compound-key local part already
 * carries the owner, so decoding it at the resolver boundary yields both
 * halves the old two-argument shape used to require.
 */
const input = builder.inputType('BookRegenChaptersInput', {
  fields: (t) => ({
    id: t.globalID({ required: true, for: book }),
  }),
});

type BookRegenChaptersPayloadShape = {
  readonly __typename: 'BookRegenChaptersPayload';
  readonly owner: Owner;
  readonly bookId: string;
};

/**
 * `book` is a fresh `t.prismaField` lookup keyed by the owner + the post-
 * regen id `reimportBook` (`services/book-lifecycle.ts`) reported, exactly
 * like `BookUpdateMetadataPayload.book` (see that file's doc comment for why:
 * the `Book` DTO those service functions return doesn't match what
 * `book/model.ts`'s field resolvers expect off their parent). `reimportBook`
 * can change the book's id (its content-hash fingerprint is recomputed from
 * the re-parsed file), so this must re-read by the id that call actually
 * returned, never the input id.
 */
const payload = builder
  .objectRef<BookRegenChaptersPayloadShape>('BookRegenChaptersPayload')
  .implement({
    fields: (t) => ({
      book: t.prismaField({
        type: book,
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
 *
 * No `InvalidInputError` member: this mutation's only input, the `Book`
 * global ID, is validated entirely by the relay arg layer (malformed/wrong-
 * type rejection happens before the resolver runs, exactly like
 * `bookValidate` — see that file's field doc comment); there is no zod
 * schema left in this file to make that member reachable, so the traced-
 * union-drop rule (design doc's "Discovered consequence") requires dropping
 * it.
 */
const result = builder.unionType('BookRegenChaptersResult', {
  types: [payload, bookHashCollisionErrorModel, bookNotValidatedErrorModel],
});

/**
 * `reimportBook` returns `null` only when the file it needs has gone missing
 * from disk between the existence check above and this call — the same edge
 * case `replaceEpubBytes` guards with its own `throw new Error('Re-import
 * returned no book after replace')` (see that function's doc comment, and
 * `bookUpdateMetadata`'s note on it). It is not one of the seven known domain
 * errors, so it is not a `toResult`-discharged branch; REST's own fallback
 * here was an untyped 500 ("Failed to re-import book", `routes/ui.ts`, removed
 * in `e67b4ad9`). Mirrored the same way: a `throw` kept out of `resolve`'s own
 * body (per `assertUnreachableDomainError`'s precedent in `to-result.ts`), so
 * it still satisfies "resolver bodies: zero try/catch/throw" literally, while
 * reaching yoga's masking exactly like REST's 500 does.
 */
function assertReimportSucceeded(reimported: Book | null): asserts reimported is Book {
  if (reimported === null) throw new Error('Failed to re-import book');
}

/**
 * Mirrored REST's `POST /api/books/:id/regen-chapters` (`routes/ui.ts`, removed
 * in `e67b4ad9`). Owner resolution mirrors REST's `resolveOwner` — see
 * `bookUpdateMetadata`'s doc comment for the same `ownerOf`-scoped shape and
 * why REST's "admin without a target" 400 cannot occur here.
 *
 * Input is the `Book` global ID alone (design doc's 10-mutation input
 * collapse), decoded with the same `parseCompoundId`/`NO_MATCH_USER_ID`
 * convention `bookValidate` established — see that file's resolver doc
 * comment for the full malformed-id / wrong-type-id reasoning, which applies
 * here unchanged.
 *
 * REST's `book.valid !== true` precondition (409, "This book must pass
 * validation before it can be edited.") is checked before `reimportBook` is
 * ever called — mirrored here exactly like `bookUpdateMetadata` mirrors its
 * own identical gate: an honest, distinct `BookNotValidatedError` (not a
 * domain-error throw), reused as-is since the semantics genuinely match (same
 * message, same `book.valid !== true` test — see that type's doc comment for
 * why it isn't a reused `EpubValidationError`).
 *
 * `reimportBook` is traced end to end (`book-lifecycle.ts`): it throws
 * `BookHashCollisionError` when the re-parsed content's new fingerprint
 * collides with another book already in the library — the one known domain
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
    authScopes: (_parent, args) => {
      const parsed = parseCompoundId(args.input.id.id);
      return { ownerOf: parsed === null ? NO_MATCH_USER_ID : parsed[0] };
    },
    resolve: async (_parent, args, context) => {
      const parsed = parseCompoundId(args.input.id.id);
      if (parsed === null) return null; // admin passed scope on a malformed id: same "no such row" convention
      const [userId, bookId] = parsed;
      const owner = await context.loadOwner(userId);
      if (owner === null) return null;

      const targetBook = await getBookById(context.prisma, context.config.booksDir, owner, bookId);
      if (targetBook === null) return null;

      if (targetBook.valid !== true) {
        return bookNotValidatedError(owner, targetBook.id);
      }

      const outcome = await toResult<Book | null, BookHashCollisionError>(
        () =>
          reimportBook(
            context.prisma,
            context.config.booksDir,
            context.editionsRoot,
            owner,
            targetBook.id
          ),
        [BookHashCollisionError]
      );
      if ('err' in outcome) {
        if (outcome.err instanceof BookHashCollisionError) {
          return bookHashCollisionError(outcome.err, owner);
        }
        return assertUnreachableDomainError(outcome.err);
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
