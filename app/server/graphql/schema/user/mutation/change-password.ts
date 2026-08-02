import { z } from 'zod';

import { UserStore } from '../../../../services/user-store';
import { builder } from '../../builder';
import {
  incorrectPasswordError,
  model as incorrectPasswordErrorModel,
} from '../../incorrect-password-error/model';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { model as userModel } from '../model';

/**
 * `userId` follows `progressSet`'s established shape-consistency precedent
 * (ledger, task 5): kept for input SHAPE even though the scope below pins it
 * to the caller's own id with no admin path — see this mutation's own doc
 * comment for the REST trace proving there is none. `currentPassword`/
 * `newPassword` are `PATCH /api/my/password`'s exact body fields
 * (`routes/ui.ts:393-396`).
 */
const input = builder.inputType('UserChangePasswordInput', {
  fields: (t) => ({
    userId: t.globalID({ required: true, for: userModel }),
    currentPassword: t.string({ required: true }),
    newPassword: t.string({ required: true }),
  }),
});

/**
 * REST checks both fields with one combined guard and one combined message
 * (`routes/ui.ts:397-404`: `!currentPassword || !newPassword` → "Current and
 * new password are required") — reproduced on both fields here rather than a
 * single object-level check, so each empty field gets its own `issues` entry
 * (a client can highlight the specific empty box), while the message text
 * itself stays identical to REST's.
 */
const inputSchema = z.object({
  currentPassword: z.string().min(1, 'Current and new password are required'),
  newPassword: z.string().min(1, 'Current and new password are required'),
});

type UserChangePasswordPayloadShape = {
  readonly __typename: 'UserChangePasswordPayload';
  readonly userId: string;
};

/**
 * `user` is a fresh `t.prismaField` lookup by `userId` — the change does not
 * touch the row's id, so `findUniqueOrThrow` against the id the scope check
 * already pinned to the caller is safe.
 */
const payload = builder
  .objectRef<UserChangePasswordPayloadShape>('UserChangePasswordPayload')
  .implement({
    fields: (t) => ({
      user: t.prismaField({
        type: userModel,
        resolve: (query, parent, _args, context) =>
          context.prisma.user.findUniqueOrThrow({ ...query, where: { id: parent.userId } }),
      }),
    }),
  });

/**
 * No `resolveType`: every member value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 */
const result = builder.unionType('UserChangePasswordResult', {
  types: [payload, invalidInputErrorModel, incorrectPasswordErrorModel],
});

