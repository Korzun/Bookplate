import { encodeGlobalID } from '@pothos/plugin-relay';

import { isConfigAdminRow } from '../../../../services/admin-account';
import { deleteUser } from '../../../../services/user';
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
 * concrete future candidate already exists structurally: a "last admin"
 * precondition, were this schema ever to grow a per-row admin flag, would
 * need a member here. (REST's target-specific 403 for the reserved admin
 * username, once a candidate for the same reason, is no longer one — see the
 * note below: it is now an explicit guard in the resolver, folded into the
 * ordinary "no such user" `null` rather than a distinct error.) Task 6's
 * review adjudicated this ruling; every mutation in this schema returns
 * `<Name>Result`, even when the union has exactly one member today.
 *
 * Mirrored REST's `DELETE /api/users/:username`, removed in Phase 0 —
 * `router.use(adminAuth)` gated the whole router, so this is admin-only with
 * no `ownerOf` alternative, same as `userRegister`.
 *
 * Self-deletion / "last admin" (raised in the task brief) does not apply:
 * every DB-backed `User` row that is NOT the config admin's is an ordinary,
 * non-admin account (the schema has no per-row admin flag besides
 * `isConfigAdmin` itself — `prisma/schema.prisma`'s `User` model), so "the
 * caller deletes themselves" is impossible for any of them: only the config
 * admin may call this mutation, and it never owns one of these ordinary rows.
 *
 * The config admin DOES have a `users` row as of the email-identity work — it
 * is where its address and (next spec) notification preferences live — but
 * that row is identity-attached data, not an account this mutation may touch.
 * The guard in the resolver refuses it explicitly, restoring what REST's
 * target-specific 403 did and what this comment previously argued was
 * unnecessary because no `User` global ID could name the admin. That argument
 * no longer holds: the row exists and has an id. See
 * `services/admin-account.ts`.
 *
 * The guard returns the ordinary "no such user" `null` rather than a distinct
 * error, so the admin row stays indistinguishable from a nonexistent one —
 * the same shape an attacker-crafted global ID gets. Same kind of REST-shape
 * divergence `bookDelete`'s doc comment records for "admin without a
 * target".
 *
 * `deleteUser` is NOT wrapped in `toResult`: traced end to end
 * (`services/user.ts`), its own `P2025` catch already converts
 * a races-with-itself double-delete into `false`, and its edition-cache
 * purge failure is caught and logged, never rethrown — nothing left in its
 * body can throw one of the seven known domain errors. Same reasoning as
 * `bookDelete`'s identical note on `deleteBook` (`services/book-lifecycle.ts`).
 *
 * `removeUserBooksDir` (`utils/user-books-dir.ts`) replicates REST's on-disk
 * cleanup (`fs.rmSync(booksRoot/<username>)`) via the SAME helper that route
 * called too (extracted from `routes/users.ts` before Phase 0 removed it) —
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

      // G2: the config admin's row is not a deletable account. Before this row
      // existed, this mutation got the guarantee for free — see the doc comment
      // above. Returning the ordinary "no such user" result rather than a distinct
      // error keeps the row unaddressable instead of merely protected.
      if (await isConfigAdminRow(context.prisma, owner.userId)) return null;

      const deleted = await deleteUser(context.prisma, context.editionsRoot, owner.username);
      if (!deleted) return null;

      removeUserBooksDir(context.config.booksDir, owner.username);

      return {
        __typename: 'UserDeletePayload' as const,
        deletedId: encodeGlobalID('User', owner.userId),
      };
    },
  })
);
