import { deletePushSubscription } from '../../../../services/push-subscription';
import { builder } from '../../builder';
import { resolveViewerUserId } from './resolve-user-id';

/**
 * Removes one of the viewer's own subscribed browsers.
 *
 * Takes the row `id`, not the endpoint, because the endpoint is never returned
 * to a client in the first place (`push-subscription/model.ts`). Ownership is
 * enforced in the delete's WHERE clause rather than by a read-then-check, so
 * there is no window between the two.
 *
 * `false` means "no such row of yours", which covers both a wrong id and
 * another account's — deliberately indistinguishable.
 */
builder.mutationField('viewerRemovePushSubscription', (t) =>
  t.boolean({
    description: "Removes one of the viewer's subscribed browsers.",
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_root, args, context) => {
      const userId = await resolveViewerUserId(context);
      if (userId === null) return false;
      return deletePushSubscription(context.prisma, { userId, id: String(args.id) });
    },
  })
);
