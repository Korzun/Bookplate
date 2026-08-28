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
 * checked BEFORE the store call, before Phase 0 removed that route) has no equivalent
 * branch here, for the same structural reason `userDelete`'s doc comment
 * gives in full: the config admin has no `User` row and so no `User` global
 * ID could ever name it — the REST case this guards against cannot arise
 * through this argument shape at all. Any global ID that doesn't resolve to
 * a real row (including one an attacker crafts to embed the reserved
 * username) collapses into the ordinary "no such user" `null` below.
 *
 * `UserStore.resetPassword` is NOT wrapped in `toResult`: traced end to end
 * (`services/user-store.ts:139-154`), its own `P2025` catch already converts
 * a races-with-itself "user deleted mid-request" into `null` — nothing left
 * in its body can throw one of the seven known store errors.
 *
 * `revokeAllForUsername`, imported directly from `services/token.ts` (a
 * plain function over `context.prisma` — no store instance to thread
 * through), mirrors REST's identical call right after a successful reset
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

      const password = await context.stores.user.resetPassword(owner.username);
      if (password === null) return null;

      await revokeAllForUsername(context.prisma, owner.username);

      return { __typename: 'UserResetPasswordPayload' as const, userId: owner.userId, password };
    },
  })
);
