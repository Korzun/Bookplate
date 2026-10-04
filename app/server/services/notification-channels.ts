/**
 * Which channels this install can actually deliver on, for the two GraphQL
 * call sites that build a preference catalogue (`Viewer.notificationPreferences`
 * and `viewerSetNotificationPreference`, which must agree or a toggle would
 * write a row for a channel the list never showed).
 *
 * Push is offered UNCONDITIONALLY: it needs no server configuration, since the
 * VAPID keys generate themselves. Whether the viewer's BROWSER can act on it —
 * Web Push requires a secure context, and iOS additionally requires a
 * Home-Screen install — is a client-side question, answered by feature
 * detection in `lib/push.ts`. The server has no way to know how a given user
 * reached it, and guessing from a request header is the same mistake
 * `AppConfig.publicUrl` exists to avoid.
 */
import type { AppConfig } from '../types';
import { isMailConfigured } from './mailer';
import type { NotificationChannel } from './notification';

export function configuredChannels(
  config: Pick<AppConfig, 'mail'>
): readonly NotificationChannel[] {
  return isMailConfigured(config) ? (['email', 'push'] as const) : (['push'] as const);
}
