import { useApolloClient, useMutation } from '@apollo/client/react';
import { useCallback, useEffect, useState } from 'react';

import {
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
  type PushSupport,
  type SubscribeResult,
} from '~/lib/push';
import { useToast } from '~/provider/toast';

export type UsePushDevice = {
  /**
   * Whether THIS browser currently has an active push subscription. Local
   * state (not derived from any server-supplied prop) for the same reason
   * `NotificationSettings`'s own `pending` map is: it describes something
   * specific to THIS device, which the server-supplied preferences list (an
   * EVENT×CHANNEL matrix, not a per-device fact) has no way to express.
   */
  subscribed: boolean;
  support: PushSupport;
  permission: NotificationPermission | 'unsupported';
  /**
   * The one state the switch cannot express itself. `denied` is permanent
   * until the user clears it in browser settings, and `insecure` is a
   * property of the CONNECTION rather than the browser — saying "your
   * browser does not support this" to someone on HTTP would simply be
   * wrong.
   */
  hint: string | null;
  toggle: (next: boolean) => Promise<void>;
  /**
   * Clears this browser's own bookkeeping — `subscribed` and the persisted
   * subscription id — without touching the server row or the browser's own
   * push subscription. For the device list's remove path (`NotificationSettings`),
   * which already performs both of those itself (`unsubscribeFromPush` and
   * the `viewerRemovePushSubscription` mutation) before calling this; a row
   * removed while this hook still believed itself subscribed would
   * otherwise be silently re-created by the next load's re-sync.
   */
  markUnsubscribed: () => void;
};

/**
 * This browser's own push subscription lifecycle: whether it supports push,
 * whether permission has been granted, whether it currently holds an active
 * subscription, and the one control (`toggle`) that flips that subscription
 * on or off. Extracted out of `NotificationSettings` (a Task 14 refactor):
 * that component's documented job is the event×channel preference matrix,
 * and this per-device lifecycle is a second, self-contained concern that
 * does not belong bolted onto it.
 */
export function usePushDevice(pushPublicKey: string): UsePushDevice {
  const client = useApolloClient();
  const showToast = useToast();

  const [addSubscription] = useMutation(ViewerAddPushSubscriptionDocument);
  const [removeSubscription] = useMutation(ViewerRemovePushSubscriptionDocument);

  const [subscribed, setSubscribed] = useState(false);

  const support = pushSupport();
  /**
   * State, not a plain `pushPermission()` call like `support` above:
   * `support` describes the connection/browser, which cannot change during
   * this component's lifetime, but permission CAN change — the one action
   * that changes it, `Notification.requestPermission()`, happens inside
   * `toggle` itself. Without this being state, declining or dismissing the
   * prompt would leave `permission` reading its BEFORE-the-click value
   * until some unrelated re-render happened to read it fresh — the device
   * switch would stay live and `hint` would stay silent about a now-permanent
   * `denied`, i.e. exactly the silent dead end this state exists to
   * prevent.
   */
  const [permission, setPermission] = useState(() => pushPermission());

  /**
   * Writes a (re)subscribed browser onto the server and syncs the local
   * bookkeeping around it. Shared by the load-time resync effect below and
   * `toggle`'s own click handler — both can hand this a freshly subscribed
   * browser and both need the same two follow-ups done to it.
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
    // (`NotificationSettingsProps.pushPublicKey`'s own doc comment). Running
    // anyway would register the worker and, for a browser with permission
    // already granted but no subscription, call `subscribeToPush('')` —
    // which cannot succeed — and then run the identical pair of calls again
    // once the real key arrives and this effect re-fires on the
    // `pushPublicKey` dependency below.
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
      // passed" run that still exits 1 (`notification-settings/index.test.tsx`'s
      // own `mountedRef` test records the identical failure mode for a
      // different cause). Revert the optimistic `setSubscribed(true)`
      // above: whatever failed, this browser cannot be relied on to be
      // correctly registered with the server, so the switch should say so
      // rather than show a subscription that may not exist.
      if (!cancelled) setSubscribed(false);
    });
    return () => {
      cancelled = true;
    };
  }, [pushPublicKey, syncPushSubscription]);

  const toggle = useCallback(
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
      if (granted !== 'granted') {
        // `denied` is permanent and earns the standing hint below, which
        // `setPermission` has just made appear. `default` means the prompt was
        // DISMISSED rather than answered — and it is also the pristine
        // never-asked state, so it cannot have a standing hint without
        // accusing a fresh install of having refused something. That left the
        // dismissal case with no trace anywhere: no hint, no console line, no
        // state change, the switch simply staying off. Reported from real use
        // as "I can't enable it and I don't get an error". A toast is the
        // right shape precisely because it belongs to the ACTION, not to the
        // state.
        if (granted !== 'denied') {
          showToast('Notifications were not allowed. You can try again.', 'error');
        }
        return;
      }

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

  const markUnsubscribed = useCallback(() => {
    localStorage.removeItem(LOCAL_SUBSCRIPTION_ID);
    setSubscribed(false);
  }, []);

  let hint: string | null = null;
  if (support === 'insecure') hint = 'Push needs an HTTPS connection to this library.';
  else if (support === 'unsupported') hint = 'This browser does not support push notifications.';
  else if (permission === 'denied') {
    hint = 'Notifications are blocked for this site in your browser settings.';
  }

  return { subscribed, support, permission, hint, toggle, markUnsubscribed };
}
