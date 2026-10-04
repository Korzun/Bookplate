import type { NotificationChannel, NotificationEvent } from '../../../services/notification';
import { builder } from '../builder';
import { model as notificationChannelModel } from '../notification-channel/model';
import { model as notificationEventModel } from '../notification-event/model';

/**
 * An `objectRef` over a plain shape, NOT a `prismaObject`: the catalogue this
 * type is returned in includes preferences that have no row at all (an absent
 * row means enabled — see the Prisma model), so there is no row to hand a
 * `prismaObject` field.
 */
export type NotificationPreferenceShape = {
  readonly event: NotificationEvent;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
};

export const model = builder
  .objectRef<NotificationPreferenceShape>('NotificationPreference')
  .implement({
    description: 'Whether one notification event reaches this account on one channel.',
    fields: (t) => ({
      event: t.field({ type: notificationEventModel, resolve: (p) => p.event }),
      channel: t.field({ type: notificationChannelModel, resolve: (p) => p.channel }),
      enabled: t.boolean({ resolve: (p) => p.enabled }),
    }),
  });
