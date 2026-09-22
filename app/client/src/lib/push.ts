/**
 * Everything about the browser's push APIs, so no component has to know them.
 *
 * Every function here is safe to call on a browser that has none of these
 * APIs: they return `null` or resolve to nothing rather than throwing, because
 * the settings card renders on every install — including the LAN-only HTTP one
 * where push can never work — and a thrown `ReferenceError` there would take
 * the whole account page down.
 *
 * Web Push requires a SECURE CONTEXT. A Bookplate reached over plain HTTP
 * exposes neither `ServiceWorker` nor `PushManager`, which is a browser rule
 * this app cannot work around. On iOS there is a second rule: push is only
 * permitted from a PWA added to the Home Screen. `site.webmanifest` already
 * declares `display: standalone`, so that path works; nothing here can detect
 * it in advance, so the subscribe call is simply allowed to fail.
 */

const SW_PATH = '/sw.js';

/**
 * Key `localStorage` remembers this browser's server-side subscription row
 * under. Exported so Tasks 13 and 15 (the settings card and logout) share one
 * literal instead of each hard-coding it.
 */
export const LOCAL_SUBSCRIPTION_ID = 'bookplate.push.subscriptionId';

export type PushSupport = 'supported' | 'insecure' | 'unsupported';

/**
 * Three values rather than a boolean, because the card says something
 * different for each. `insecure` is actionable ("push needs an HTTPS
 * connection"); `unsupported` is not, and telling an HTTP user their browser
 * is at fault would simply be wrong.
 */
export function pushSupport(): PushSupport {
  const hasApis =
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof PushManager !== 'undefined';
  if (!hasApis) return 'unsupported';
  return isSecureContext ? 'supported' : 'insecure';
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/** The subscription's keys arrive as `ArrayBuffer`s; the server stores base64url. */
function toBase64Url(buffer: ArrayBuffer | null): string {
  if (buffer === null) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** `applicationServerKey` wants raw bytes, not the base64url the server sends. */
function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * A hint for a human choosing which device to revoke, not an identity — which
 * is why it is a crude user-agent read and not a fingerprint, and why it is
 * not user-editable.
 */
export function deviceLabel(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const platform = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'this device';
  return `${browser} on ${platform}`;
}

export type SubscribeResult = {
  endpoint: string;
  p256dh: string;
  auth: string;
  label: string;
};

function describeSubscription(subscription: PushSubscription): SubscribeResult {
  return {
    endpoint: subscription.endpoint,
    p256dh: toBase64Url(subscription.getKey('p256dh')),
    auth: toBase64Url(subscription.getKey('auth')),
    label: deviceLabel(),
  };
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (pushSupport() !== 'supported') return null;
  try {
    return await navigator.serviceWorker.register(SW_PATH);
  } catch {
    return null;
  }
}

/**
 * Registers the worker and subscribes. The CALLER is responsible for having
 * obtained permission from a user gesture first — `Notification.requestPermission()`
 * may only be called from one, and a `denied` answer is permanent until the
 * user clears it in browser settings, so the single chance to ask must be spent
 * on a click that asked for it. Nothing in this module prompts on its own.
 */
export async function subscribeToPush(vapidPublicKey: string): Promise<SubscribeResult | null> {
  const reg = await registration();
  if (reg === null) return null;
  try {
    const subscription = await reg.pushManager.subscribe({
      // Required by Chrome, and honest: every push this app sends shows a
      // notification.
      userVisibleOnly: true,
      applicationServerKey: fromBase64Url(vapidPublicKey),
    });
    return describeSubscription(subscription);
  } catch {
    return null;
  }
}

/**
 * The existing subscription, if this browser has one. Used on app load to
 * re-register it with the server: endpoints rotate, and a browser that
 * believes it is subscribed while the server holds no row for it receives
 * nothing and reports no error anywhere.
 */
export async function currentSubscription(): Promise<SubscribeResult | null> {
  const reg = await registration();
  if (reg === null) return null;
  const subscription = await reg.pushManager.getSubscription();
  return subscription === null ? null : describeSubscription(subscription);
}

export async function unsubscribeFromPush(): Promise<void> {
  const reg = await registration();
  if (reg === null) return;
  const subscription = await reg.pushManager.getSubscription();
  if (subscription !== null) await subscription.unsubscribe();
}

/**
 * Closes the gap `currentSubscription` leaves open. The design deliberately
 * does not handle `pushsubscriptionchange` in the service worker — the worker
 * holds no access token and could not authenticate the mutation — and instead
 * relies on this being called at load time to re-sync.
 *
 * That covers a browser that still HAS a subscription. It does not cover the
 * case that matters most: when a browser EXPIRES a subscription,
 * `getSubscription()` returns `null`, and a load-time re-sync that only reads
 * finds nothing — the user silently stops receiving push forever, with no
 * error anywhere, until they happen to toggle the setting off and on again.
 *
 * So when permission is already `'granted'` and no subscription exists, this
 * subscribes again. That needs no user gesture precisely because permission
 * is already in hand, so no prompt appears — this function never prompts,
 * and never subscribes without permission already granted.
 */
export async function resyncSubscription(vapidPublicKey: string): Promise<SubscribeResult | null> {
  if (pushSupport() !== 'supported') return null;
  if (pushPermission() !== 'granted') return null;
  const existing = await currentSubscription();
  if (existing !== null) return existing;
  return subscribeToPush(vapidPublicKey);
}
