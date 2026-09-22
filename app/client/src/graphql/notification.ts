import { graphql } from '~/gql';

/**
 * One row per (event, channel). The server already filters this list by the
 * viewer's audience (e.g. only an admin ever sees `BOOK_REQUEST_CREATED`)
 * and returns an empty list when no channel is configured for this install —
 * `component/notification-settings` renders exactly what it is handed and
 * encodes none of that itself, so a second channel (web push) becomes
 * another row per event rather than a rewrite of this fragment or its
 * consumer.
 */
export const NotificationPreferenceFragment = graphql(`
  fragment NotificationPreferenceFragment on NotificationPreference {
    event
    channel
    enabled
  }
`);

/**
 * Returns `null` when the viewer has no account row to persist a preference
 * against (the config-based admin) — `component/notification-settings`
 * treats that the same as any other failure and surfaces a toast rather than
 * assuming a shape. On success the payload carries the FULL, authoritative
 * list (not just the row that changed), so the caller can write it straight
 * onto `Viewer.notificationPreferences` via `cache.modify` instead of
 * refetching.
 *
 * Selects `event`/`channel`/`enabled` directly rather than spreading
 * `NotificationPreferenceFragment`: `NotificationPreference` has no `id`
 * field to normalize by, so spreading the fragment here would buy no cache
 * benefit — only a masked reference the caller would immediately have to
 * unmask again for no gain. That fragment exists for the PROP boundary into
 * `component/notification-settings` instead (mirroring `ConnectionUrlsFragment`'s
 * own reasoning), and this mutation's own concrete-field selection matches
 * `graphql/email.ts`'s established shape for a mutation payload consumed
 * only locally.
 */
export const ViewerSetNotificationPreferenceDocument = graphql(`
  mutation ViewerSetNotificationPreference(
    $event: NotificationEvent!
    $channel: NotificationChannel!
    $enabled: Boolean!
  ) {
    viewerSetNotificationPreference(event: $event, channel: $channel, enabled: $enabled) {
      notificationPreferences {
        event
        channel
        enabled
      }
    }
  }
`);
