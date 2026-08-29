import { decodeGlobalID, encodeGlobalID } from '@pothos/plugin-relay';

import { clearProgress } from '../../../../services/progress';
import type { Owner } from '../../../../types';
import { builder } from '../../builder';
import { model as library } from '../../library/model';
import { NO_MATCH_USER_ID, parseCompoundId } from '../../node-scope';
import { model as user } from '../../user/model';

/**
 * One opaque `Progress` global ID, replacing the `(userId, document)` pair.
 * The owner rides inside the id — the same collapse the book-relay-id plan
 * applied to all ten book mutations — so the scope decodes and authorizes it
 * with `isOwnerOrAdmin` rather than taking the caller's word for an owner.
 *
 * Plain `t.id`, not `t.globalID({ for: ... })`: `Progress` is deliberately
 * NOT a `Node` (see `progress/model.ts`), so there is no registered type to
 * validate the incoming global ID's `Progress:` prefix against at the relay
 * arg layer the way `book.ts`'s `t.globalID({ for: book })` does — `for`
 * requires a Node-implementing type, which `Progress` deliberately is not.
 * Because of that, `args.input.id` arrives here as the RAW base64 global id
 * string, not a pre-stripped local part the way `t.globalID` hands
 * `args.input.id.id` to the book mutations — `decodeProgressId` below does
 * both jobs (`decodeGlobalID` plus the typename check) that `t.globalID`
 * would otherwise have done at the arg layer.
 */
const input = builder.inputType('ProgressDeleteInput', {
  fields: (t) => ({
    id: t.id({ required: true }),
  }),
});

/**
 * Mirrors what `t.globalID({ for: model })` does for the book mutations —
 * decode the base64 wrapper, reject anything not typed `Progress` — plus the
 * compound-key split `parseCompoundId` does for every owner-scoped node.
 * Unlike `t.globalID`, none of this runs at the relay arg layer (no `for`
 * possible here — see the input's own doc comment), so malformed input
 * (bad base64, no `:`, wrong typename, or a local part that isn't the
 * `[userId, document]` pair) must be caught here rather than left to throw:
 * `decodeGlobalID` throws `PothosValidationError` on a structurally invalid
 * global id, and an uncaught throw here would surface as a 500 instead of
 * this schema's uniform "no such row" convention. Every failure mode
 * collapses to `null`, same as a genuinely missing row and same as
 * `parseCompoundId`'s own `null` — a malformed or foreign id must not be
 * distinguishable from an absent one to a probing caller.
 */
const decodeProgressId = (raw: string): readonly [userId: string, document: string] | null => {
  let decoded: { typename: string; id: string };
  try {
    decoded = decodeGlobalID(raw);
  } catch {
    return null;
  }
  if (decoded.typename !== 'Progress') return null;
  return parseCompoundId(decoded.id);
};

type ProgressDeletePayloadShape = {
  readonly __typename: 'ProgressDeletePayload';
  readonly deletedId: string;
  readonly owner: Owner;
};

/**
 * `deletedId`, not `deletedDocument`: `Progress` now carries a global ID
 * (Task 1), so a normalized cache evicts by `cache.identify({ __typename:
 * 'Progress', id })` and needs nothing else. This follows the precedent set
 * when `BookDeletePayload.deletedBookId` was removed — the only consumer of
 * this schema is the in-repo client, and a raw-key field beside a global ID
 * served no one.
 */
const payload = builder.objectRef<ProgressDeletePayloadShape>('ProgressDeletePayload').implement({
  fields: (t) => ({
    deletedId: t.exposeID('deletedId'),
    library: t.field({ type: library, resolve: (result) => result.owner }),
    // `progressDelete` IS admin-capable (`isOwnerOrAdmin`, above) — `owner`
    // here is the DECODED owner the input id carried, not necessarily the
    // caller, so this resolves the row's actual OWNER, never the admin who
    // issued the delete. That is exactly why this field exists server-side
    // rather than as a client-side counter decrement (I-2): a client-side
    // tweak to "the viewer's own User" would decrement the wrong person's
    // count when an admin deletes someone else's row. Same resolver shape
    // as `ProgressSetPayload.user` / `Library.user`.
    user: t.field({
      type: user,
      resolve: (result, _args, context) =>
        context.prisma.user.findUniqueOrThrow({ where: { id: result.owner.userId } }),
    }),
  }),
});

