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
 * `NotificationPreferenceFragment`: that fragment exists for the PROP
 * boundary into `component/notification-settings` (mirroring
 * `ConnectionUrlsFragment`'s own reasoning), and `NotificationPreference` has
 * no `id` field to normalize by, so spreading it here would buy no cache
 * benefit — only a masked reference the same component would immediately
 * have to unmask again. Fine detail, but see codegen's generated
 * `useFragment`: it is `' $fragmentRefs'`-masked at the TYPE level even
 * though masking is off at runtime, and it enforces React's hook-call rules
 * by name, so it cannot be invoked from inside the mutation's own callback.
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
