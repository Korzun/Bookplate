import { useQuery } from '@apollo/client/react';
import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeFragmentData } from '~/gql';
import type {
  NotificationPreferenceFragmentFragment,
  PushSubscriptionFragmentFragment,
  ViewerAddPushSubscriptionMutation,
  ViewerAddPushSubscriptionMutationVariables,
  ViewerBootstrapQuery,
  ViewerRemovePushSubscriptionMutation,
  ViewerRemovePushSubscriptionMutationVariables,
  ViewerSetNotificationPreferenceMutation,
  ViewerSetNotificationPreferenceMutationVariables,
} from '~/gql/graphql';
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
import { LOCAL_SUBSCRIPTION_ID } from '~/lib/push';
import { renderWithApollo, renderWithControlledLink } from '~/test-utils';

import { NotificationSettings, type NotificationSettingsProps } from './index';

/**
 * A typed `NotificationPreferenceFragmentFragment` VARIABLE, never an inline
 * object literal at a call site — same reasoning as
 * `component/device-row/index.test.tsx`'s `device()`: a fresh literal fails
 * TypeScript's excess-property check against `NotificationSettings`'s
 * MASKED `preferences` prop, and `makeFragmentData` is the sanctioned cast
 * back to that masked type.
 */
const preference = (
  overrides: Partial<NotificationPreferenceFragmentFragment> = {}
): NotificationPreferenceFragmentFragment => ({
  __typename: 'NotificationPreference',
  event: overrides.event ?? 'BOOK_REQUEST_FULFILLED',
  channel: overrides.channel ?? 'EMAIL',
  enabled: overrides.enabled ?? true,
});

const emailPref = (enabled = true) =>
  makeFragmentData(preference({ channel: 'EMAIL', enabled }), NotificationPreferenceFragment);
const pushPref = (enabled = true) =>
  makeFragmentData(preference({ channel: 'PUSH', enabled }), NotificationPreferenceFragment);

const preferences = [
  preference({ event: 'BOOK_REQUEST_FULFILLED', enabled: true }),
  preference({ event: 'BOOK_REQUEST_DECLINED', enabled: false }),
].map((row) => makeFragmentData(row, NotificationPreferenceFragment));

/**
 * A typed `PushSubscriptionFragmentFragment` VARIABLE, `makeFragmentData`-wrapped —
 * same reasoning as `preference`/`pushPref` above: a fresh literal fails
 * TypeScript's excess-property check against `NotificationSettings`'s masked
 * `pushSubscriptions` prop.
 */
const pushSubscription = (overrides: Partial<PushSubscriptionFragmentFragment> = {}) =>
  makeFragmentData(
    {
      __typename: 'PushSubscription' as const,
      id: overrides.id ?? 'sub-1',
      label: overrides.label ?? 'Chrome on macOS',
      createdAt: overrides.createdAt ?? 1000,
      lastSuccessAt: overrides.lastSuccessAt ?? null,
    },
    PushSubscriptionFragment
  );

/**
 * A supported, secure, permission-'default' browser — the baseline every
 * push test starts from, then narrows (permission denied, insecure, etc.)
 * per scenario. `pushManager.subscribe`/`getSubscription` resolve `null` by
 * default, which is enough for every test that never expects a subscribe
 * call to actually go through; tests that DO drive the device switch's
 * subscribe path override `navigator` again with their own stub.
 */
const stubSupportedBrowser = () => {
  vi.stubGlobal('navigator', {
    userAgent: 'Chrome/140 (Macintosh; Intel Mac OS X 10_15_7)',
    serviceWorker: {
      register: vi.fn().mockResolvedValue({
        pushManager: {
          subscribe: vi.fn().mockResolvedValue(null),
          getSubscription: vi.fn().mockResolvedValue(null),
        },
      }),
    },
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn() });
};

/** A single-byte `ArrayBuffer`, enough for `toBase64Url` to encode without caring about the value. */
const fakeKey = (byte: number) => new Uint8Array([byte]).buffer;

/**
 * A supported browser whose `pushManager.subscribe()` actually resolves a
 * usable subscription — for the tests that drive the device switch's "on"
 * path all the way through `subscribeToPush`/`addSubscription`, rather than
 * the disabled-state tests above, which never reach it.
 */
