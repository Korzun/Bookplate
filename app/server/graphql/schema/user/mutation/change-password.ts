import { z } from 'zod';

import { changePassword, hashLoginPassword, validateUser } from '../../../../services/password';
import { revokeAllForUsername } from '../../../../services/token';
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
 * fields (`routes/ui.ts`, removed in `e67b4ad9`), which likewise named no user
 * — REST read the identity off the session, as this now does.
 */
const input = builder.inputType('UserChangePasswordInput', {
  fields: (t) => ({
    currentPassword: t.string({ required: true }),
    newPassword: t.string({ required: true }),
  }),
});

/**
 * REST checks both fields with one combined guard and one combined message
 * (`routes/ui.ts`, removed in `e67b4ad9`: `!currentPassword || !newPassword` →
 * "Current and new password are required") — reproduced on both fields here
 * rather than a single object-level check, so each empty field gets its own
 * `issues` entry (a client can highlight the specific empty box), while the
 * message text itself stays identical to REST's.
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
 * that router. So — like `progressSet`
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
 * This is the ONE exemption in the schema, and nothing may join it casually.
 * Now that the REST self-service route is retired, this mutation is the only
 * path a `mustChangePassword` viewer has to clear the flag, so relaxing
 * `authenticated` anywhere else would only widen what a locked-out caller can
 * do without moving them any closer to being unlocked.
 * `userRegenerateSyncPassword` is the case in point: rotating a sync password
 * does not clear the flag, so it stays on the ordinary `authenticated` scope
 * and refuses such a caller.
 *
 * REST's own gate carried the mirror of this exemption until `e67b4ad9`
 * removed `PATCH /api/my/password` and left `passwordChangeGate`
 * (`middleware/auth.ts`) naming a path that reaches no route; the entry has
 * since been dropped. That decision was taken on its merits, not as a doc
 * fix: its one visible effect falls on the dead path alone, where a
 * `mustChangePassword` caller now gets 403 instead of the JSON 404
 * `79021b3d` added — which is precisely what every OTHER dead `/api/*` path
 * already answered such a caller, so it retired an inconsistency rather than
 * introducing one (`middleware/auth.test.ts` pins it). The precedent the
 * exemption recorded for THIS mutation is unaffected either way.
 *
 * The 401 REST returned for a wrong `currentPassword` (`routes/ui.ts`, removed
 * in `e67b4ad9`, `validateUser` returning `false` — never a throw, see
 * `services/password.ts`) is modelled as the honest `IncorrectPasswordError`,
 * not folded into `InvalidInputError` — see that type's doc comment.
 *
 * `changePassword` returning `false` (`services/password.ts`,
 * its own `P2025` catch — the account was deleted between token issuance and
 * this request) is modelled as `null`, the same "no such row" convention
 * every other mutation in this schema uses; genuinely unreachable through
 * this mutation's own auth path in practice (the scope just proved the
 * caller's own row exists), but REST's branch is real and this is its
 * mirror, not an invented case. Neither `validateUser` nor `changePassword`
 * (both plain functions in `services/password.ts`) is wrapped in
 * `toResult`: neither throws any of the seven known domain errors.
 *
 * `revokeAllForUsername`, imported directly from `services/token.ts` (a
 * plain function over `context.prisma` — no class instance to thread
 * through `Context`), mirrors the identical call REST's
 * `PATCH /api/my/password` made on success. That route also reissued tokens
 * (`issueTokens`, `routes/ui.ts`, removed in `e67b4ad9`) so the client's
 * existing cookies immediately carry `mustChangePassword: false` — this
 * resolver does NOT reproduce that half: yoga's context (`graphql/context.ts`'s
 * `createContext`) only ever sees the fetch `Request`, never a `Response` to
 * set cookies on, so there is no channel to reissue tokens from here.
 *
 * **Corrected (task-6 review, I-3) — the caller does NOT recover via
 * `/api/auth/refresh`.** `revokeAllForUsername` two lines above deletes
 * EVERY refresh-token row for this username (`services/token.ts`'s
 * `revokeAllForUsername`) — including the one the current session's own
 * refresh cookie names. `POST /api/auth/refresh`
 * (`routes/ui.ts`) therefore finds nothing to consume and 401s
 * (`reject()`, clearing the cookie), it does not "rebuild claims from
 * current DB state" for a caller in this position — that only happens for a
 * refresh token that still exists. The real sequence: the mutation succeeds,
 * the refresh cookie is dead the instant it does, and the caller's *access*
 * token (a stateless JWT, `ACCESS_TOKEN_TTL_SECONDS = 15 * 60`,
 * `services/jwt.ts`) keeps its stale `mustChangePassword: true` claim for
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

      const valid = await validateUser(context.prisma, username, parsed.data.currentPassword);
      if (!valid) return incorrectPasswordError();

      const newHash = await hashLoginPassword(parsed.data.newPassword);
      const changed = await changePassword(context.prisma, username, newHash);
      if (!changed) return null;

      await revokeAllForUsername(context.prisma, username);

      return { __typename: 'UserChangePasswordPayload' as const, userId };
    },
  })
);
