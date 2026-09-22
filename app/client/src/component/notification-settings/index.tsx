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
import {
  PushSubscriptionFragment,
  ViewerAddPushSubscriptionDocument,
  ViewerRemovePushSubscriptionDocument,
} from '~/graphql/push';
import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import {
  LOCAL_SUBSCRIPTION_ID,
  pushPermission,
  pushSupport,
  resyncSubscription,
  subscribeToPush,
  unsubscribeFromPush,
  type SubscribeResult,
} from '~/lib/push';
import { useToast } from '~/provider/toast';

import { useStyle } from './style';

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
   * to `subscribeToPush`/`resyncSubscription` (`~/lib/push`). `page/user`
   * falls back to `''` before `ViewerBootstrapDocument` resolves; an empty
   * key simply makes `subscribeToPush` fail, the same as any other failure
   * that function already handles.
   */
  pushPublicKey: string;
  /**
   * This viewer's subscribed browsers. Wired through at this prop boundary
   * (and at `page/user`'s callsite) now so Task 14's device list needs no
   * second change here — not yet rendered by this component. Masked like
   * `preferences`; unmask with `useFragment(PushSubscriptionFragment, ...)`.
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
 * `subscribed` — whether THIS browser currently has an active push
 * subscription — is separate local state for the same reason `pending` is:
 * it describes something specific to this device that the server-supplied
 * `preferences` prop (an EVENT×CHANNEL matrix, not a per-device fact) has no
 * way to express.
 */
