import { isMailConfigured } from '../../../../services/mailer';
import {
  listNotificationPreferences,
  NOTIFICATION_CHANNELS,
  setNotificationPreference,
  type NotificationChannel,
  type NotificationEvent,
} from '../../../../services/notification';
import { builder } from '../../builder';
import { model as notificationChannelModel } from '../../notification-channel/model';
import { model as notificationEventModel } from '../../notification-event/model';
import {
  model as notificationPreferenceModel,
  type NotificationPreferenceShape,
} from '../../notification-preference/model';
import { resolveViewerUserId } from './resolve-user-id';

type PayloadShape = {
  readonly __typename: 'ViewerSetNotificationPreferencePayload';
  readonly preferences: readonly NotificationPreferenceShape[];
};

const payload = builder
  .objectRef<PayloadShape>('ViewerSetNotificationPreferencePayload')
  .implement({
    fields: (t) => ({
      notificationPreferences: t.field({
        type: [notificationPreferenceModel],
        resolve: (parent) => [...parent.preferences],
      }),
    }),
  });

/**
 * Turns one notification on or off for the viewer's own account.
 *
 * `null` rather than an error union: there is no failure to report. An upsert
 * on the composite key cannot conflict, and an unknown event or channel is
 * rejected by the enums before a resolver runs. `null` covers the one real
 * case — no account row to key the preference to, which is the
 * `ensureAdminUser` collision an install can be left in.
 *
 * Returns the whole catalogue rather than the one row so a client re-renders
 * from a single authoritative list, exactly as `Viewer.notificationPreferences`
 * serves it.
 */
builder.mutationField('viewerSetNotificationPreference', (t) =>
  t.field({
    type: payload,
    nullable: true,
    description: "Turns one notification on or off for the viewer's own account.",
    args: {
      event: t.arg({ type: notificationEventModel, required: true }),
      channel: t.arg({ type: notificationChannelModel, required: true }),
      enabled: t.arg.boolean({ required: true }),
    },
    resolve: async (_root, args, context) => {
      const userId = await resolveViewerUserId(context);
      if (userId === null) return null;

      await setNotificationPreference(context.prisma, {
        userId,
        event: args.event as NotificationEvent,
        channel: args.channel as NotificationChannel,
        enabled: args.enabled,
      });

      const preferences = await listNotificationPreferences(context.prisma, {
        userId,
        role: context.viewer?.userId == null ? 'admin' : 'reader',
        channels: isMailConfigured(context.config) ? NOTIFICATION_CHANNELS : [],
      });
      return { __typename: 'ViewerSetNotificationPreferencePayload' as const, preferences };
    },
  })
);