const stubBrowserThatCanSubscribe = (endpoint: string) => {
  vi.stubGlobal('navigator', {
    userAgent: 'Chrome/140 (Macintosh; Intel Mac OS X 10_15_7)',
    serviceWorker: {
      register: vi.fn().mockResolvedValue({
        pushManager: {
          subscribe: vi.fn().mockResolvedValue({
            endpoint,
            getKey: (name: string) => (name === 'p256dh' ? fakeKey(1) : fakeKey(2)),
          }),
          getSubscription: vi.fn().mockResolvedValue(null),
        },
      }),
    },
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('isSecureContext', true);
};

const addSubscriptionMock = (
  id: string
): MockedResponse<
  ViewerAddPushSubscriptionMutation,
  ViewerAddPushSubscriptionMutationVariables
> => ({
  request: { query: ViewerAddPushSubscriptionDocument, variables: () => true },
  result: {
    data: {
      __typename: 'Mutation',
      viewerAddPushSubscription: {
        // `makeFragmentData` alone returns the bare masked type
        // (`{ ' $fragmentRefs'?: ... }`); the mock also needs the
        // `__typename` MockLink normalizes by — same two-part shape
        // `page/library/index.test.tsx` and `page/device-list/index.test.tsx`
        // already use for a masked field nested in a larger payload.
        __typename: 'PushSubscription' as const,
        ...makeFragmentData(
          {
            __typename: 'PushSubscription' as const,
            id,
            label: 'Chrome on macOS',
            createdAt: 1,
            lastSuccessAt: null,
          },
          PushSubscriptionFragment
        ),
      },
    },
  },
});

const removeSubscriptionMock = (
  id: string
): MockedResponse<
  ViewerRemovePushSubscriptionMutation,
  ViewerRemovePushSubscriptionMutationVariables
> => ({
  request: { query: ViewerRemovePushSubscriptionDocument, variables: { id } },
  result: { data: { __typename: 'Mutation', viewerRemovePushSubscription: true } },
});

const addSubscriptionErrorMock = (): MockedResponse<
  ViewerAddPushSubscriptionMutation,
  ViewerAddPushSubscriptionMutationVariables
> => ({
  request: { query: ViewerAddPushSubscriptionDocument, variables: () => true },
  error: new Error('network exploded'),
});

const removeSubscriptionErrorMock = (
  id: string
): MockedResponse<
  ViewerRemovePushSubscriptionMutation,
  ViewerRemovePushSubscriptionMutationVariables
> => ({
  request: { query: ViewerRemovePushSubscriptionDocument, variables: { id } },
  error: new Error('network exploded'),
});

/**
 * The file's one render helper for the plain (non-mutation-racing) cases:
 * mounts `NotificationSettings` straight, with sensible defaults, over
 * `renderWithApollo`. Tests that need to assert on IN-FLIGHT mutation state
 * (below) still go through `renderWithControlledLink` directly, since they
 * need its `release`/`requestCount` — this helper does not replace that one.
 */
const renderCard = ({
  preferences: cardPreferences,
  emailVerified = true,
  pushPublicKey = 'vapid-public-key',
  pushSubscriptions = [],
  mocks = [],
}: {
  preferences: NotificationSettingsProps['preferences'];
  emailVerified?: boolean;
  pushPublicKey?: string;
  pushSubscriptions?: NotificationSettingsProps['pushSubscriptions'];
  mocks?: MockedResponse[];
}) =>
  renderWithApollo(
    <NotificationSettings
      preferences={cardPreferences}
      emailVerified={emailVerified}
      pushPublicKey={pushPublicKey}
      pushSubscriptions={pushSubscriptions}
    />,
    { mocks }
  );

const viewerBootstrapMock = (
  notificationPreferences: NotificationPreferenceFragmentFragment[]
): MockedResponse<ViewerBootstrapQuery> => ({
  request: { query: ViewerBootstrapDocument },
  result: {
    data: {
      __typename: 'Query',
      viewer: {
        __typename: 'Viewer',
        username: 'alice',
        isAdmin: false,
        mustChangePassword: false,
        email: 'alice@example.com',
        emailVerifiedAt: '2024-01-01T00:00:00.000Z',
        notificationPreferences,
        pushPublicKey: 'vapid-public-key',
        pushSubscriptions: [],
        user: { __typename: 'User', id: 'USER-1' },
        library: { __typename: 'Library', id: 'LIB-1' },
      },
    },
  },
});

/**
 * Mirrors `page/user`'s own composition: reads `ViewerBootstrapDocument` and
 * passes its `notificationPreferences` straight through as the `preferences`
 * prop, exactly as `page/user/index.tsx`'s `notificationSection` does.
 * `NotificationSettings` itself holds no state of its own for the list — a
 * successful toggle writes the mutation's returned list onto the `Viewer`
 * singleton via `cache.modify`, and THIS harness's `useQuery` is the active
 * watcher that reacts to that write and re-renders with the fresh list, the
 * same mechanism `page/user`'s own `useQuery(ViewerBootstrapDocument)` relies
 * on in the real app. A test that instead fed `NotificationSettings` a fixed
 * `preferences` prop and expected it to update on its own would be testing
 * component-local state this component deliberately does not have.
 */
const Harness = () => {
  const { data } = useQuery(ViewerBootstrapDocument);
  return (
    <NotificationSettings
      preferences={data?.viewer.notificationPreferences ?? []}
      emailVerified={data?.viewer.emailVerifiedAt != null}
      pushPublicKey={data?.viewer.pushPublicKey ?? ''}
      pushSubscriptions={data?.viewer.pushSubscriptions ?? []}
    />
  );
};

type MutationOutcome = { data: ViewerSetNotificationPreferenceMutation } | { error: Error };

/**
 * The shared `renderWithControlledLink` (see `~/test-utils`) with this file's
 * mutation type applied — the machinery it replaced (a hand-rolled link that
 * holds every request open until the test releases it) now lives there,
 * because two other test files needed exactly the same thing to de-race
 * assertions on in-flight state.
 */
const renderWithControlledMutation = (ui: ReactElement) =>
  renderWithControlledLink<ViewerSetNotificationPreferenceMutation>(ui);

const setPreferenceSuccess = (): MutationOutcome => ({
  data: {
    __typename: 'Mutation',
    viewerSetNotificationPreference: {
      __typename: 'ViewerSetNotificationPreferencePayload',
      notificationPreferences: [
        preference({ event: 'BOOK_REQUEST_FULFILLED', enabled: false }),
        preference({ event: 'BOOK_REQUEST_DECLINED', enabled: false }),
      ],
    },
  },
});

describe('NotificationSettings', () => {
  // `vi.stubGlobal` and `localStorage` both persist across tests in this file
  // (there is no global `restoreMocks`/`unstubAllGlobals` config, and jsdom's
  // `localStorage` is a real store setup.ts installs once) — `lib/push.test.ts`
  // takes the identical precaution for the identical reason.
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('renders nothing when the catalogue is empty', () => {
    // Not `expect(container).toBeEmptyDOMElement()`: `renderWithApollo`
    // wraps every render in the real provider stack, and `ToastProvider`
    // unconditionally renders its own (empty) toast-portal `<div>` as a
    // sibling of whatever's under test — that div is always in `container`,
    // toasts or not, so asserting on the CARD itself is the accurate check.
    renderCard({ preferences: [] });
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('renders one labelled control per preference, reflecting its state', () => {
    renderCard({ preferences });

    const fulfilled = screen.getByRole('switch', { name: /added to my library/i });
    const declined = screen.getByRole('switch', { name: /declined/i });
    expect(fulfilled).toBeChecked();
    expect(declined).not.toBeChecked();
  });

  it('disables every control and explains why when the address is unverified', () => {
    renderCard({ preferences, emailVerified: false });

    // `control/switch` renders a plain `<div role="switch" aria-disabled>`,
    // not a native form control — jest-dom's `toBeDisabled()` only inspects
    // native disablable tags (see its `canElementBeDisabled`), so it never
    // matches here even when the switch is correctly disabled. Asserting
    // the `aria-disabled` attribute directly is the accurate check for this
    // control; `component/device-form`'s own tests hit the same limitation
    // for other non-native controls.
    expect(screen.getByRole('switch', { name: /added to my library/i })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByText(/confirm your email address/i)).toBeInTheDocument();
  });

  it("reflects the mutation's returned state once the watching query updates, agreeing with the row's own optimistic value", async () => {
    const initial = [
      preference({ event: 'BOOK_REQUEST_FULFILLED', enabled: true }),
      preference({ event: 'BOOK_REQUEST_DECLINED', enabled: false }),
    ];
    const mocks: [
      MockedResponse<ViewerBootstrapQuery>,
      MockedResponse<
        ViewerSetNotificationPreferenceMutation,
        ViewerSetNotificationPreferenceMutationVariables
      >,
    ] = [
      viewerBootstrapMock(initial),
      {
        request: {
          query: ViewerSetNotificationPreferenceDocument,
          variables: { event: 'BOOK_REQUEST_FULFILLED', channel: 'EMAIL', enabled: false },
        },
        result: {
          data: {
            __typename: 'Mutation',
            viewerSetNotificationPreference: {
              __typename: 'ViewerSetNotificationPreferencePayload',
              notificationPreferences: [
                preference({ event: 'BOOK_REQUEST_FULFILLED', enabled: false }),
                preference({ event: 'BOOK_REQUEST_DECLINED', enabled: false }),
              ],
            },
          },
        },
      },
    ];
    renderWithApollo(<Harness />, { mocks });

    const fulfilled = await screen.findByRole('switch', { name: /added to my library/i });
    expect(fulfilled).toBeChecked();

    await userEvent.click(fulfilled);

    // Not just "the mutation fired": this only passes if `cache.modify`'s
    // write actually lands where `Harness`'s `useQuery(ViewerBootstrapDocument)`
    // reads from, which is the same path `page/user` depends on in the real
    // app — a stale local copy of the LIST inside `NotificationSettings`
    // would make this assertion pass for the wrong reason. (The row's own
    // brief `pending` optimism, covered separately below, already shows this
    // value before the mutation resolves; this test's `waitFor` proves the
    // cache write independently arrives at the same state once it does.)
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /added to my library/i })).not.toBeChecked();
    });
  });

  it('shows the optimistic value immediately, and the mutation genuinely has not settled yet', async () => {
    const { release } = renderWithControlledMutation(
      <NotificationSettings
        preferences={preferences}
        emailVerified
        pushPublicKey=""
        pushSubscriptions={[]}
      />
    );

    const fulfilled = screen.getByRole('switch', { name: /added to my library/i });
    expect(fulfilled).toBeChecked();

    await userEvent.click(fulfilled);

    // The mutation is HELD OPEN by `renderWithControlledMutation` — it
    // cannot have settled, by construction, not merely "probably hasn't
    // yet" — so this only reads false if the click itself flipped it.
    expect(fulfilled).not.toBeChecked();

    // An explicit release point, not a sleep: only now does the mutation
    // resolve, and the optimistic value must survive that unchanged (the
    // pending value and the fresh state agree, so there's no flicker back).
    release(setPreferenceSuccess());

    await waitFor(() => expect(fulfilled).not.toBeChecked());
  });

  it('reverts to the prior value and toasts when the mutation errors', async () => {
    const { release } = renderWithControlledMutation(
      <NotificationSettings
        preferences={preferences}
        emailVerified
        pushPublicKey=""
        pushSubscriptions={[]}
      />
    );

    const fulfilled = screen.getByRole('switch', { name: /added to my library/i });
    await userEvent.click(fulfilled);

    // Held open, so this is provably ahead of the rejection below, not a
    // race against it.
    expect(fulfilled).not.toBeChecked();

    release({ error: new Error('network exploded') });

    await waitFor(() => expect(fulfilled).toBeChecked()); // reverted once it rejects
    expect(await screen.findByRole('status')).toHaveTextContent('Could not save that preference');
  });

  it('ignores a second click on a row while its own mutation is still in flight', async () => {
    const { release, requestCount } = renderWithControlledMutation(
      <NotificationSettings
        preferences={preferences}
        emailVerified
        pushPublicKey=""
        pushSubscriptions={[]}
      />
    );

    const fulfilled = screen.getByRole('switch', { name: /added to my library/i });
    await userEvent.click(fulfilled);
    // A second click while the first request is HELD OPEN — deterministically
    // "still in flight", not merely "probably still in flight" — must not
    // issue a second request. `requestCount` is incremented synchronously by
    // the link the instant a request is issued, so this reads the true count
    // rather than one raced against a timer.
    await userEvent.click(fulfilled);
    expect(requestCount.current).toBe(1);

    release(setPreferenceSuccess());

    await waitFor(() => expect(fulfilled).not.toBeChecked());
    expect(requestCount.current).toBe(1); // still just the one, after settling too
  });

  it('settling after unmount does not throw — pinning the mountedRef guard', async () => {
    // Mirrors a reader toggling a preference and navigating off the account
    // page before the mutation round-trips: `page/user` (and this component
    // with it) unmounts while `handleToggle`'s `await setPreference(...)` is
    // still in flight. Nothing aborts that call, so its `finally` still runs
    // once `release` settles it below, against an already-unmounted tree.
    //
    // React 19 already treats a `setState` call on an unmounted component as
    // a no-op (no warning, no throw), so `mountedRef` doesn't change anything
    // OBSERVABLE here — it exists to skip needless work once there's nowhere
    // left for it to land, not to prevent a crash React itself already
    // prevents. This test pins that the continuation stays harmless: if a
    // regression ever made it throw, that throw would surface exactly the
    // way the fix-wave's own bug did — an "all tests passed" run that still
    // exits 1 on an unhandled error.
    const { release, unmount } = renderWithControlledMutation(
      <NotificationSettings
        preferences={preferences}
        emailVerified
        pushPublicKey=""
        pushSubscriptions={[]}
      />
    );

    const fulfilled = screen.getByRole('switch', { name: /added to my library/i });
    await userEvent.click(fulfilled);

    unmount();
    release(setPreferenceSuccess());

    // Flush the microtask queue so `handleToggle`'s post-`await` continuation
    // (its `finally` included) has definitely run before the test ends.
    await Promise.resolve();
    await Promise.resolve();
  });

  it('offers the device switch as disabled over plain HTTP', () => {
    // `pushSupport()` only reports 'insecure' when the APIs themselves are
    // present but `isSecureContext` is false — a browser missing the APIs
    // entirely reports 'unsupported' instead (a different, non-actionable
    // message). So `serviceWorker`/`PushManager` are stubbed present here,
    // same as `stubSupportedBrowser`, with only `isSecureContext` flipped.
    vi.stubGlobal('navigator', {
      userAgent: 'Chrome/140 (Macintosh; Intel Mac OS X 10_15_7)',
      serviceWorker: { register: vi.fn() },
    });
    vi.stubGlobal('PushManager', function PushManager() {});
    vi.stubGlobal('isSecureContext', false);

    renderCard({ preferences: [emailPref(), pushPref()] });

    const toggle = screen.getByRole('switch', { name: /enable push on this device/i });
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/needs an https connection/i)).toBeInTheDocument();
    // Pins the PUSH half of `channelDisabled` (`support !== 'supported'`),
    // which nothing else in this file exercised: `channel === 'EMAIL' ? … :
    // false` — i.e. never actually gating on `support` — would have passed
    // every other test here.
    expect(screen.getByRole('switch', { name: /added.*push/i })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it('explains a blocked permission instead of offering a dead switch', () => {
    stubSupportedBrowser();
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() });

    renderCard({ preferences: [emailPref(), pushPref()] });

    expect(screen.getByText(/blocked for this site in your browser settings/i)).toBeInTheDocument();
    // Without this, an implementation that showed the hint but left the
    // switch itself live (spending the one remaining permission chance on a
    // click that can only re-confirm `denied`) would still pass.
    expect(screen.getByRole('switch', { name: /enable push on this device/i })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it('renders a push column even when mail is unconfigured', () => {
    stubSupportedBrowser();

    // The card used to hide entirely without mail. A LAN-only install
    // reached over a tunnel can still do push, so the card now renders
    // whenever the server returns a non-empty catalogue.
    renderCard({ preferences: [pushPref()] });

    expect(
      screen.getByRole('switch', { name: /a book i requested is added.*push/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /email/i })).not.toBeInTheDocument();
  });

  it('keeps push toggles live when the address is unverified', () => {
    stubSupportedBrowser();

    renderCard({ preferences: [emailPref(), pushPref()], emailVerified: false });

    // An unverified address says nothing about whether push works; disabling
    // a working toggle because of it would be the same lie the
    // unverified-email disabling exists to prevent.
    expect(screen.getByRole('switch', { name: /added.*email/i })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByRole('switch', { name: /added.*push/i })).toHaveAttribute(
      'aria-disabled',
      'false'
    );
  });

  it(
    're-subscribes on load when permission is already granted but this browser lost its ' +
      'subscription (proves `resyncSubscription`, not `currentSubscription`, is used)',
    async () => {
      stubBrowserThatCanSubscribe('https://push.example/resynced');
      vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });

      renderCard({
        preferences: [pushPref()],
        mocks: [addSubscriptionMock('sub-resync')],
      });

      // `currentSubscription()` alone would see `getSubscription()` resolve
      // `null` and stop there — the switch would never check itself and no
      // mutation would ever fire. Only `resyncSubscription` reacts to a
      // 'granted' permission with nothing subscribed by subscribing again.
      // Waiting on the PERSISTED id (rather than just the switch, which
      // flips to checked optimistically before the mutation settles — same
      // ordering `handleDeviceToggle`'s own "on" branch uses) proves the
      // mutation actually completed, not merely that it was scheduled.
      await waitFor(() => {
        expect(localStorage.getItem(LOCAL_SUBSCRIPTION_ID)).toBe('sub-resync');
      });
      expect(screen.getByRole('switch', { name: /enable push on this device/i })).toBeChecked();
      // And never by prompting — this ran on LOAD, with no click anywhere.
      expect(Notification.requestPermission).not.toHaveBeenCalled();
    }
  );

  it('subscribes then unsubscribes this device across two clicks, mutating and refetching each time', async () => {
    stubSupportedBrowser();
    vi.mocked(Notification.requestPermission).mockResolvedValue('granted');
    stubBrowserThatCanSubscribe('https://push.example/device-1');

    const { client } = renderCard({
      preferences: [pushPref()],
      mocks: [addSubscriptionMock('sub-42'), removeSubscriptionMock('sub-42')],
    });
    const refetchSpy = vi.spyOn(client, 'refetchQueries').mockResolvedValue([]);

    const toggle = screen.getByRole('switch', { name: /enable push on this device/i });
    expect(toggle).not.toBeChecked();

    await userEvent.click(toggle);

    // Waiting on the PERSISTED id, not just `toggle` being checked: the
    // switch flips optimistically (`setSubscribed(true)`) before
    // `syncPushSubscription`'s `addSubscription` call settles — same
    // ordering the load effect uses — so asserting on `toggle` alone here
    // would read `localStorage` before the mutation had actually landed.
    await waitFor(() => {
      expect(localStorage.getItem(LOCAL_SUBSCRIPTION_ID)).toBe('sub-42');
    });
    expect(toggle).toBeChecked();
    // A first-time registration would otherwise never show up in Task 14's
    // device list: fragment normalization only refreshes an
    // already-cached entity, never appends a brand-new one.
    expect(refetchSpy).toHaveBeenCalledWith({ include: [ViewerBootstrapDocument] });

    await userEvent.click(toggle);

    // Same reasoning in reverse: `setSubscribed(false)` also flips
    // optimistically, before `localStorage.removeItem` runs.
    await waitFor(() => {
      expect(localStorage.getItem(LOCAL_SUBSCRIPTION_ID)).toBeNull();
    });
    expect(toggle).not.toBeChecked();
  });

  it('reverts the device switch and toasts when enabling push fails', async () => {
    stubSupportedBrowser();
    vi.mocked(Notification.requestPermission).mockResolvedValue('granted');
    stubBrowserThatCanSubscribe('https://push.example/device-add-fails');

    renderCard({
      preferences: [pushPref()],
      mocks: [addSubscriptionErrorMock()],
    });

    const toggle = screen.getByRole('switch', { name: /enable push on this device/i });
    await userEvent.click(toggle);

    // The switch is briefly checked optimistically (same ordering the load
    // effect uses), then reverts once `addSubscription` rejects — it must
    // not silently snap back with no explanation, which is what shipped
    // before this fix (the rejection escaped as an unhandled rejection and
    // `setSubscribed(true)` simply never ran).
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(await screen.findByRole('status')).toHaveTextContent(/could not update push/i);
    expect(localStorage.getItem(LOCAL_SUBSCRIPTION_ID)).toBeNull();
  });

  it('reverts the device switch and toasts when disabling push fails', async () => {
    stubSupportedBrowser();
    vi.mocked(Notification.requestPermission).mockResolvedValue('granted');
    stubBrowserThatCanSubscribe('https://push.example/device-remove-fails');

    renderCard({
      preferences: [pushPref()],
      mocks: [addSubscriptionMock('sub-77'), removeSubscriptionErrorMock('sub-77')],
    });

    const toggle = screen.getByRole('switch', { name: /enable push on this device/i });
    await userEvent.click(toggle); // on — succeeds
    // Wait for the id to actually land, not just the optimistic `checked` —
    // the off-click below reads it synchronously from `localStorage`, and
    // reading it before `syncPushSubscription` persisted it would skip the
    // `removeSubscription` call entirely (no id to remove), silently
    // sidestepping the very failure this test means to exercise.
    await waitFor(() => {
      expect(localStorage.getItem(LOCAL_SUBSCRIPTION_ID)).toBe('sub-77');
    });
    expect(toggle).toBeChecked();

    await userEvent.click(toggle); // off — `removeSubscription` rejects

    // Reverts to "on": this is the WORSE of the two desyncs a failure here
    // can cause if left unhandled — the reader would otherwise see "off"
    // and believe push has stopped, when nothing was actually undone
    // server-side.
    await waitFor(() => expect(toggle).toBeChecked());
    expect(await screen.findByRole('status')).toHaveTextContent(/could not update push/i);
    expect(localStorage.getItem(LOCAL_SUBSCRIPTION_ID)).toBe('sub-77');
  });

  it('shows the blocked-permission hint and disables the switch immediately after the user declines', async () => {
    stubSupportedBrowser();
    vi.mocked(Notification.requestPermission).mockResolvedValue('denied');

    renderCard({ preferences: [pushPref()] });

    const toggle = screen.getByRole('switch', { name: /enable push on this device/i });
    expect(toggle).toHaveAttribute('aria-disabled', 'false');
    expect(screen.queryByText(/blocked for this site/i)).not.toBeInTheDocument();

    await userEvent.click(toggle);

    // Without holding `permission` in state, `deviceHint()` and the
    // switch's own `disabled` read the value from the LAST render — the
    // one before this click — so a decline would silently do nothing: no
    // hint, a still-live switch, and a second click that can only ask
    // again for an answer that's already permanent.
    await waitFor(() => {
      expect(
        screen.getByText(/blocked for this site in your browser settings/i)
      ).toBeInTheDocument();
    });
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
  });

  it('lists subscribed browsers and marks this one', () => {
    stubSupportedBrowser();
    localStorage.setItem(LOCAL_SUBSCRIPTION_ID, 'sub-1');

    renderCard({
      preferences: [pushPref()],
      pushSubscriptions: [
        pushSubscription({
          id: 'sub-1',
          label: 'Chrome on macOS',
          createdAt: 1000,
          lastSuccessAt: 2000,
        }),
        pushSubscription({
          id: 'sub-2',
          label: 'Safari on iOS',
          createdAt: 1500,
          lastSuccessAt: null,
        }),
      ],
    });

    expect(screen.getByText(/Chrome on macOS/)).toBeInTheDocument();
    // Exact text, not `/this device/i`: the device switch's OWN label
    // ("Enable push on this device") also matches that regex, which made
    // this assertion pass even before the badge existed.
    expect(screen.getByText('this device')).toBeInTheDocument();
    expect(screen.getByText(/never received a notification/i)).toBeInTheDocument();
    // The device that HAS a `lastSuccessAt` gets the dated copy, not the
    // null-case one — otherwise both rows could satisfy the same assertion.
    expect(screen.getByText(new RegExp(new Date(2000).toLocaleDateString()))).toBeInTheDocument();
  });

  it('removes another device from the list', async () => {
    stubSupportedBrowser();
    // Proves the browser-unsubscribe guard, not just the `localStorage`
    // guard: `handleRemove`'s `if (id === localId) await unsubscribeFromPush()`
    // is a SEPARATE `if` from the one that clears local bookkeeping. A
    // regression that dropped only the id check on the unsubscribe call
    // (leaving the bookkeeping guard intact) would still pass the
    // `localStorage` assertion below while silently unsubscribing the
    // browser the user is sitting at — this spy is the sibling test's own
    // proxy for "`unsubscribeFromPush` ran", asserted here as its negative.
    const registerSpy = vi.mocked(navigator.serviceWorker.register);
    // THIS browser's own subscription — set before the click below, so the
    // "must not touch" assertion afterwards proves something (a fresh,
    // never-set `null` would trivially still read `null` no matter what the
    // remove path did).
    localStorage.setItem(LOCAL_SUBSCRIPTION_ID, 'sub-99');
    const removeMock = removeSubscriptionMock('sub-2');

    const { client } = renderCard({
      preferences: [pushPref()],
      pushSubscriptions: [
        pushSubscription({
          id: 'sub-2',
          label: 'Safari on iOS',
          createdAt: 1500,
          lastSuccessAt: null,
        }),
      ],
      mocks: [removeMock],
    });
    const refetchSpy = vi.spyOn(client, 'refetchQueries').mockResolvedValue([]);

    await userEvent.click(screen.getByRole('button', { name: /remove safari on ios/i }));

    // Proves the mutation actually went out with the right id, not merely
    // that the click handler ran: `removeMock`'s `request.variables` only
    // matches `{ id: 'sub-2' }`, so an unmatched call would leave this
    // promise unresolved and the `waitFor` below times out.
    await waitFor(() =>
      expect(refetchSpy).toHaveBeenCalledWith({ include: [ViewerBootstrapDocument] })
    );
    // Removing a device that ISN'T this browser must not touch this
    // browser's own local subscription bookkeeping.
    expect(localStorage.getItem(LOCAL_SUBSCRIPTION_ID)).toBe('sub-99');
    // ...nor its actual push subscription. This is the assertion that
    // catches the regression the comment above describes.
    expect(registerSpy).not.toHaveBeenCalled();
  });

  it('removing this device also unsubscribes the browser, not just the server row', async () => {
    stubSupportedBrowser();
    // `Notification.permission` defaults to 'default' in `stubSupportedBrowser`,
    // so the load-time resync effect returns early WITHOUT ever calling
    // `navigator.serviceWorker.register` (`resyncSubscription` bails before
    // `currentSubscription` when permission isn't 'granted') — this spy is
    // untouched until the click below, so a call afterwards can only be
    // `unsubscribeFromPush`'s own `registration()` call.
    const registerSpy = vi.mocked(navigator.serviceWorker.register);
    localStorage.setItem(LOCAL_SUBSCRIPTION_ID, 'sub-1');
    const removeMock = removeSubscriptionMock('sub-1');

    const { client } = renderCard({
      preferences: [pushPref()],
      pushSubscriptions: [
        pushSubscription({
          id: 'sub-1',
          label: 'Chrome on macOS',
          createdAt: 1000,
          lastSuccessAt: 2000,
        }),
      ],
      mocks: [removeMock],
    });
    const refetchSpy = vi.spyOn(client, 'refetchQueries').mockResolvedValue([]);
    expect(registerSpy).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /remove chrome on macos/i }));

    // Proves `unsubscribeFromPush` actually ran against the BROWSER, not
    // just that the server-side mutation fired — without this a bug that
    // removed the row but left the browser subscribed would silently pass
    // (and the next load's re-sync would re-create the row).
    await waitFor(() => expect(registerSpy).toHaveBeenCalled());
    // The persisted id must also revert — otherwise the next load's re-sync
    // would silently re-create the row this click just removed.
    await waitFor(() => expect(localStorage.getItem(LOCAL_SUBSCRIPTION_ID)).toBeNull());
    expect(refetchSpy).toHaveBeenCalledWith({ include: [ViewerBootstrapDocument] });
  });

  it('toasts when removing a device fails', async () => {
    stubSupportedBrowser();
    const removeMock = removeSubscriptionErrorMock('sub-2');

    renderCard({
      preferences: [pushPref()],
      pushSubscriptions: [
        pushSubscription({
          id: 'sub-2',
          label: 'Safari on iOS',
          createdAt: 1500,
          lastSuccessAt: null,
        }),
      ],
      mocks: [removeMock],
    });

    await userEvent.click(screen.getByRole('button', { name: /remove safari on ios/i }));

    // `handleRemove`'s `catch` has no revert (unlike `toggle`'s own
    // branches) — its own comment explains why that's deliberate here. This
    // test only pins the one thing that IS required: the failure is
    // surfaced, not silently swallowed.
    expect(await screen.findByRole('status')).toHaveTextContent(/could not remove that device/i);
  });
});
