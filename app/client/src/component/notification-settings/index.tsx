import { useApolloClient, useMutation } from '@apollo/client/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Card } from '~/component';
import { Switch } from '~/control';
import { type FragmentType, useFragment } from '~/gql';
import type { NotificationChannel, NotificationEvent } from '~/gql/graphql';
import {
  NotificationPreferenceFragment,
  ViewerSetNotificationPreferenceDocument,
} from '~/graphql/notification';
import { PushSubscriptionFragment, ViewerRemovePushSubscriptionDocument } from '~/graphql/push';
import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import { LOCAL_SUBSCRIPTION_ID, unsubscribeFromPush } from '~/lib/push';
import { useToast } from '~/provider/toast';

import { useStyle } from './style';
import { usePushDevice } from './use-push-device';

const EVENT_LABEL: Record<NotificationEvent, string> = {
  BOOK_REQUEST_CREATED: 'A reader requests a book',
  BOOK_REQUEST_FULFILLED: 'A book I requested is added to my library',
  BOOK_REQUEST_DECLINED: 'A book I requested is declined',
};

/** Distinguishes the two identically-labelled-by-event rows a second channel adds. */
const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  EMAIL: 'Email',
  PUSH: 'Push',
};

const rowKey = (event: NotificationEvent, channel: NotificationChannel) => `${event}:${channel}`;

export type NotificationSettingsProps = {
  /**
   * The server's catalogue: already filtered to this viewer's audience
   * (e.g. only an admin ever sees `BOOK_REQUEST_CREATED`) and empty when
   * this install has no channel configured. Rendered GROUPED BY EVENT —
   * one row per entry the server returns — rather than one hardcoded
   * toggle per known event, so a second channel becomes another row here
   * instead of a rewrite.
   */
  preferences: readonly FragmentType<typeof NotificationPreferenceFragment>[];
  emailVerified: boolean;
  /**
   * The VAPID public key this install signs push subscriptions with, handed
   * to `usePushDevice`, which passes it straight through to
   * `subscribeToPush`/`resyncSubscription` (`~/lib/push`). `page/user`
   * falls back to `''` before `ViewerBootstrapDocument` resolves; an empty
   * key simply makes `subscribeToPush` fail, the same as any other failure
   * that function already handles.
   */
  pushPublicKey: string;
  /**
   * This viewer's subscribed browsers, rendered as the device list below the
   * matrix. Masked like `preferences`; unmasked with
   * `useFragment(PushSubscriptionFragment, ...)`.
   */
  pushSubscriptions: readonly FragmentType<typeof PushSubscriptionFragment>[];
};

/**
 * `page/user`'s notifications card. `preferences`/`emailVerified` are handed
 * down as props (`page/user` reads them off `ViewerBootstrapDocument`,
 * mirroring `component/email-setting`) rather than fetched here directly —
 * this component's own job is the toggle mutation, not the read, and it
 * holds no PERSISTENT local copy of the list: absent a mutation of its own in
 * flight, each row's `checked` is `row.enabled`, full stop.
 *
 * A successful toggle writes the mutation's returned list — the FULL,
 * authoritative state, not just the changed row — onto `Viewer.notificationPreferences`
 * via `cache.modify` (`component/sync-password` takes the identical approach
 * for `Viewer.syncPassword`). That write relies on `page/user`'s own
 * `useQuery(ViewerBootstrapDocument)` being an ACTIVE watched query, which
 * reacts to the cache write and re-renders this component with a fresh
 * `preferences` prop, the same way any other cache write (a mutation, a
 * refetch, `EmailSetting`'s own `client.refetchQueries`) would.
 *
 * The one piece of local state is `pending`: the row a click just fired a
 * mutation for shows the value the click asked for immediately, rather than
 * waiting out the round trip, and that value is cleared the instant its own
 * mutation settles — success or error — never lingering past the request it
 * was for. This is deliberately NOT the `overrides` map that was tried here
 * before and removed: that one copied EVERY row from every response and was
 * never cleared, so it stopped tracking the prop at all and could win over a
 * LATER refetch that lands genuinely fresher data (e.g. `EmailSetting`
 * refetching `ViewerBootstrapDocument` after a save). `pending` cannot go
 * stale that way because it holds at most the one row currently in flight and
 * disappears the moment that row's mutation resolves; on success the fresh
 * prop and the cleared `pending` entry agree, and on error the switch reverts
 * to the server's last known value. A row with an entry in `pending` also
 * cannot fire a second mutation until the first settles.
 *
 * `mountedRef` guards only the `setPending` clear in `handleToggle`'s
 * `finally`, not the `cache.modify` write or the error toast above it: a
 * reader can toggle a row and navigate off the account page before the
 * mutation settles (unmounting this component), and when it settles later
 * both of those should still happen — the cache write keeps the Viewer
 * singleton correct for when the reader comes back, and the toast is global
 * (`ToastProvider` wraps the whole app, not this card). Only the local
 * `pending` state has nowhere left to go, so only it is skipped.
 *
 * This device's own push subscription lifecycle — support/permission,
 * whether IT is currently subscribed, and the switch that flips that — is a
 * second, self-contained concern this component does not hold itself; see
 * `usePushDevice`.
 */
