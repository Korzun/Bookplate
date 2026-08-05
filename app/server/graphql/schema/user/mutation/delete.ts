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
};

/**
 * Carries only `deletedId: ID!`, the Relay global ID. The raw `deletedUserId`
 * field was removed — no in-repo client consumes a raw user id (the schema's
 * only consumer evicts by global ID). (`bookDelete` made the same choice for
 * `deletedBookId`, removing the twin when clients moved to GraphQL-only.)
 *
 * No `library`/`user` field alongside `deletedId`, unlike `progressDelete`'s
 * `library` or `bookDelete`'s `library`. **Correction (task-6 review, M-1):**
 * this is NOT because "nothing is left to resolve" — `Viewer.users:
 * [User!]!` (`viewer/model.ts`), the admin user list, still exists and is
 * exactly the collection a client would want to evict the deleted row from.
 * The real reason is a Houdini-cache one: `deletedId` alone is what that
 * list's list-removal directive keys on (same convention `progressDelete`/
 * `bookDelete` already rely on for their own parent field), so returning
 * `Viewer` here would add a query with no additional cache-invalidation
 * power over `deletedId` by itself — unlike `progressDelete`'s `library`,
 * which supplies data (`owner`) the deleted row's id alone cannot.
 */
const payload = builder.objectRef<UserDeletePayloadShape>('UserDeletePayload').implement({
  fields: (t) => ({
    deletedId: t.exposeID('deletedId'),
  }),
});

/**
 * No `resolveType`: the value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note. See the doc comment below
 * for why a one-member union is the right shape here rather than a bare
 * payload type.
 */
const result = builder.unionType('UserDeleteResult', { types: [payload] });

/**
 * Single-member union — `input` has exactly one field, a `User` global ID,
 * whose format is already enforced by the relay plugin before this resolver
 * ever runs (see `builder.ts`'s plugin-ordering comment — RelayPlugin sits
 * outside ScopeAuthPlugin, which itself sits outside this resolver). There is
 * no string field left for a zod schema to check, so an `InvalidInputError`
 * member would be a permanently unreachable branch — adding one would be
 * exactly the kind of dishonest union member the "never fabricate an error
 * value for a state that isn't that error" rule warns against, just at the
 * schema level instead of the value level.
 *
 * A one-member union is still the right shape, not a compromise: it declares
 * no error that cannot happen (nothing fabricated), it satisfies Task 1's
 * binding rule ("`builder.mutationField` + explicit `<Name>Input` + explicit
 * `<Name>Result` union") literally rather than as an exception, and — the
 * decisive reason — it keeps the door open for a real future member without
 * a breaking change. Changing a field's return type from an object to a
 * union later would break every existing `userDelete { deletedId }`
 * selection; adding a member to an already-declared union does not. A
 * concrete future candidate already exists structurally: REST's
 * target-specific 403 ("Cannot reset the built-in admin password") is only
 * unreachable today because the config admin happens to own no `User` row
 * (see the note below) — a per-row admin flag or a "last admin" precondition
 * would each need a member here. Task 6's review adjudicated this ruling;
 * every mutation in this schema returns `<Name>Result`, even when the union
 * has exactly one member today.
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
    type: result,
    nullable: true,
    description:
      'Deletes a user account — DB row and on-disk library folder both. ' +
      'Resolves to null when the user does not exist.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: { admin: true },
    resolve: async (_parent, args, context) => {
      const userId = args.input.userId.id;
      const owner = await context.loadOwner(userId);
      if (owner === null) return null;

      const deleted = await context.stores.user.deleteUser(owner.username);
      if (!deleted) return null;

      removeUserBooksDir(context.config.booksDir, owner.username);

      return {
        __typename: 'UserDeletePayload' as const,
        deletedId: encodeGlobalID('User', owner.userId),
      };
    },
  })
);
