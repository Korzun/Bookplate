import { z } from 'zod';

import type { Owner } from '../../../../types';
import { builder } from '../../builder';
import { invalidInputError, model as invalidInputErrorModel } from '../../invalid-input-error';
import { model as library } from '../../library/model';
import * as user from '../../user/model';

/**
 * Takes a `User` global ID rather than a username, per the spec's rule for
 * every user-associated mutation. `for: user.model` makes the relay plugin
 * reject a global ID of the wrong type at coercion time instead of quietly
 * handing over some other entity's local id.
 */
const input = builder.inputType('ProgressDeleteInput', {
  fields: (t) => ({
    userId: t.globalID({ required: true, for: user.model }),
    document: t.string({ required: true }),
  }),
});

type ProgressDeletePayloadShape = {
  readonly __typename: 'ProgressDeletePayload';
  readonly deletedDocument: string;
  readonly owner: Owner;
};

/**
 * `deletedDocument`, not `deletedId`: `Progress` is deliberately not a `Node`
 * (spec, phase-3 outcome), so it has no global ID to return — and Houdini keys
 * `Progress` on `document` anyway, which is exactly the value its list-removal
 * directives need. `library` is the parent the row was removed from, so a
 * cache can update the `Library.progress` connection without a refetch.
 */
const payload = builder.objectRef<ProgressDeletePayloadShape>('ProgressDeletePayload').implement({
  fields: (t) => ({
    deletedDocument: t.exposeString('deletedDocument'),
    library: t.field({ type: library, resolve: (result) => result.owner }),
  }),
});

/**
 * No `resolveType`: every member value carries its own `__typename` (see
 * `user-error/model.ts`), which graphql-js's `defaultTypeResolver` — Pothos's
 * fallback when a union declares none (`build-cache.js`'s `buildUnion`) —
 * reads first.
 */
const result = builder.unionType('ProgressDeleteResult', {
  types: [payload, invalidInputErrorModel],
});

/**
 * Validated inside the resolver, after auth, never through
 * `@pothos/plugin-validation`'s declarative arg option — see
 * `invalid-input-error/model.ts` for why that option is off limits.
 *
 * `min(1)` and nothing more, deliberately: REST's `DELETE
 * /api/my/progress/:document` applies no validation at all, and an empty
 * document is the one input it structurally cannot receive (Express would not
 * match the route). A whitespace-only document is therefore NOT rejected here
 * — REST would pass it to the store, match no row, and answer 404, which is
 * exactly what this mutation does with it.
 */
const inputSchema = z.object({
  document: z.string().min(1, 'document must not be empty'),
});

/**
 * Mirrors two REST routes at once, which is why it takes a `userId` rather
 * than acting on the viewer implicitly:
 *
 *  - `DELETE /api/my/progress/:document` (`routes/ui.ts:317-334`) — `requireAuth`,
 *    403 for an admin (who has no library), otherwise the caller's own row.
 *  - `DELETE /api/users/:username/progress/:document` (`routes/users.ts:55-74`) —
 *    `requireAuth` + `adminAuth`, any named user's row.
 *
 * The `ownerOf` scope is the union of those two rules (`isOwnerOrAdmin`), so
 * the GraphQL field covers both without inheriting REST's split. The one
 * intentional loosening: REST's `/api/my/` route 403s an admin, because an
 * admin has no `userId` of their own to substitute; here an admin must name
 * the user, so there is nothing to substitute and nothing to refuse.
 *
 * Both routes answer 404 when the row is absent. That is modelled as a null
 * result rather than a typed error: absence is not a domain failure a client
 * acts on, the spec's error model is an exhaustive list that contains no
 * not-found member, and adding one here would oblige every later delete
 * mutation to invent its own. Nulling matches how this schema already reports
 * "no such row" everywhere else (`Library.book`, `Query.user`, node guards).
 *
 * `UserStore.clearProgress` is NOT wrapped in `toResult`: it throws none of
 * the seven known store errors (it already converts Prisma's P2025 into
 * `false`), so the `err` branch would be unreachable and could only be
 * discharged by throwing — the very thing `toResult` exists to prevent.
 * Mutations whose store call can raise a known error must wrap it; see
 * `graphql/to-result.ts`.
 */
builder.mutationField('progressDelete', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Clears one stored reading position. Resolves to null when the user has ' +
      'no stored position for that document.',
    args: { input: t.arg({ type: input, required: true }) },
    // Relay sits outside scope-auth in the plugin order (see builder.ts), so
    // the global ID is already parsed by the time this runs.
    authScopes: (_parent, args) => ({ ownerOf: args.input.userId.id }),
    resolve: async (_parent, args, context) => {
      const parsed = inputSchema.safeParse({ document: args.input.document });
      if (!parsed.success) return invalidInputError(parsed.error);

      const userId = args.input.userId.id;
      const owner = await context.loadOwner(userId);
      if (owner === null) return null;

      const cleared = await context.stores.user.clearProgress(userId, parsed.data.document);
      if (!cleared) return null;

      return {
        __typename: 'ProgressDeletePayload' as const,
        deletedDocument: parsed.data.document,
        owner,
      };
    },
  })
);