export const NotificationSettings = ({
  preferences,
  emailVerified,
  pushPublicKey,
  pushSubscriptions,
}: NotificationSettingsProps) => {
  const style = useStyle();
  const showToast = useToast();
  const client = useApolloClient();
  const rows = useFragment(NotificationPreferenceFragment, preferences);
  const devices = useFragment(PushSubscriptionFragment, pushSubscriptions);

  const [setPreference] = useMutation(ViewerSetNotificationPreferenceDocument);
  const [removeSubscription] = useMutation(ViewerRemovePushSubscriptionDocument);

  /**
   * Keyed by `rowKey`. A row present here has a mutation in flight and shows
   * this value instead of `row.enabled`; the entry is removed in every
   * settlement path (success, server error, or thrown error) so it can never
   * outlive the request it was created for. See the file header for why this
   * is scoped to the one row in flight rather than a copy of the whole list.
   */
  const [pending, setPending] = useState<Partial<Record<string, boolean>>>({});

  const { subscribed, support, permission, hint, toggle, markUnsubscribed } =
    usePushDevice(pushPublicKey);

  const mountedRef = useRef(true);
  useEffect(() => {
    // Set on EVERY mount, not just initialised once at `useRef(true)`.
    // `main.tsx` wraps the app in `<StrictMode>`, which in development runs
    // effects mount -> cleanup -> mount against the same hook state: without
    // this line the cleanup's `false` is never undone, so `handleToggle`'s
    // `finally` skips clearing `pending`, the row's key stays there forever,
    // and `if (key in pending) return` silently swallows every later click on
    // that row. Reported from real use as "the toggle only works once; I have
    // to refresh to use it again" — and it still SAVED each time, because
    // neither the mutation nor the `cache.modify` write sits behind this ref.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // "This device" is never the id the server returns rows keyed by — the
  // endpoint itself is never exposed to the client (`PushSubscriptionFragment`'s
  // own doc comment) — but the add mutation's OWN return value, kept in
  // `localStorage` under this key ever since. A plain `localStorage.getItem`
  // read, not hook state: it only needs to be current at REMOVE time, and
  // reading it fresh here means a remove immediately after this browser's own
  // subscribe (same render cycle notwithstanding) still sees the right value.
  const localId = localStorage.getItem(LOCAL_SUBSCRIPTION_ID);

  /**
   * Removing THIS device must also unsubscribe the browser, not just delete
   * the server row — otherwise the row would be silently re-created by the
   * next load's re-sync (`usePushDevice`'s own load effect), which cannot
   * tell "the reader removed this on purpose" apart from "this browser lost
   * its subscription by accident" (the exact case it exists to repair).
   * Removing another device must not touch this browser's own subscription
   * at all, hence the `id === localId` guards on both ends.
   *
   * `client.refetchQueries` (not a cache eviction): removing an entity from
   * an Apollo list requires updating whatever field held the array — a
   * plain `cache.evict` orphans the object but leaves stale refs in
   * `viewer.pushSubscriptions` behind, the same reasoning `syncPushSubscription`
   * (`use-push-device.ts`) already uses for the add path.
   */
  const handleRemove = useCallback(
    async (id: string) => {
      try {
        if (id === localId) await unsubscribeFromPush();
        await removeSubscription({ variables: { id } });
        if (id === localId) markUnsubscribed();
        await client.refetchQueries({ include: [ViewerBootstrapDocument] });
      } catch {
        // Deliberately NOT a revert, unlike `toggle`'s own branches
        // (`usePushDevice`): if `unsubscribeFromPush()` above succeeded and
        // THEN `removeSubscription` rejected, the browser is genuinely
        // unsubscribed while `subscribed`/`localId` still claim otherwise,
        // until the next load's re-sync corrects it. That is the identical
        // double-failure shape `toggle`'s own OFF branch already accepts —
        // it too calls `unsubscribeFromPush()` before its mutation and, on
        // that mutation rejecting, reverts to "subscribed" rather than
        // reconciling with a browser that may already be unsubscribed (see
        // its own comment). Same trade-off, same self-healing-on-reload —
        // not a gap to close here. Do not "fix" this into a revert without
        // re-reading that comment first.
        showToast('Could not remove that device', 'error');
      }
    },
    [client, localId, markUnsubscribed, removeSubscription, showToast]
  );

  const handleToggle = useCallback(
    async (event: NotificationEvent, channel: NotificationChannel, enabled: boolean) => {
      const key = rowKey(event, channel);
      if (key in pending) return; // this row's previous mutation hasn't settled yet

      setPending((prev) => ({ ...prev, [key]: enabled }));
      try {
        const { data } = await setPreference({ variables: { event, channel, enabled } });
        const updated = data?.viewerSetNotificationPreference?.notificationPreferences;
        if (!updated) {
          showToast('Could not save that preference', 'error');
          return;
        }

        client.cache.modify({
          id: client.cache.identify({ __typename: 'Viewer' }),
          fields: { notificationPreferences: () => updated },
        });
      } catch {
        showToast('Could not save that preference', 'error');
      } finally {
        // Skip if this component has already unmounted (e.g. the reader
        // navigated off the account page before this settled) — see the
        // `mountedRef` note on `pending`'s own doc comment above.
        if (mountedRef.current) {
          setPending((prev) => {
            const { [key]: _settled, ...rest } = prev;
            return rest;
          });
        }
      }
    },
    [pending, setPreference, client, showToast]
  );

  /**
   * Per CHANNEL, not per card. An unverified address makes the email column
   * a lie — nothing is ever sent to one — but says nothing about push, which
   * has no notion of a verified anything. Disabling a working push toggle
   * because of the address above it would be the same category of lie the
   * email disabling exists to prevent.
   */
  const channelDisabled = (channel: NotificationChannel): boolean =>
    channel === 'EMAIL' ? !emailVerified : support !== 'supported';

  if (rows.length === 0) return null;

  const hasEmailChannel = rows.some((row) => row.channel === 'EMAIL');

  return (
    <Card title="Notifications">
      {hasEmailChannel && !emailVerified && (
        <p className={style.hint}>Confirm your email address above to start receiving these.</p>
      )}
      <div className={style.deviceRow}>
        <Switch
          name="push-device"
          checked={subscribed}
          disabled={support !== 'supported' || permission === 'denied'}
          onChange={(next) => void toggle(next)}
          label="Enable push on this device"
          description={hint}
        />
      </div>
      <div className={style.list}>
        {rows.map((row) => {
          const key = rowKey(row.event, row.channel);
          const checked = pending[key] ?? row.enabled;
          return (
            <Switch
              key={key}
              name={key}
              label={`${EVENT_LABEL[row.event]} (${CHANNEL_LABEL[row.channel]})`}
              layout="horizontal"
              checked={checked}
              disabled={channelDisabled(row.channel)}
              onChange={(next) => void handleToggle(row.event, row.channel, next)}
            />
          );
        })}
      </div>
      {devices.length > 0 && (
        <ul className={style.deviceList}>
          {devices.map((device) => (
            <li key={device.id} className={style.device}>
              <div>
                <span className={style.deviceName}>{device.label}</span>
                {device.id === localId && <span className={style.thisDevice}>this device</span>}
                <span className={style.deviceMeta}>
                  {device.lastSuccessAt === null
                    ? 'Never received a notification'
                    : `Last notified ${new Date(device.lastSuccessAt).toLocaleDateString()}`}
                </span>
              </div>
              <button
                type="button"
                aria-label={`Remove ${device.label}`}
                onClick={() => void handleRemove(device.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};
