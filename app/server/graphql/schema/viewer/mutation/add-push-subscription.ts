import {
  listPushSubscriptionRows,
  upsertPushSubscription,
} from '../../../../services/push-subscription';
import { builder } from '../../builder';
import { model as pushSubscriptionModel } from '../../push-subscription/model';
import { resolveViewerUserId } from './resolve-user-id';

/**
 * Registers the calling browser for push, or re-registers it.
 *
 * Called on every app load, not only when the switch is flipped: push
 * endpoints rotate, and a browser that believes it is subscribed while the
 * server has no row for it receives nothing and reports no error. The upsert
 * keys on `endpoint`, so re-running it is free.
 *
 * `null` rather than an error union, matching `viewerSetNotificationPreference`:
 * the only failure is having no account row to key the subscription to, which
 * is the `ensureAdminUser` collision an install can be left in.
 */
builder.mutationField('viewerAddPushSubscription', (t) =>
  t.field({
    type: pushSubscriptionModel,
    nullable: true,
    description: 'Registers the calling browser to receive push notifications.',
    args: {
      endpoint: t.arg.string({ required: true }),
      p256dh: t.arg.string({ required: true }),
      auth: t.arg.string({ required: true }),
      label: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, context) => {
      const userId = await resolveViewerUserId(context);
      if (userId === null) return null;

      const { id } = await upsertPushSubscription(context.prisma, {
        userId,
        endpoint: args.endpoint,
        p256dh: args.p256dh,
        auth: args.auth,
        label: args.label,
      });
      const rows = await listPushSubscriptionRows(context.prisma, userId);
      return rows.find((row) => row.id === id) ?? null;
    },
  })
);
