import { encodeGlobalID } from '@pothos/plugin-relay';
import { z } from 'zod';

import type { Owner } from '../../../../types';
import { builder } from '../../builder';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { model as library } from '../../library/model';
import { model as user } from '../../user/model';

/**
 * `bookId` is the raw content-hash id (`Book.bookId`), not a `Book` global
 * ID — same reason as `bookUpdateMetadataInput.bookId` (see that file's doc
 * comment): book ids are partial MD5s of file content, shared across users,
 * so a global ID would need owner-scoped decoding this mutation would then
 * have to duplicate. `userId` mirrors `progressDelete`'s `userId` — see that
 * file's doc comment for the REST routes this owner-resolution shape covers.
 */
const input = builder.inputType('BookDeleteInput', {
  fields: (t) => ({
    userId: t.globalID({ required: true, for: user }),
    bookId: t.string({ required: true }),
  }),
});

type BookDeletePayloadShape = {
  readonly __typename: 'BookDeletePayload';
  readonly deletedId: string;
  readonly deletedBookId: string;
  readonly owner: Owner;
};

/**
 * Carries BOTH `deletedId: ID!` and `deletedBookId: String!`.
 *
 * **Corrected after review** (task-2 review, Adjudication 1 — overturned the
 * original `deletedBookId`-only shape): `Book` *is* a `Node`, and the
 * ledger's "deletes of Node-backed entities return `deletedId: ID!`" rule
 * names its one exception as non-`Node` types (`progressDelete`'s
 * `deletedDocument`, because `Progress` isn't one). `Book` doesn't qualify
 * for that exception, and the spec's own reason for the rule —
 * `deletedId: ID!` is "what Houdini's list-removal directives need" — depends
 * on the type's *configured cache key*, which for `Book` is `id`, not the raw
 * hash. A raw-hash-only payload could not drive that directive at all.
 *
 * The original tradeoff (REST/sibling-field parity vs. the binding rule) was
 * false: nothing forces a choice. `deletedId` is computed the same way the
 * schema itself would compute it for a still-live row —
 * `encodeGlobalID('Book', JSON.stringify([owner.userId, id]))`, matching
 * `node-scope.ts`'s `parseCompoundId` doc comment on Pothos's own compound-id
 * serializer — and costs nothing extra: no query, since both halves of the
 * compound key are already in hand. `deletedBookId` stays alongside it for
 * every reason the original comment gave: `Progress.document`,
 * `LinkedDocument.oldId`/`newId`, `Library.book(id:)`'s argument, and
 * `Book.bookId` itself all key on the raw hash, and REST parity does too
 * (`DELETE /api/books/:id`).
 */
const payload = builder.objectRef<BookDeletePayloadShape>('BookDeletePayload').implement({
  fields: (t) => ({
    deletedId: t.exposeID('deletedId'),
    deletedBookId: t.exposeString('deletedBookId'),
    library: t.field({ type: library, resolve: (result) => result.owner }),
  }),
});

/**
 * No `resolveType`: every member value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 */
const result = builder.unionType('BookDeleteResult', {
  types: [payload, invalidInputErrorModel],
});

/**
 * `min(1)` and nothing more, for the same reason `progressDelete`'s
 * `document` gets no more: REST's `DELETE /api/books/:id` cannot structurally
 * receive an empty `:id` path segment (Express would not match the route), so
 * an empty `bookId` is the one input REST never had to reject — this mutation
 * rejects it explicitly instead, since GraphQL has no equivalent route-
 * matching floor.
 */
const inputSchema = z.object({
  bookId: z.string().min(1, 'bookId must not be empty'),
});

/**
 * Mirrors `DELETE /api/books/:id` (`routes/ui.ts:1021`). Owner resolution
 * mirrors REST's `resolveOwner` — see `bookUpdateMetadata`'s doc comment for
 * the same `ownerOf`-scoped shape and why REST's "admin without a target"
 * 400 cannot occur here.
 *
 * `BookStore.deleteBook` is NOT wrapped in `toResult`: traced end to end
 * (`book-store.ts`'s `deleteBook`), it only ever throws by letting a Prisma
 * transaction failure or filesystem error escape — no `throw` of any of the
 * seven known store errors appears anywhere in its body (its own internal
 * `P2025` catch converts a races-with-itself double-delete into a no-op, not
 * an error). Wrapping it would make the `err` branch unreachable and
 * undischargeable except by throwing or mislabelling — exactly what
 * `progressDelete`'s doc comment already explains for `UserStore.
 * clearProgress`; see `to-result.ts` for the rule this follows.
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
    authScopes: (_parent, args) => ({ ownerOf: args.input.userId.id }),
    resolve: async (_parent, args, context) => {
      const parsed = inputSchema.safeParse({ bookId: args.input.bookId });
      if (!parsed.success) return invalidInputError(parsed.error);

      const userId = args.input.userId.id;
      const owner = await context.loadOwner(userId);
      if (owner === null) return null;

      const deleted = await context.stores.book.deleteBook(owner, parsed.data.bookId);
      if (deleted === null) return null;

      return {
        __typename: 'BookDeletePayload' as const,
        deletedId: encodeGlobalID('Book', JSON.stringify([owner.userId, deleted.id])),
        deletedBookId: deleted.id,
        owner,
      };
    },
  })
);
