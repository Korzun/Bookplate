import { builder } from '../../builder';
import { model as viewer } from '../../viewer';

/**
 * Mirrors `GET /api/my/sync-password` (`routes/ui.ts`): `requireAuth`, then
 * `403` for an admin session, then `userStore.getSyncPassword(username)` for
 * the requesting user's *own* account — there is no route, and no field here,
 * that reads another user's sync password.
 *
 * Registered from `user/` rather than `viewer/model.ts` because this is
 * `User.syncPassword` the column, read through `UserStore`; `user/model.ts`'s
 * own comment records that `passwordHash`/`syncPassword` are deliberately
 * absent from the `User` node and exposed on `Viewer` only. This file is the
 * "only".
 *
 * REST's `403` for an admin becomes `null` rather than a `FORBIDDEN` error:
 * the field is a property of a viewer that has a user row, and the
 * config-based admin has none (its `viewer.userId` is null), exactly like
 * `Viewer.library`. Erroring would make `{ viewer { username syncPassword } }`
 * fail wholesale for an admin instead of answering the parts that apply.
 * `isAdmin` is the condition REST branches on and is what is reproduced here;
 * for this codebase it coincides with `userId === null`, since admin status
 * comes only from the config-based account, which has no row.
 *
 * NOTE — this read has a write side effect, inherited from
 * `UserStore.getSyncPassword`: a user whose `sync_password` column is still
 * null gets one generated and persisted on first read. That is REST's
 * behaviour today (the KOSync credential is created lazily on first view), and
 * reproducing it is the point — a GraphQL client and the REST client must not
 * disagree about whether a user has a sync password.
 */
builder.objectField(viewer, 'syncPassword', (t) =>
  t.string({
    nullable: true,
    resolve: (v, _args, context) =>
      v.isAdmin ? null : context.stores.user.getSyncPassword(v.username),
  })
);
