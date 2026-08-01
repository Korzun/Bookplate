import { builder } from '../builder';
import { model as linkedDocument } from '../linked-document';
import { model } from './model';

/**
 * `Book.lineage` is not a Prisma relation (`BookIdHistory` is keyed by
 * `(userId, oldId)`, not by a FK to `Book`), so it goes through
 * `context.stores.book.getBookLineage` — the same store method REST's
 * `GET /api/books/:id/lineage` calls — rather than `t.relation`.
 *
 * `getBookLineage` takes a full `Owner` (`{ userId, username }`), but a
 * `Book` row only carries `userId`. Resolved via `context.loadOwner(userId)`
 * — the same request-scoped, memoized loader `Viewer.library` and `Library`
 * itself already use — rather than synthesizing a `{ userId, username: '' }`
 * stand-in. `getBookLineage` only reads `owner.userId` today (it scopes its
 * SQL by `user_id` alone; `username` is unused — see `book-store.ts`), so a
 * synthesized owner would work right now, but it would be a landmine for
 * whoever changes that store method later to also depend on `username` (or
 * for any future caller who copies this resolver as a template). Going
 * through the real loader costs one memoized `User` lookup per request (or a
 * cache hit if `Viewer.library` already ran) and always yields a genuine
 * `Owner` instead of a field-by-field guess about which parts of it matter.
 *
 * A `null` `loadOwner` result (the book's own user row missing) is treated
 * the same as "no lineage" rather than surfaced as an error: the resolver
 * has nothing else to report, and the owner-scoped `Book` this field hangs
 * off of could only be reached at all because that row already resolved once
 * upstream.
 */
builder.objectField(model, 'lineage', (t) =>
  t.field({
    type: [linkedDocument],
    resolve: async (parent, _args, context) => {
      const owner = await context.loadOwner(parent.userId);
      if (owner === null) return [];
      const lineage = await context.stores.book.getBookLineage(owner, parent.id);
      return lineage?.entries ?? [];
    },
  })
);
