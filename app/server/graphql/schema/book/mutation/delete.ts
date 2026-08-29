import { encodeGlobalID } from '@pothos/plugin-relay';

import { deleteBook } from '../../../../services/book-lifecycle';
import type { Owner } from '../../../../types';
import { builder } from '../../builder';
import { model as library } from '../../library/model';
import { NO_MATCH_USER_ID, parseCompoundId } from '../../node-scope';
import { model as book } from '../model';

/**
 * The `Book` global ID IS the input — no separate `userId`/`bookId` pair.
 * Same shape as `bookValidate`'s `BookValidateInput` (see that file's doc
 * comment for the full rationale): the id's compound-key local part already
 * carries the owner, so decoding it at the resolver boundary yields both
 * halves the old two-argument shape used to require.
 */
const input = builder.inputType('BookDeleteInput', {
  fields: (t) => ({
    id: t.globalID({ required: true, for: book }),
  }),
});

type BookDeletePayloadShape = {
  readonly __typename: 'BookDeletePayload';
  readonly deletedId: string;
  readonly owner: Owner;
};

/**
 * `deletedBookId: String!` is gone (spec output-removal #2, task 2) — it
 * duplicated `deletedId` for no reason once the input itself became the
 * `Book` global ID: any caller that already had a `deletedId`-shaped id to
 * pass in can decode `deletedId` back out the same way. `deletedId: ID!`
 * alone stays, per the ledger's "deletes return `deletedId: ID!`" rule — no
 * exception to it remains in this schema; `progressDelete` used to be one
 * (`deletedDocument`, for the non-`Node` `Progress` type) but was collapsed
 * to `deletedId` too once `Progress` itself gained a computed global ID (see
 * that file's own payload doc comment). Computed the same way the schema
 * itself computes it for a still-live row — `encodeGlobalID('Book',
 * JSON.stringify([owner.userId, id]))`, matching `node-scope.ts`'s
 * `parseCompoundId` doc comment on Pothos's own compound-id serializer — and
 * costs nothing extra: both halves of the compound key are already in hand
 * from the resolver's own decode.
 */
const payload = builder.objectRef<BookDeletePayloadShape>('BookDeletePayload').implement({
  fields: (t) => ({
    deletedId: t.exposeID('deletedId'),
    library: t.field({ type: library, resolve: (result) => result.owner }),
  }),
});

/**
 * Single-member union, not a bare payload type: additive-safe if a future
 * error case needs a member (spec 1's single-member-union precedent). No
 * `InvalidInputError` member — this mutation's only input, the `Book` global
 * ID, is validated entirely by the relay arg layer (malformed/wrong-type
 * rejection happens before the resolver runs, exactly like `bookValidate` —
 * see that file's field doc comment); there is no zod schema left in this
 * file to make that member reachable, so the traced-union-drop rule (design
 * doc's "Discovered consequence") requires dropping it.
 *
 * No `resolveType`: the one member value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 */
const result = builder.unionType('BookDeleteResult', {
  types: [payload],
});

/**
 * Mirrors `DELETE /api/books/:id` (`routes/ui.ts:1021`). Owner resolution
 * mirrors REST's `resolveOwner` — see `bookUpdateMetadata`'s doc comment for
 * the same `ownerOf`-scoped shape and why REST's "admin without a target" 400
 * cannot occur here.
 *
 * Input is the `Book` global ID alone (design doc's 10-mutation input
 * collapse), decoded with the same `parseCompoundId`/`NO_MATCH_USER_ID`
 * convention `bookValidate` established — see that file's resolver doc
 * comment for the full malformed-id / wrong-type-id reasoning, which applies
 * here unchanged.
 *
 * `deleteBook` (`services/book-lifecycle.ts`) is NOT wrapped in `toResult`:
 * traced end to end, it only ever throws by letting a Prisma
 * transaction failure or filesystem error escape — no `throw` of any of the
 * seven known domain errors appears anywhere in its body (its own internal
 * `P2025` catch converts a races-with-itself double-delete into a no-op, not
 * an error). Wrapping it would make the `err` branch unreachable and
 * undischargeable except by throwing or mislabelling — exactly what
 * `progressDelete`'s doc comment already explains for `clearProgress`; see
 * `to-result.ts` for the rule this follows.
 *
 * REST 404s (book not found, or found but not owned — `resolveOwner` already
 * excludes the latter) are modelled as `null`, the same "no such row"
 * convention `progressDelete` established, not a typed error.
 */
builder.mutationField('bookDelete', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Deletes a book from the library — file and DB row both. Resolves to ' +
      'null when the book does not exist for the resolved owner.',
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

      const deleted = await deleteBook(
        context.prisma,
        context.config.booksDir,
        context.editionsRoot,
        owner,
        bookId
      );
      if (deleted === null) return null;

      return {
        __typename: 'BookDeletePayload' as const,
        deletedId: encodeGlobalID('Book', JSON.stringify([owner.userId, deleted.id])),
        owner,
      };
    },
  })
);
