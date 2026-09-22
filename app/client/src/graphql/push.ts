import { graphql } from '~/gql';

/**
 * One subscribed browser. No endpoint and no keys are selectable — the server
 * does not expose them (`graphql/schema/push-subscription/model.ts`), because
 * a push endpoint is a bearer capability URL. The client identifies THIS
 * browser by the `id` the add mutation returned, kept in `localStorage`.
 */
export const PushSubscriptionFragment = graphql(`
  fragment PushSubscriptionFragment on PushSubscription {
    id
    label
    createdAt
    lastSuccessAt
  }
`);

/**
 * Run on every app load, not only when the switch is flipped — endpoints
 * rotate, and the server upserts on the endpoint, so re-running it is free.
 * Returns `null` when the viewer has no account row to key a subscription to.
 *
 * Spreads `PushSubscriptionFragment` rather than re-listing its fields:
 * unlike `graphql/notification.ts`'s `ViewerSetNotificationPreferenceDocument`
 * mutation (which selects concrete fields because `NotificationPreference`
 * has no `id` to normalize by), `PushSubscription` does have an `id`. Apollo's
 * cache normalizes the returned object by that id, so spreading the fragment
 * here actually buys the cache benefit that mutation's comment says its own
 * type can't get, and keeps this payload's shape in one place with the
 * bootstrap query's own selection below.
 */
export const ViewerAddPushSubscriptionDocument = graphql(`
  mutation ViewerAddPushSubscription(
    $endpoint: String!
    $p256dh: String!
    $auth: String!
    $label: String!
  ) {
    viewerAddPushSubscription(endpoint: $endpoint, p256dh: $p256dh, auth: $auth, label: $label) {
      ...PushSubscriptionFragment
    }
  }
`);

export const ViewerRemovePushSubscriptionDocument = graphql(`
  mutation ViewerRemovePushSubscription($id: ID!) {
    viewerRemovePushSubscription(id: $id)
  }
`);