export const NotificationSettings = ({
  preferences,
  emailVerified,
  pushPublicKey,
}: NotificationSettingsProps) => {
  const style = useStyle();
  const showToast = useToast();
  const client = useApolloClient();
  const rows = useFragment(NotificationPreferenceFragment, preferences);

  const [setPreference] = useMutation(ViewerSetNotificationPreferenceDocument);
  const [addSubscription] = useMutation(ViewerAddPushSubscriptionDocument);
  const [removeSubscription] = useMutation(ViewerRemovePushSubscriptionDocument);

  /**
   * Keyed by `rowKey`. A row present here has a mutation in flight and shows
   * this value instead of `row.enabled`; the entry is removed in every
   * settlement path (success, server error, or thrown error) so it can never
   * outlive the request it was created for. See the file header for why this
   * is scoped to the one row in flight rather than a copy of the whole list.
   */
  const [pending, setPending] = useState<Partial<Record<string, boolean>>>({});

  const [subscribed, setSubscribed] = useState(false);

  const support = pushSupport();
  /**
   * State, not a plain `pushPermission()` call like `support` above:
   * `support` describes the connection/browser, which cannot change during
   * this component's lifetime, but permission CAN change — the one action
   * that changes it, `Notification.requestPermission()`, happens inside
   * `handleDeviceToggle` itself. Without this being state, declining or
   * dismissing the prompt would leave `permission` reading its
   * BEFORE-the-click value until some unrelated re-render happened to read
   * it fresh — the device switch would stay live and `deviceHint()` would
   * stay silent about a now-permanent `denied`, i.e. exactly the silent dead
   * end this state exists to prevent.
   */
  const [permission, setPermission] = useState(() => pushPermission());

  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Writes a (re)subscribed browser onto the server and syncs the local
   * bookkeeping around it. Shared by the load-time resync effect below and
   * `handleDeviceToggle`'s own click handler — both can hand this a freshly
   * subscribed browser and both need the same two follow-ups done to it.
   */
  const syncPushSubscription = useCallback(
    async (subscription: SubscribeResult) => {
      const result = await addSubscription({ variables: subscription });
      // `viewerAddPushSubscription` is masked at the TYPE level only — it's
      // selected via a fragment spread in `graphql/push.ts` — so reading
      // `.id` through a structural cast is exactly as safe as unmasking it
      // would be, since masking has no RUNTIME effect in this codebase
      // (`~/gql/fragment-masking.ts`'s own doc comment). `useFragment` isn't
      // an option here: it would be called from this callback rather than
      // the component's own render body, which `react-hooks/rules-of-hooks`
      // (rightly, by its own lights) flags as a violation — see
      // `lib/use-progress-mutations.ts`'s identical cast for the identical
      // reason.
      const added = result.data?.viewerAddPushSubscription as { id: string } | undefined;
      if (added?.id != null) localStorage.setItem(LOCAL_SUBSCRIPTION_ID, added.id);
      // A first-time registration otherwise never appears in the device
      // list: fragment normalization only refreshes an ALREADY-cached
      // entity, and Apollo will not append a brand-new one to an
      // already-cached `viewer.pushSubscriptions` list on its own. `include`
      // only refetches ACTIVE queries (`EmailSetting`'s own identical call),
      // so this is a no-op wherever nothing has `ViewerBootstrapDocument`
      // mounted and a real refetch wherever `page/user` does.
      await client.refetchQueries({ include: [ViewerBootstrapDocument] });
    },
    [addSubscription, client]
  );

  useEffect(() => {
    // `page/user` hands down `''` until `ViewerBootstrapDocument` resolves
    // (this prop's own doc comment). Running anyway would register the
    // worker and, for a browser with permission already granted but no
    // subscription, call `subscribeToPush('')` — which cannot succeed — and
    // then run the identical pair of calls again once the real key arrives
    // and this effect re-fires on the `pushPublicKey` dependency below.
    if (pushPublicKey === '') return;

    // Re-sync on load. `resyncSubscription`, not merely reading back an
    // existing one, because a browser that EXPIRED its subscription while
    // permission stayed 'granted' would otherwise silently stop receiving
    // push forever with no error anywhere — see that function's own doc
    // comment. It never prompts on its own: it only acts when permission is
    // already 'granted', so this effect can never be the thing that shows
    // the OS permission dialog on load (Global Constraints).
    let cancelled = false;
    void (async () => {
      const existing = await resyncSubscription(pushPublicKey);
      if (cancelled || existing === null) return;
      setSubscribed(true);
      await syncPushSubscription(existing);
    })().catch(() => {
      // Best-effort and silent (no toast): this runs unattended on every
      // load, not from anything the reader did, so there is nothing for
      // them to act on right now — but it MUST be caught. An uncaught
      // rejection here is an unhandled rejection at the top of an async
      // IIFE, which in this repo's test runner produces an "all tests
      // passed" run that still exits 1 (this file's own `mountedRef` test
      // above records the identical failure mode for a different cause).
      // Revert the optimistic `setSubscribed(true)` above: whatever
      // failed, this browser cannot be relied on to be correctly
      // registered with the server, so the switch should say so rather
      // than show a subscription that may not exist.
      if (!cancelled) setSubscribed(false);
    });
    return () => {
      cancelled = true;
    };
  }, [pushPublicKey, syncPushSubscription]);

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

  const handleDeviceToggle = useCallback(
    async (next: boolean) => {
      if (!next) {
        const id = localStorage.getItem(LOCAL_SUBSCRIPTION_ID);
        // Optimistic, matching the "on" branch below and the load effect
        // above: set first, revert in the `catch` — not left until after
        // the round trip, which is what let a failed disable leave the
        // switch showing "on" while the browser had already unsubscribed
        // (the worse of the two desyncs a failure here can cause, since it
        // tells the reader push still works when it may not).
        setSubscribed(false);
        try {
          await unsubscribeFromPush();
          if (id !== null) await removeSubscription({ variables: { id } });
          localStorage.removeItem(LOCAL_SUBSCRIPTION_ID);
        } catch {
          setSubscribed(true);
          showToast('Could not update push on this device.', 'error');
        }
        return;
      }
      // Only ever from THIS click. `Notification.requestPermission()` may
      // only be called from a user gesture, and `denied` is permanent until
      // the user clears it in browser settings — there is exactly one
      // chance to ask and it is spent here, never on load.
      const granted = await Notification.requestPermission();
      setPermission(granted);
      if (granted !== 'granted') return;

      const subscription = await subscribeToPush(pushPublicKey);
      if (subscription === null) {
        showToast('Could not enable push notifications on this device.', 'error');
        return;
      }
      // Optimistic, matching the load effect's own ordering — set before
      // awaiting the mutation, revert in the `catch` — rather than only
      // after `syncPushSubscription` resolves. `addSubscription`/
      // `removeSubscription` reject on error like any other mutation in
      // this file; without this `catch` that rejection escaped as an
      // unhandled rejection, `setSubscribed(true)` below never ran, and the
      // switch silently snapped back to "off" with no toast while the
      // browser held a live subscription the server had no row for.
      setSubscribed(true);
      try {
        await syncPushSubscription(subscription);
      } catch {
        setSubscribed(false);
        showToast('Could not update push on this device.', 'error');
      }
    },
    [pushPublicKey, removeSubscription, showToast, syncPushSubscription]
  );

  /**
   * The one state the switch cannot express itself. `denied` is permanent
   * until the user clears it in browser settings, and `insecure` is a
   * property of the CONNECTION rather than the browser — saying "your
   * browser does not support this" to someone on HTTP would simply be
   * wrong.
   */
  const deviceHint = (): string | null => {
    if (support === 'insecure') return 'Push needs an HTTPS connection to this library.';
    if (support === 'unsupported') return 'This browser does not support push notifications.';
    if (permission === 'denied') {
      return 'Notifications are blocked for this site in your browser settings.';
    }
    return null;
  };

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
          onChange={(next) => void handleDeviceToggle(next)}
          label="Enable push on this device"
          description={deviceHint()}
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
    </Card>
  );
};
