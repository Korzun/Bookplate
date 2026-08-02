import { encodeGlobalID } from '@pothos/plugin-relay';

import { removeUserBooksDir } from '../../../../utils/user-books-dir';
import { builder } from '../../builder';
import { model as userModel } from '../model';

/**
 * `userId` only — a `User` global ID, per the spec's rule for every
 * user-associated mutation. `for: userModel` makes the relay plugin reject a
 * global ID of the wrong type at coercion time.
 */
const input = builder.inputType('UserDeleteInput', {
  fields: (t) => ({
    userId: t.globalID({ required: true, for: userModel }),
  }),
});

type UserDeletePayloadShape = {
  readonly __typename: 'UserDeletePayload';
  readonly deletedId: string;
  readonly deletedUserId: string;
};

/**
 * Carries BOTH `deletedId: ID!` and `deletedUserId: String!`, per the ledger's
 * rule for deletes of `Node`-backed entities. `User`'s node id (`user/
 * model.ts`: `id: { field: 'id' }`) is a plain, non-compound column, unlike
 * `Book`'s — so `deletedUserId` is the same value `deletedId` decodes to,
 * rather than a second half of a compound key. Still exposed as its own raw
 * field, for the same REST-parity reason `bookDelete`'s `deletedBookId` is:
 * a client that only needs the raw id (e.g. to match it against something
 * REST-sourced) shouldn't have to base64-decode `deletedId` to get it.
 *
 * No `library`/`user` field alongside these, unlike `progressDelete`'s
 * `library` or `bookDelete`'s `library`: the parent those fields update a
 * cache against is the row that just stopped existing along with the user
 * itself — there is nothing left to resolve it into.
 */
const payload = builder.objectRef<UserDeletePayloadShape>('UserDeletePayload').implement({
  fields: (t) => ({
    deletedId: t.exposeID('deletedId'),
    deletedUserId: t.exposeString('deletedUserId'),
  }),
});

/**
 * No union, unlike every other mutation in this schema: `input` has exactly
 * one field, a `User` global ID, whose format is already enforced by the
 * relay plugin before this resolver ever runs (see `builder.ts`'s
 * plugin-ordering comment — RelayPlugin sits outside ScopeAuthPlugin, which
 * itself sits outside this resolver). There is no string field left for a
 * zod schema to check, so an `InvalidInputError` member would be a
 * permanently unreachable branch — declaring one anyway would be exactly the
 * kind of dishonest union member the "never fabricate an error value for a
 * state that isn't that error" rule warns against, just at the schema level
 * instead of the value level. Flagged for reviewer attention: every sibling
 * mutation built so far returns a `<Name>Result` union, so this is the first
 * departure from that shape.
 *
 * Mirrors `DELETE /api/users/:username` (`routes/users.ts:76-92`) —
 * `router.use(adminAuth)` gates the whole router, so this is admin-only with
 * no `ownerOf` alternative, same as `userRegister`.
 *
 * Self-deletion / "last admin" (raised in the task brief) does not apply:
 * this app has exactly one admin, the config-file account, which has no row
 * in the `users` table (`Viewer.userId` is always `null` for it) — so it can
 * never be named by a `User` global ID at all, and can therefore never be
 * the target of this mutation, by construction. Every DB-backed `User` row
 * is an ordinary, non-admin account (the schema has no per-row admin flag —
 * `prisma/schema.prisma`'s `User` model), so "the caller deletes themselves"
 * is likewise impossible: only the config admin may call this mutation, and
 * the config admin has no `User` row to name as `userId`.
 *
 * REST's one target-specific 403 — resetting/deleting the literal reserved
 * admin username — has no equivalent branch here for the identical reason:
 * there is no `User` global ID that could ever decode to the admin, so the
 * case REST special-cases can't arise; an attacker-crafted global ID
 * embedding some arbitrary string collapses into the ordinary "no such row"
 * `null` below, same as any other nonexistent id. Same kind of REST-shape
 * divergence `bookDelete`'s doc comment records for "admin without a
 * target".
 *
 * `UserStore.deleteUser` is NOT wrapped in `toResult`: traced end to end
 * (`services/user-store.ts:366-387`), its own `P2025` catch already converts
 * a races-with-itself double-delete into `false`, and its `editionStore`
 * purge failure is caught and logged, never rethrown — nothing left in its
 * body can throw one of the seven known store errors. Same reasoning as
 * `bookDelete`'s identical note on `BookStore.deleteBook`.
 *
 * `removeUserBooksDir` (`utils/user-books-dir.ts`) replicates REST's on-disk
 * cleanup (`fs.rmSync(booksRoot/<username>)`) via the SAME helper the route
 * now calls too (extracted from `routes/users.ts`, see that file's diff) —
 * not a second copy of the two-line body, per the task brief's explicit
 * instruction. Run only after `deleteUser` reports success, matching REST's
 * own ordering (DB row gone, then the folder).
 */
builder.mutationField('userDelete', (t) =>
  t.field({
    type: payload,
    nullable: true,
    description:
      'Deletes a user account — DB row and on-disk library folder both. ' +
      'Resolves to null when the user does not exist.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: { admin: true },
    resolve: async (_parent, args, context) => {
      const userId = String(args.input.userId.id);
      const owner = await context.loadOwner(userId);
      if (owner === null) return null;

      const deleted = await context.stores.user.deleteUser(owner.username);
      if (!deleted) return null;

      removeUserBooksDir(context.config.booksDir, owner.username);

      return {
        __typename: 'UserDeletePayload' as const,
        deletedId: encodeGlobalID('User', owner.userId),
        deletedUserId: owner.userId,
      };
    },
  })
);
