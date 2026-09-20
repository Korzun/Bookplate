import { isConfigAdminRow } from '../../../../services/admin-account';
import { invalidateEmailTokens } from '../../../../services/email-token';
import { resetPassword } from '../../../../services/password';
import { revokeAllForUsername } from '../../../../services/token';
import { builder } from '../../builder';
import { model as userModel } from '../model';

/**
 * `userId` only — a `User` global ID, per the spec's rule for every
 * user-associated mutation.
 */
const input = builder.inputType('UserResetPasswordInput', {
  fields: (t) => ({
    userId: t.globalID({ required: true, for: userModel }),
  }),
});

type UserResetPasswordPayloadShape = {
  readonly __typename: 'UserResetPasswordPayload';
  readonly userId: string;
  readonly password: string;
};

/**
 * `user` is a fresh `t.prismaField` lookup by `userId` — the reset does not
 * change the row's id, so `findUniqueOrThrow` against the same id `loadOwner`
 * already resolved is safe (the row was read-then-written inside this same
 * request).
 */
const payload = builder
  .objectRef<UserResetPasswordPayloadShape>('UserResetPasswordPayload')
  .implement({
    fields: (t) => ({
      user: t.prismaField({
        type: userModel,
        resolve: (query, parent, _args, context) =>
          context.prisma.user.findUniqueOrThrow({ ...query, where: { id: parent.userId } }),
      }),
      password: t.exposeString('password'),
    }),
  });

/**
 * No `resolveType`: the value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 */
const result = builder.unionType('UserResetPasswordResult', { types: [payload] });

/**
 * Single-member union — same reasoning as `userDelete`'s identical note:
 * `input` has exactly one field, a `User` global ID, already format-checked
 * by the relay plugin before this resolver runs, so there is no string field
 * for a zod schema to reject and no reachable `InvalidInputError` case. A
 * one-member union is still the right shape (fabricates nothing, satisfies
 * Task 1's binding `<Name>Result` rule, keeps a future member non-breaking)
 * — see `userDelete`'s doc comment for the full reasoning; task-6 review
 * adjudicated this ruling for all three single-field-input mutations.
 *
 * Mirrored REST's `POST /api/users/:username/reset-password`, removed in
 * Phase 0 — admin-only (`router.use(adminAuth)` gated the whole router), no
 * `ownerOf` alternative.
 *
 * REST's target-specific 403 ("Cannot reset the built-in admin password",
 * checked BEFORE the store call, before Phase 0 removed that route) DOES now
 * have an equivalent branch here — the resolver's explicit `isConfigAdminRow`
 * guard, added once the email-identity work gave the config admin a `users`
 * row. This is the sharpest guard in the whole plan: without it,
 * `resetPassword` below would write a real argon2 hash onto that row, and
 * `validateUser` authenticates ANY row that has one — producing a second
 * credential for the admin account that the add-on options neither govern
 * nor can rotate or revoke. The guard resolves to the ordinary "no such
 * user" `null`, same as any other global ID (including an attacker-crafted
 * one) that doesn't resolve to a real, non-admin row — so the admin row
 * stays indistinguishable from a nonexistent one rather than merely
 * protected. See `services/admin-account.ts` and `userDelete`'s doc comment
 * for the full reasoning behind that shape.
 *
 * `resetPassword` is NOT wrapped in `toResult`: traced end to end
 * (`services/password.ts`), its own `P2025` catch already converts
 * a races-with-itself "user deleted mid-request" into `null` — nothing left
 * in its body can throw one of the seven known domain errors.
 *
 * `revokeAllForUsername`, imported directly from `services/token.ts` (a
 * plain function over `context.prisma` — no class instance to thread
 * through `Context`), mirrors REST's identical call right after a successful reset
 * (`routes/users.ts`, removed in Phase 0). Unlike REST's own
 * `/api/my/password` self-service flow (mirrored by `userChangePassword`),
 * there is no token *reissue* to mirror here: the admin calling this
 * mutation is not the user whose password just changed, so there is nothing
 * of the admin's own session to refresh.
 */
builder.mutationField('userResetPassword', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Resets a user’s login password to a freshly generated one and forces a ' +
      'change on next login. Resolves to null when the user does not exist.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: { admin: true },
    resolve: async (_parent, args, context) => {
      const userId = args.input.userId.id;
      const owner = await context.loadOwner(userId);
      if (owner === null) return null;

      // G2: refusing is not cosmetic here. `resetPassword` writes a real argon2
      // hash, and `validateUser` authenticates ANY row that has one — so allowing
      // this would mint a second admin credential that the add-on options cannot
      // rotate or revoke. The admin's password is the options value, full stop.
      if (await isConfigAdminRow(context.prisma, owner.userId)) return null;

      const password = await resetPassword(context.prisma, owner.username);
      if (password === null) return null;

      await revokeAllForUsername(context.prisma, owner.username);
      // A reset code minted while the OLD password was still live must not stay
      // spendable once the admin has forced a new one — same reasoning as the
      // refresh-token revocation immediately above, and the same call
      // `userChangePassword`/`viewerSetEmail` make on their own password/address
      // changes.
      await invalidateEmailTokens(context.prisma, owner.userId, 'reset');

      return { __typename: 'UserResetPasswordPayload' as const, userId: owner.userId, password };
    },
  })
);
