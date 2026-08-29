import { getBookById } from '../../../../services/book-catalog';
import { revalidateBook } from '../../../../services/revalidate-library';
import type { Owner } from '../../../../types';
import { builder } from '../../builder';
import { NO_MATCH_USER_ID, parseCompoundId } from '../../node-scope';
import { model as validation } from '../../validation/model';
import { model as book } from '../model';

/**
 * The `Book` global ID IS the input — no separate `userId` arg. The id's
 * compound-key local part (`node-scope.ts`'s `parseCompoundId` doc comment)
 * already carries the owner, so decoding it at the resolver boundary yields
 * both halves the old two-argument shape used to require: `{userId, bookId}`.
 */
const input = builder.inputType('BookValidateInput', {
  fields: (t) => ({
    id: t.globalID({ required: true, for: book }),
  }),
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
 * DTO/report the underlying write produced (see those files' doc comments):
 * `Validation`'s GraphQL type has a real `messages` connection
 * (`validation/model.ts`) that a plain report object has no relation to
 * satisfy. `findUniqueOrThrow` is safe: `revalidateBook` just persisted this
 * exact row, in the same request, before this payload is built.
 *
 * `book` (design doc §1, schema-design review S1 — the near-blocker: this was
 * the one payload in the schema returning an object the cache was
 * structurally incapable of placing, since `Validation` had no cache key at
 * all before this same task added `Validation.id`). Fresh `t.prismaField`
 * lookup, exactly `BookUpdateMetadataPayload.book`'s shape
 * (`update-metadata.ts`) copied verbatim: `findUniqueOrThrow` keyed on
 * `owner.userId` + `bookId`, both already in hand on this payload's own
 * shape — no new query, no new data the resolver didn't already have.
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
 * Single-member union, not a bare payload type: additive-safe if a future
 * error case needs a member (spec 1's single-member-union precedent). No
 * `InvalidInputError` member — this mutation's only input, the `Book` global
 * ID, is validated entirely by the relay arg layer (malformed/wrong-type
 * rejection happens before the resolver runs — see the field doc comment
 * below); there is no zod schema left in this file to make that member
 * reachable, so the traced-union-drop rule (design doc's "Discovered
 * consequence") requires dropping it.
 *
 * No `resolveType`: the one member value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 */
const result = builder.unionType('BookValidateResult', {
  types: [payload],
});

/**
 * Mirrors `POST /api/books/:id/validate` (`routes/ui.ts:1295`). Owner
 * resolution mirrors REST's `resolveOwner` — see `bookUpdateMetadata`'s doc
 * comment for the same `ownerOf`-scoped shape and why REST's "admin without a
 * target" 400 cannot occur here.
 *
 * Input is the `Book` global ID alone (design doc's 10-mutation input
 * collapse): `args.input.id.id` is the compound local id Pothos's own
 * serializer produced for a `prismaNode('Book', { id: { field: 'userId_id' } })`
 * registration, decoded here with the same `parseCompoundId` `node-scope.ts`
 * uses for read paths, rather than trusting a caller-supplied `userId` arg
 * the old shape took separately. `authScopes` runs `ownerOf` on the decoded
 * userId — bob passing alice's id is FORBIDDEN, admin passing it is allowed,
 * exactly as the two-argument shape behaved. A malformed local id (decode
 * failure) maps to `NO_MATCH_USER_ID`: non-admin gets FORBIDDEN (no owner to
 * compare against, so no other reading), admin's `ownerOf` check still passes
 * (isOwnerOrAdmin short-circuits on `isAdmin`) and falls through to the
 * resolver, which re-decodes, gets `null`, and returns the resolver's own
 * `null` — same "no such row" convention a well-formed id naming no book
 * already uses; there is nothing to look up for an id that doesn't parse, so
 * treating it as not-found rather than a distinct error is the only reading
 * that doesn't leak more than a genuinely-missing book does.
 *
 * A wrong-type global id (e.g. a `Series` id passed here) never reaches
 * `authScopes` or the resolver at all: `t.globalID({ for: book })` decodes
 * and typename-checks the id in Pothos's relay plugin, outside
 * `ScopeAuthPlugin`'s wrapper (`root-auth.test.ts`'s describe-block doc
 * comment traces the plugin order), so it top-level-errors before either one
 * runs — confirmed for a `Book`-scoped arg specifically by this file's own
 * "rejects a wrong-type global id" test, not assumed from the `libraryId`
 * precedent alone.
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

      await revalidateBook(
        {
          prisma: context.prisma,
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
