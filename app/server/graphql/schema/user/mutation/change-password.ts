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
 * **No `userId` field — deliberately, and it must not be re-added.**
 *
 * This input originally carried `userId: ID!` for shape consistency with
 * `progressSet` (ledger, task 5), even though the scope pinned it to the
 * caller's own id and there is no admin path. That made the mutation
 * *unreachable by the very users it exists for*, discovered while migrating
 * the client (2026-08-04):
 *
 *   - `skipTypeScopes` + `passwordChangeAllowed` below exist so a viewer with
 *     a pending forced password change can call this mutation. That works.
 *   - But `authenticated` is `viewer !== null && !viewer.mustChangePassword`
 *     (`schema/builder.ts`) and the WHOLE `Query` type is gated on it, with no
 *     field opting out. So that same viewer gets `FORBIDDEN` from
 *     `query { viewer { user { id } } }` — verified, not inferred.
 *   - Their JWT carries only the RAW user id, so the only way to produce the
 *     required global ID client-side was `base64('User:' + rawId)` — exactly
 *     the Pothos-encoding coupling the book-relay-id plan removed.
 *
 * A self-only mutation has no business taking an identity argument it then
 * refuses to honour: the caller is already known from the context. Deriving it
 * removes the deadlock and one class of footgun at once.
 *
 * `currentPassword`/`newPassword` are `PATCH /api/my/password`'s exact body
 * fields (`routes/ui.ts:393-396`), which likewise names no user — REST reads
 * the identity off the session, as this now does.
 */
const input = builder.inputType('UserChangePasswordInput', {
  fields: (t) => ({
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
 * Mirrored REST's `PATCH /api/my/password` (`routes/ui.ts`, that route since
 * removed) — self-service, viewer-only, with NO admin path: `req.user!.isAdmin`
 * got a flat 403, and `routes/users.ts` had no admin route that changed a
 * *known* current password (only `POST .../reset-password`, which
 * `userResetPassword` mirrors, generated a NEW one), before Phase 0 removed
 * both routers. So — like `progressSet`
 * — this deliberately does NOT use the `ownerOf` scope every admin-capable
 * user-associated mutation in this schema uses. The target is not an argument
 * at all (see the input type's own comment): it IS the caller, taken from
 * `context.viewer.userId`.
 *
 * The config admin is still refused, by the same condition as before expressed
 * directly rather than through an id comparison: its `viewer.userId` is always
 * `null`, so it has no account of its own to change. Naming another user is now
 * not merely refused but unrepresentable.
 *
 * **`skipTypeScopes: true` + `passwordChangeAllowed` is load-bearing, not
 * decorative.** `builder.mutationType`'s type-level scope is `authenticated`
 * (`schema/builder.ts`), which is FALSE for a viewer whose `mustChangePassword`
 * is `true` — Pothos ANDs type-level and field-level scopes by default, so
 * without `skipTypeScopes` this mutation would be unreachable by exactly the
 * users it exists for. `passwordChangeAllowed` (`context.viewer !== null`)
 * is the type-level substitute: it admits a `mustChangePassword` viewer while
 * still refusing a null one — and the field's own `authScopes` function below
 * DECLARES it (`{ passwordChangeAllowed: true }`) rather than merely
 * re-deriving the same "non-null viewer" condition inline, so the scope
 * system actually records the intent instead of a bare boolean hiding it (a
 * prior version of this field did exactly that, which is how the scope went
 * dead in the first place — see the schema-cleanup ledger, task 5). Pothos
 * does not accept both an `authScopes` object and an `authScopes` function on
 * one field, so the extra `viewer.userId !== null` check — refusing the
 * config admin, which owns no user row — is folded into the same function: it
 * returns the scope map only when that check also holds, `false` otherwise —
 * see `builder.ts`'s own comment on this exemption.
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
 * so there is no channel to reissue tokens from here.
 *
 * **Corrected (task-6 review, I-3) — the caller does NOT recover via
 * `/api/auth/refresh`.** `revokeAllForUsername` two lines above deletes
 * EVERY refresh-token row for this username (`TokenStore.
 * revokeAllForUsername`, `services/token-store.ts:71-73`) — including the one
 * the current session's own refresh cookie names. `POST /api/auth/refresh`
 * (`routes/ui.ts:222-262`) therefore finds nothing to consume and 401s
 * (`reject()`, clearing the cookie), it does not "rebuild claims from
 * current DB state" for a caller in this position — that only happens for a
 * refresh token that still exists. The real sequence: the mutation succeeds,
 * the refresh cookie is dead the instant it does, and the caller's *access*
 * token (a stateless JWT, `ACCESS_TOKEN_TTL_SECONDS = 15 * 60`,
 * `services/jwt.ts:3`) keeps its stale `mustChangePassword: true` claim for
 * up to the rest of its 15-minute life — gated out of every `authenticated`-
 * scoped GraphQL field and every REST route behind `passwordChangeGate` for
 * that window, with no path back except logging in again with the new
 * password. This fails CLOSED (strictly more restrictive than staying
 * logged in with a stale claim would be) and is not a security divergence
 * from REST (REST's own reissued cookie is equally unable to invalidate an
 * already-stolen access token) — but it is a real UX one: a client driving
 * password change through this mutation must treat success as "now log the
 * user out and send them to `/login`", not as "silently continue the
 * session." This constraint belongs in Task 10's doc sync for the client's
 * GraphQL change-password flow.
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
    // Declares the type-level gate that `skipTypeScopes` removes (see
    // `builder.ts`'s note on the exemption), AND re-checks `viewer.userId` —
    // Pothos does not accept both an `authScopes` object and an `authScopes`
    // function on one field, so the function form does both jobs: returning
    // the scope map only when the field-level condition also holds. A
    // non-null viewer that owns a user row. The config admin's `userId` is
    // always null — it has no account of its own — so it is refused here, the
    // same outcome the previous `viewer.userId === args.input.userId.id`
    // comparison produced, minus the argument it had to compare against.
    authScopes: (_parent, _args, context) =>
      context.viewer !== null && context.viewer.userId !== null
        ? { passwordChangeAllowed: true }
        : false,
    resolve: async (_parent, args, context) => {
      const parsed = inputSchema.safeParse({
        currentPassword: args.input.currentPassword,
        newPassword: args.input.newPassword,
      });
      if (!parsed.success) return invalidInputError(parsed.error);

      // authScopes already established both are non-null, and the caller is the
      // only account this mutation can ever name.
      const userId = context.viewer!.userId!;
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
