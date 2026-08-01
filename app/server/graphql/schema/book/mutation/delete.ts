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
  readonly deletedBookId: string;
  readonly owner: Owner;
};

/**
 * `deletedBookId: String!`, not `deletedId: ID!` — a deliberate reading of
 * the ledger's "deletes of Node-backed entities return `deletedId: ID!`"
 * rule, not a silent substitution:
 *
 * `Book` *is* a `Node`, and its global ID (`encodeGlobalID('Book',
 * JSON.stringify([owner.userId, id]))`) is mechanically computable from
 * `owner` + the deleted row's raw id even after the row is gone — nothing
 * about "the row no longer exists" actually prevents minting a `deletedId:
 * ID!` the way it would for a type whose id isn't a pure function of already-
 * known values. So the rule's literal form *could* be honoured here.
 *
 * This mutation deliberately does not, because the raw content-hash id is
 * what every sibling in this schema already keys deletion-adjacent state on:
 * `Progress.document`, `LinkedDocument.oldId`/`newId`, `Library.book(id:)`'s
 * argument, and `Book.bookId` itself all carry this exact value, in this
 * exact (non-global-ID) form — see `book/model.ts`'s doc comment on
 * `bookId` for why a client cannot derive one from the other. REST parity
 * points the same way: `DELETE /api/books/:id` takes and this mutation's
 * brief specifies this raw hash, and Houdini's own list-removal directives
 * (spec 2) need it to evict `Library.progress`/lineage rows keyed the same
 * way, not a `Book`-typed global ID those rows never carried.
 *
 * The real tension this leaves unresolved: a *global* `deletedId: ID!` is
 * what Houdini's own normalized-cache node eviction keys on for free (a
 * `Book` node already in the cache, evicted by its own id, no bespoke
 * client-side mapping) — this schema's other Node-backed deletes, whenever
 * they land, get that for free. `deletedBookId` does not; a client must
 * still know how to turn this raw hash into whatever locally-cached `Book`
 * node it names, the same bespoke work REST-parity clients already do today.
 * Flagged here rather than resolved silently: if a future task needs
 * automatic node eviction more than it needs this hash for non-cache
 * purposes, that tension is the reason to revisit this, not evidence this
 * choice was an oversight.
 */
const payload = builder.objectRef<BookDeletePayloadShape>('BookDeletePayload').implement({
  fields: (t) => ({
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
    authScopes: (_parent, args) => ({ ownerOf: String(args.input.userId.id) }),
    resolve: async (_parent, args, context) => {
      const parsed = inputSchema.safeParse({ bookId: args.input.bookId });
      if (!parsed.success) return invalidInputError(parsed.error);

      const userId = String(args.input.userId.id);
      const owner = await context.loadOwner(userId);
      if (owner === null) return null;

      const deleted = await context.stores.book.deleteBook(owner, parsed.data.bookId);
      if (deleted === null) return null;

      return {
        __typename: 'BookDeletePayload' as const,
        deletedBookId: deleted.id,
        owner,
      };
    },
  })
);
