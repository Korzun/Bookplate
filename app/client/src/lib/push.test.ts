import {
  currentSubscription,
  deviceLabel,
  LOCAL_SUBSCRIPTION_ID,
  pushSupport,
  resyncSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from './push';

const KEY =
  'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';

const fakeSubscription = (endpoint = 'https://push.example/a') => ({
  endpoint,
  unsubscribe: vi.fn().mockResolvedValue(true),
  getKey: (name: string) =>
    new TextEncoder().encode(name === 'p256dh' ? 'public-key-bytes' : 'auth-bytes').buffer,
});

const installServiceWorker = (
  subscription: unknown,
  permission: NotificationPermission = 'granted'
) => {
  const pushManager = {
    subscribe: vi.fn().mockResolvedValue(subscription),
    getSubscription: vi.fn().mockResolvedValue(subscription),
  };
  vi.stubGlobal('navigator', {
    ...navigator,
    serviceWorker: { register: vi.fn().mockResolvedValue({ pushManager }) },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0.0.0 Safari/537.36',
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('Notification', { permission });
  return pushManager;
};

/**
 * Both catches in `push.ts` return `null` so the settings card can never throw
 * — but a bare `catch {}` there once hid a `SecurityError: Script .../sw.js
 * load failed` for an entire debugging session, because the only symptom
 * anywhere was a generic toast. These two tests pin that the reason survives.
 */
it('logs, rather than discards, a service-worker registration failure', async () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  installServiceWorker(fakeSubscription());
  const boom = new Error('Script load failed');
  vi.mocked(navigator.serviceWorker.register).mockRejectedValue(boom);

  expect(await subscribeToPush(KEY)).toBeNull();

  expect(spy).toHaveBeenCalledWith(expect.stringContaining('registration failed'), boom);
  spy.mockRestore();
});

it('logs, rather than discards, a subscribe failure', async () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const pushManager = installServiceWorker(fakeSubscription());
  const boom = new Error('NotAllowedError');
  pushManager.subscribe.mockRejectedValue(boom);

  expect(await subscribeToPush(KEY)).toBeNull();

  expect(spy).toHaveBeenCalledWith(expect.stringContaining('subscribe failed'), boom);
  spy.mockRestore();
});

afterEach(() => {
  vi.unstubAllGlobals();
  // `localStorage` persists across tests in this file the same way
  // `vi.stubGlobal` would if left unrestored — `component/notification-settings/
  // index.test.tsx`'s own `afterEach` takes the identical precaution for the
  // identical reason.
  localStorage.clear();
});

it('reports unsupported where the APIs are absent', () => {
  vi.stubGlobal('navigator', { userAgent: 'x' });
  vi.stubGlobal('isSecureContext', true);

  expect(pushSupport()).toBe('unsupported');
});

it('distinguishes an insecure context from a missing API', () => {
  installServiceWorker(fakeSubscription());
  vi.stubGlobal('isSecureContext', false);

  // Worth its own value, not folded into 'unsupported': the card tells the
  // user their connection is the problem, which is actionable, where "your
  // browser does not support this" would be wrong and unhelpful.
  expect(pushSupport()).toBe('insecure');
});

it('subscribes and returns base64url keys', async () => {
  const pushManager = installServiceWorker(fakeSubscription());

  const result = await subscribeToPush(KEY);

  expect(pushManager.subscribe).toHaveBeenCalledWith(
    expect.objectContaining({ userVisibleOnly: true })
  );
  expect(result?.endpoint).toBe('https://push.example/a');
  expect(result?.p256dh).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(result?.auth).toMatch(/^[A-Za-z0-9_-]+$/);
});

it('returns null rather than throwing when unsupported', async () => {
  vi.stubGlobal('navigator', { userAgent: 'x' });
  vi.stubGlobal('isSecureContext', false);

  expect(await subscribeToPush(KEY)).toBeNull();
  expect(await currentSubscription()).toBeNull();
  await expect(unsubscribeFromPush()).resolves.toBeUndefined();
});

it('unsubscribes the existing subscription', async () => {
  const subscription = fakeSubscription();
  installServiceWorker(subscription);

  await unsubscribeFromPush();

  expect(subscription.unsubscribe).toHaveBeenCalled();
});

it('labels the device from the user agent', () => {
  installServiceWorker(fakeSubscription());

  expect(deviceLabel()).toBe('Chrome on macOS');
});

describe('resyncSubscription', () => {
  it('re-subscribes an EXPIRED subscription when a local id proves one existed before', async () => {
    // The expiry-repair case this function exists for: the browser lost its
    // subscription (`getSubscription()` returns null) but never went through
    // an explicit opt-out or logout, so `LOCAL_SUBSCRIPTION_ID` is still set
    // from whenever it was first created.
    localStorage.setItem(LOCAL_SUBSCRIPTION_ID, 'sub-1');
    const pushManager = installServiceWorker(null, 'granted');
    pushManager.subscribe.mockResolvedValue(fakeSubscription());

    const result = await resyncSubscription(KEY);

    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true })
    );
    expect(result?.endpoint).toBe('https://push.example/a');
  });

  it(
    'does NOT re-subscribe once the local id is gone, even though permission stays granted forever ' +
      '(I-1: a deliberate opt-out must stick, not look identical to an expiry)',
    async () => {
      // No `localStorage.setItem` here: this is the state left behind by a
      // deliberate `toggle(false)` or logout — permission can never be
      // un-granted by this app, so without the id gate this is
      // BYTE-IDENTICAL to the expiry case above and would silently
      // re-subscribe, undoing the opt-out on the next load.
      const pushManager = installServiceWorker(null, 'granted');
      pushManager.subscribe.mockResolvedValue(fakeSubscription());

      const result = await resyncSubscription(KEY);

      expect(pushManager.subscribe).not.toHaveBeenCalled();
      expect(result).toBeNull();
    }
  );

  it('does not subscribe when permission is default or denied', async () => {
    for (const permission of ['default', 'denied'] as const) {
      const pushManager = installServiceWorker(null, permission);

      const result = await resyncSubscription(KEY);

      expect(pushManager.subscribe).not.toHaveBeenCalled();
      expect(result).toBeNull();
    }
  });

  it('returns the existing subscription without subscribing again', async () => {
    const subscription = fakeSubscription();
    const pushManager = installServiceWorker(subscription, 'granted');

    const result = await resyncSubscription(KEY);

    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(result?.endpoint).toBe('https://push.example/a');
  });
});
