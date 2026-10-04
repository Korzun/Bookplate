import type { SubscriptionRow } from '../../../services/push-subscription';
import { builder } from '../builder';

/**
 * One browser subscribed to push for this account.
 *
 * An `objectRef` over the storage layer's `SubscriptionRow`, NOT a
 * `prismaObject`, for one reason: the Prisma row carries `endpoint`, `p256dh`
 * and `auth`, and a `prismaObject` would make exposing them a one-line
 * mistake. A push endpoint is a bearer capability URL — anyone holding it plus
 * the keys can send to that device — so this type is built over a shape that
 * does not contain them at all.
 *
 * `label` is derived client-side from the user agent ("Chrome on macOS"). It
 * is a hint for a human choosing which device to revoke, not an identity, and
 * is deliberately not user-editable.
 */
export const model = builder.objectRef<SubscriptionRow>('PushSubscription').implement({
  description: 'One browser subscribed to push notifications for this account.',
  fields: (t) => ({
    id: t.id({ resolve: (row) => row.id }),
    label: t.string({ resolve: (row) => row.label }),
    createdAt: t.float({ resolve: (row) => row.createdAt }),
    lastSuccessAt: t.float({
      nullable: true,
      description:
        'When a notification last reached this browser. Null means it has never received one.',
      resolve: (row) => row.lastSuccessAt,
    }),
  }),
});