/**
 * Single-member union, not a bare payload type: additive-safe if a future
 * error case needs a member (spec 1's single-member-union precedent).
 *
 * No `InvalidInputError` member: `document` was this file's only
 * zod-validated field, and it is gone now that both halves of the old input
 * arrive folded into the `Progress` global ID — malformed/wrong-type
 * rejection of THAT happens in this resolver's own `decodeProgressId` call,
 * which resolves to the same `null` ("no such row") convention a genuinely
 * missing row does, exactly like `bookResolvePendingFix`'s identical drop
 * (see that file's result-union doc comment). With no zod schema left in
 * this file to make `InvalidInputError` reachable, the traced-union-drop
 * rule (`book-relay-id-design.md`'s "Discovered consequence") requires
 * dropping it here too.
 *
 * No `resolveType`: the one member value carries its own `__typename` (see
 * `user-error/model.ts`), which graphql-js's `defaultTypeResolver` reads
 * first.
 */
const result = builder.unionType('ProgressDeleteResult', {
  types: [payload],
});

/**
 * Mirrored two REST routes at once, which is why it takes an id that can
 * name ANY user's row rather than acting on the viewer implicitly:
 *
 *  - `DELETE /api/my/progress/:document` (`routes/ui.ts`, removed earlier,
 *    in `e67b4ad9`) — `requireAuth`, 403 for an admin (who has no library),
 *    otherwise the caller's own row.
 *  - `DELETE /api/users/:username/progress/:document` (`routes/users.ts`,
 *    removed in Phase 0) — `requireAuth` + `adminAuth`, any named user's row.
 *
 * The `ownerOf` scope was the union of those two rules (`isOwnerOrAdmin`), so
 * the GraphQL field covers both without inheriting REST's split. The one
 * intentional loosening: REST's `/api/my/` route 403ed an admin, because an
 * admin had no `userId` of their own to substitute; here an admin must pass a
 * `Progress` id naming some user, so there is nothing to substitute and
 * nothing to refuse.
 *
 * Input is the `Progress` global ID alone (mirroring the ten book mutations'
 * input collapse), decoded by `decodeProgressId` above into the same
 * `NO_MATCH_USER_ID` convention `bookDelete`'s `parseCompoundId` call uses —
 * see that file's resolver doc comment for the full malformed-id /
 * wrong-type-id reasoning, which applies here unchanged. A foreign id (a real
 * row, but not the caller's, and the caller is not an admin) is refused by
 * the SAME `ownerOf` scope a malformed id is, so the two are indistinguishable
 * to a probing caller — neither reaches the resolver.
 *
 * Both routes answer 404 when the row is absent. That is modelled as a null
 * result rather than a typed error: absence is not a domain failure a client
 * acts on, the spec's error model is an exhaustive list that contains no
 * not-found member, and adding one here would oblige every later delete
 * mutation to invent its own. Nulling matches how this schema already reports
 * "no such row" everywhere else (`Library.book`, `Query.user`, node guards) —
 * including a malformed/foreign id, per this file's own convention above.
 *
 * `clearProgress` (`services/progress.ts`) is NOT wrapped in
 * `toResult`: it throws none of the seven known domain errors (it already
 * converts Prisma's P2025 into `false`), so the `err` branch would be
 * unreachable and could only be discharged by throwing — the very thing
 * `toResult` exists to prevent. Mutations whose domain call can raise a
 * known error must wrap it; see `graphql/to-result.ts`.
 */
builder.mutationField('progressDelete', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Clears one stored reading position. Resolves to null when the user has ' +
      'no stored position for that document.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: (_parent, args) => {
      const parsed = decodeProgressId(args.input.id);
      return { ownerOf: parsed === null ? NO_MATCH_USER_ID : parsed[0] };
    },
    resolve: async (_parent, args, context) => {
      const parsed = decodeProgressId(args.input.id);
      if (parsed === null) return null; // admin passed scope on a malformed id: same "no such row" convention
      const [userId, document] = parsed;
      const owner = await context.loadOwner(userId);
      if (owner === null) return null;

      const cleared = await clearProgress(context.prisma, userId, document);
      if (!cleared) return null;

      return {
        __typename: 'ProgressDeletePayload' as const,
        deletedId: encodeGlobalID('Progress', JSON.stringify([userId, document])),
        owner,
      };
    },
  })
);