/**
 * Mirrors `PATCH /api/my/password` (`routes/ui.ts:383-428`) — self-service,
 * viewer-only, with NO admin path: `req.user!.isAdmin` gets a flat 403
 * (`routes/ui.ts:387-390`), and `routes/users.ts` has no admin route that
 * changes a *known* current password (only `POST .../reset-password`, which
 * `userResetPassword` mirrors, generates a NEW one). So — like `progressSet`
 * — this deliberately does NOT use the `ownerOf` scope every admin-capable
 * user-associated mutation in this schema uses; `userId` is still a required
 * input field for shape consistency (spec, "Mutations" section), but the
 * scope pins it to exactly the caller: `context.viewer.userId ===
 * args.input.userId.id`, which the config admin (`viewer.userId` always
 * `null`) can never satisfy.
 *
 * **`skipTypeScopes: true` + `passwordChangeAllowed` is load-bearing, not
 * decorative.** `builder.mutationType`'s type-level scope is `authenticated`
 * (`schema/builder.ts`), which is FALSE for a viewer whose `mustChangePassword`
 * is `true` — Pothos ANDs type-level and field-level scopes by default, so
 * without `skipTypeScopes` this mutation would be unreachable by exactly the
 * users it exists for. `passwordChangeAllowed` (`context.viewer !== null`)
 * is the correct type-level substitute: it admits a `mustChangePassword`
 * viewer while still refusing a null one. The field-level `authScopes`
 * function below re-derives the same "non-null viewer" condition as part of
 * its self-only check, so `passwordChangeAllowed` and `skipTypeScopes`
 * together only need to cover the TYPE-level gate that would otherwise block
 * a forced-change viewer — see `builder.ts`'s own comment on this exemption
 * and the task ledger's standing rule.
 *
 * REST's own gate confirms this is the ONE exempted route: `passwordChangeGate`
 * (`middleware/auth.ts:97-120`) 403s every `/api/*` request from a
 * `mustChangePassword` token except `/api/login`, `/api/auth/*`, and
 * literally `/api/my/password` — `/api/my/sync-password/regenerate` (mirrored
 * by `userRegenerateSyncPassword`) is NOT in that exemption list, so that
 * mutation stays on the ordinary `authenticated` scope.
 *
 * The 401 REST returns for a wrong `currentPassword` (`routes/ui.ts:406-409`,
 * `UserStore.validateUser` returning `false` — never a throw, see
 * `services/user-store.ts:106-114`) is modelled as the honest
 * `IncorrectPasswordError`, not folded into `InvalidInputError` — see that
 * type's doc comment.
 *
 * `UserStore.changePassword` returning `false` (`services/user-store.ts:124-137`,
 * its own `P2025` catch — the account was deleted between token issuance and
 * this request) is modelled as `null`, the same "no such row" convention
 * every other mutation in this schema uses; genuinely unreachable through
 * this mutation's own auth path in practice (the scope just proved the
 * caller's own row exists), but REST's branch is real and this is its
 * mirror, not an invented case. Neither store call is wrapped in
 * `toResult`: neither throws any of the seven known store errors.
 *
 * `context.stores.token.revokeAllForUsername` mirrors REST's identical call
 * on success (`routes/ui.ts:420`). REST also reissues tokens
 * (`issueTokens`, `routes/ui.ts:421-426`) so the client's existing cookies
 * immediately carry `mustChangePassword: false` — this resolver does NOT
 * reproduce that half: yoga's context (`graphql/context.ts`'s `createContext`)
 * only ever sees the fetch `Request`, never a `Response` to set cookies on,
 * so there is no channel to reissue tokens from here. A caller's own
 * already-decoded access token keeps its stale claim until it next refreshes
 * through REST's `/api/auth/refresh` (which rebuilds claims from current DB
 * state) — the same architectural split `builder.ts` documents for login and
 * refresh staying on REST entirely. Revocation, the security-relevant half,
 * is fully mirrored; only the convenience of an immediately-fresh token is
 * not, and REST's own doc trail (spec's "Seams that stay REST") already
 * draws this line for auth issuance in general.
 */
builder.mutationField('userChangePassword', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Changes the viewer’s own login password. Requires the current password ' +
      'and works even when a forced password change is pending. Resolves to ' +
      'null in the unlikely case the account was deleted mid-request.',
    args: { input: t.arg({ type: input, required: true }) },
    skipTypeScopes: true,
    authScopes: (_parent, args, context) =>
      context.viewer !== null && context.viewer.userId === args.input.userId.id,
    resolve: async (_parent, args, context) => {
      const parsed = inputSchema.safeParse({
        currentPassword: args.input.currentPassword,
        newPassword: args.input.newPassword,
      });
      if (!parsed.success) return invalidInputError(parsed.error);

      // authScopes already required args.input.userId.id === context.viewer.userId,
      // so this names exactly the caller's own account.
      const userId = String(args.input.userId.id);
      const username = context.viewer!.username;

      const valid = await context.stores.user.validateUser(username, parsed.data.currentPassword);
      if (!valid) return incorrectPasswordError();

      const newHash = await UserStore.hashLoginPassword(parsed.data.newPassword);
      const changed = await context.stores.user.changePassword(username, newHash);
      if (!changed) return null;

      await context.stores.token.revokeAllForUsername(username);

      return { __typename: 'UserChangePasswordPayload' as const, userId };
    },
  })
);
