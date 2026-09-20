import { isConfigAdminRow } from '../../../../services/admin-account';
import { invalidateEmailTokens } from '../../../../services/email-token';
import { isPrismaError } from '../../../../services/prisma-errors';
import { builder } from '../../builder';
import { model as userModel } from '../model';

/**
 * `userId` only — a `User` global ID, per the spec's rule for every
 * user-associated mutation.
 */
const input = builder.inputType('UserClearEmailInput', {
  fields: (t) => ({
    userId: t.globalID({ required: true, for: userModel }),
  }),
});

type UserClearEmailPayloadShape = {
  readonly __typename: 'UserClearEmailPayload';
  readonly userId: string;
};

/**
 * `user` is a fresh `t.prismaField` lookup by `userId` — the clear does not
 * change the row's id, so `findUniqueOrThrow` against the same id
 * `loadOwner` already resolved is safe (the row was read-then-written inside
 * this same request). Same "field resolvers do the lookup" pattern
 * `UserRegisterPayload.user` uses.
 */
const payload = builder.objectRef<UserClearEmailPayloadShape>('UserClearEmailPayload').implement({
  fields: (t) => ({
    user: t.prismaField({
      type: userModel,
      resolve: (query, parent, _args, context) =>
        context.prisma.user.findUniqueOrThrow({ ...query, where: { id: parent.userId } }),
    }),
  }),
});

/**
 * No `resolveType`: the value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 *
 * Single-member union — same reasoning as `userDelete`'s and
 * `userResetPassword`'s identical notes: `input` has exactly one field, a
 * `User` global ID, already format-checked by the relay plugin before this
 * resolver runs, so there is no string field for a zod schema to reject and
 * no reachable `InvalidInputError` case. A one-member union is still the
 * right shape (fabricates nothing, satisfies Task 1's binding `<Name>Result`
 * rule, keeps a future member non-breaking).
 */
const result = builder.unionType('UserClearEmailResult', { types: [payload] });

/**
 * The admin remedy for the squatting defect this whole spec exists to close:
 * an address claim used to be permanent — `emailKey` is unique and
 * `viewerSetEmail` writes only the caller's own row, so if one account
 * claimed an address another person actually owns, the operator's only
 * recourse was deleting the whole account. This clears the address (and its
 * normalized key and confirmed state) off one row, freeing the address for
 * its rightful owner to claim, while leaving the account itself — its
 * password, its books, its progress — untouched.
 *
 * Admin-only, `authScopes: { admin: true }`, no `ownerOf` alternative: an
 * owner has no self-service way to end up with no address at all —
 * `viewerSetEmail`'s `setUserEmail` rejects anything that fails
 * `isValidEmail`, so a viewer can only ever REPLACE their address, never
 * null it — and that is deliberate: the `mustSetEmail` gate exists to keep
 * every viewer reachable, and a self-clear would be a way around it. This
 * mutation exists for the one case that gate cannot resolve on its own: a
 * cross-account claim, which only an operator can undo.
 *
 * The config admin's row is not an ordinary account. Creating that row is
 * what made this mutation's cross-account write possible at all, so it
 * carries the same guard `userDelete` and `userResetPassword` do, and
 * returns the same ordinary `null` — the row stays UNADDRESSABLE, not merely
 * protected, and is indistinguishable from one that is absent. See
 * `services/admin-account.ts`.
 *
 * Deliberately does NOT call `revokeAllForUsername`: losing an address does
 * not compromise a password, and signing someone out for the operator's
 * bookkeeping would be gratuitous — unlike `userResetPassword`, which revokes
 * sessions because a NEW credential exists that the old session's holder
 * (possibly an attacker) must not get to keep using alongside it.
 *
 * `invalidateEmailTokens` with no `purpose` argument — BOTH purposes, unlike
 * `userResetPassword`'s `'reset'`-only call: a `verify` code proves an
 * address this row no longer holds, and a `reset` code was sent to one.
 * Neither may stay spendable once the address is gone.
 */
builder.mutationField('userClearEmail', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      "Clears a user's email address, its normalized key and its confirmed " +
      'state, freeing the address for its rightful owner to claim. The ' +
      'account itself is untouched. Resolves to null when the user does not ' +
      'exist. The user will be asked to set an address again the next time ' +
      'their session refreshes — within one access-token lifetime, not only ' +
      'at their next sign-in — if mail is configured.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: { admin: true },
    resolve: async (_parent, args, context) => {
      const owner = await context.loadOwner(args.input.userId.id);
      if (owner === null) return null;

      // The config admin's row is not an ordinary account. Creating that row
      // is what made this mutation's cross-account write possible at all, so
      // it carries the same guard `userDelete` and `userResetPassword` do,
      // and returns the same ordinary `null` — the row stays UNADDRESSABLE,
      // not merely protected, and is indistinguishable from one that is
      // absent.
      if (await isConfigAdminRow(context.prisma, owner.userId)) return null;

      // Unlike `userDelete`/`userResetPassword`'s services, this write is a
      // plain `prisma.user.update` with no `P2025` catch of its own — a row
      // that vanishes between `loadOwner` above and this call (e.g. a
      // concurrent `userDelete` on the same target) throws instead of
      // resolving. Caught here, narrowly, so that race still resolves to the
      // ordinary "no such user" `null` this field's own description
      // promises, rather than surfacing as an internal error.
      try {
        await context.prisma.user.update({
          where: { id: owner.userId },
          data: { email: null, emailKey: null, emailVerifiedAt: null },
        });
      } catch (e) {
        if (isPrismaError(e, 'P2025')) return null;
        throw e;
      }

      // Both purposes: a verify code proves an address this row no longer
      // holds, and a reset code was sent to one. Neither may stay spendable.
      await invalidateEmailTokens(context.prisma, owner.userId);

      return { __typename: 'UserClearEmailPayload' as const, userId: owner.userId };
    },
  })
);
