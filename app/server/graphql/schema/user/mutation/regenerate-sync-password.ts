import { UserStore } from '../../../../services/user-store';
import { builder } from '../../builder';
import { model as userModel } from '../model';

/**
 * `userId` only, following `progressSet`'s established shape-consistency
 * precedent (ledger, task 5) — kept for input shape even though the scope
 * below pins it to the caller's own id with no admin path.
 */
const input = builder.inputType('UserRegenerateSyncPasswordInput', {
  fields: (t) => ({
    userId: t.globalID({ required: true, for: userModel }),
  }),
});

type UserRegenerateSyncPasswordPayloadShape = {
  readonly __typename: 'UserRegenerateSyncPasswordPayload';
  readonly userId: string;
  readonly syncPassword: string;
};

const payload = builder
  .objectRef<UserRegenerateSyncPasswordPayloadShape>('UserRegenerateSyncPasswordPayload')
  .implement({
    fields: (t) => ({
      user: t.prismaField({
        type: userModel,
        resolve: (query, parent, _args, context) =>
          context.prisma.user.findUniqueOrThrow({ ...query, where: { id: parent.userId } }),
      }),
      syncPassword: t.exposeString('syncPassword'),
    }),
  });

/**
 * No `resolveType`: the value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 */
const result = builder.unionType('UserRegenerateSyncPasswordResult', { types: [payload] });

/**
 * Single-member union — same reasoning as `userDelete`/`userResetPassword`'s
 * identical note: `input` has exactly one field, a `User` global ID, already
 * format-checked by the relay plugin before this resolver runs, so there is
 * no reachable `InvalidInputError` case. Still declared as a `<Name>Result`
 * union rather than a bare payload type — fabricates nothing, satisfies
 * Task 1's binding rule, keeps a future member non-breaking; see
 * `userDelete`'s doc comment for the full reasoning (task-6 review
 * adjudication).
 *
 * Mirrored REST's `POST /api/my/sync-password/regenerate` (`routes/ui.ts`,
 * that route since removed) — self-service, viewer-only: `req.user!.isAdmin`
 * got a flat 403, and `routes/users.ts` had no admin-write route for sync
 * passwords at all (only `Viewer.syncPassword`, this schema's mirror of
 * REST's `GET /api/my/sync-password`, reads the caller's own), before
 * Phase 0 removed that router. So — like `progressSet` and
 * `userChangePassword` — this deliberately does NOT use
 * the `ownerOf` scope; `userId` is a required input field for shape
 * consistency only, and the scope pins it to exactly the caller.
 *
 * Plain `authenticated`, NOT `passwordChangeAllowed`/`skipTypeScopes`:
 * `middleware/auth.ts`'s `passwordChangeGate` exempts only `/api/login`,
 * `/api/auth/*`, and literally `/api/my/password` — `/api/my/sync-password/
 * regenerate` is not in that list, so REST itself 403s a `mustChangePassword`
 * caller here too (`passwordChangeGate` runs ahead of this route, same as
 * every other `/api/my/*` route). `userChangePassword` is the one and only
 * exemption; see its doc comment for the REST trace.
 *
 * `UserStore.changeSyncPassword` returning `false` (`services/user-store.ts:
 * 176-186`, its own `P2025` catch — the account was deleted mid-request) is
 * modelled as `null`, the same "no such row" convention every other mutation
 * in this schema uses; not wrapped in `toResult` since it throws none of the
 * seven known store errors.
 */
builder.mutationField('userRegenerateSyncPassword', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Regenerates the viewer’s own KOReader/OPDS sync password. Resolves to ' +
      'null in the unlikely case the account was deleted mid-request.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: (_parent, args, context) =>
      context.viewer !== null && context.viewer.userId === args.input.userId.id,
    resolve: async (_parent, args, context) => {
      const userId = args.input.userId.id;
      const username = context.viewer!.username;

      const syncPassword = UserStore.generateSyncPassword();
      const changed = await context.stores.user.changeSyncPassword(username, syncPassword);
      if (!changed) return null;

      return { __typename: 'UserRegenerateSyncPasswordPayload' as const, userId, syncPassword };
    },
  })
);
