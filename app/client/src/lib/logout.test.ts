import { beforeEach, expect, it, vi } from 'vitest';

import { consumeLoggedOutMark, logout } from './logout';
import { getToken, setToken } from './token';

/**
 * Global-stubbing approach matched to `lib/push.test.ts`: a fake
 * `navigator.serviceWorker.register` resolving to a registration whose
 * `pushManager.getSubscription` resolves to a subscription carrying the
 * given `unsubscribe` mock.
 */
const stubServiceWorkerWithSubscription = ({ unsubscribe }: { unsubscribe: () => unknown }) => {
  const subscription = { unsubscribe };
  const pushManager = { getSubscription: vi.fn().mockResolvedValue(subscription) };
  vi.stubGlobal('navigator', {
    ...navigator,
    serviceWorker: { register: vi.fn().mockResolvedValue({ pushManager }) },
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('isSecureContext', true);
};

/**
 * Simulates a browser whose push teardown itself fails, i.e. the case
 * `logout()`'s `try`/`catch` around `unsubscribeFromPush()` exists for —
 * `getSubscription` rejecting, not `register` throwing, because
 * `registration()` already swallows a `register` failure by returning
 * `null`, which would let `unsubscribeFromPush()` resolve rather than throw.
 */
const stubServiceWorkerThatThrows = () => {
  const pushManager = { getSubscription: vi.fn().mockRejectedValue(new Error('sw broken')) };
  vi.stubGlobal('navigator', {
    ...navigator,
    serviceWorker: { register: vi.fn().mockResolvedValue({ pushManager }) },
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('isSecureContext', true);
};

/**
 * Simulates a stuck push-service round trip: `getSubscription()` returns a
 * promise that never settles. A `try`/`catch` alone cannot protect against
 * this — only the race in `logout()` can — so this stub exists to prove that
 * race actually bounds the wait rather than merely reading well in the code.
 */
const stubServiceWorkerThatHangs = () => {
  const pushManager = { getSubscription: vi.fn(() => new Promise<never>(() => {})) };
  vi.stubGlobal('navigator', {
    ...navigator,
    serviceWorker: { register: vi.fn().mockResolvedValue({ pushManager }) },
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('isSecureContext', true);
};

beforeEach(() => {
  // Order matters: one test below stubs `sessionStorage` itself, so unstub
  // before `sessionStorage.clear()` reaches for it.
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

it('clears the token and redirects even when the server call fails', async () => {
  setToken('t');
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
  const assign = vi.fn();
  vi.stubGlobal('location', {
    ...window.location,
    set href(v: string) {
      assign(v);
    },
  });

  await logout();

  // Best-effort: a failed POST must NOT block the local teardown.
  expect(getToken()).toBeNull();
  expect(assign).toHaveBeenCalledWith('/login');
});

it('POSTs to the server logout endpoint', async () => {
  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('location', { ...window.location, set href(_v: string) {} });

  await logout();

  // The whole point of the request: it must hit the right URL with the right
  // method, or the server-side cookie clear silently stops happening while
  // every other assertion in this file (which only checks local teardown)
  // keeps passing.
  expect(fetchSpy).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
});

it('arms the one-shot mark so the next bootstrap refresh is skipped', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('location', { ...window.location, set href(_v: string) {} });

  await logout();

  expect(consumeLoggedOutMark()).toBe(true);
  // ONE shot: a second read must be false, or a later legitimate login would
  // have its own bootstrap refresh suppressed too.
  expect(consumeLoggedOutMark()).toBe(false);
});

it('reports no mark when nothing armed it', () => {
  expect(consumeLoggedOutMark()).toBe(false);
});

it('unsubscribes this browser from push before clearing the session', async () => {
  const unsubscribe = vi.fn().mockResolvedValue(true);
  stubServiceWorkerWithSubscription({ unsubscribe });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('location', { ...window.location, set href(_v: string) {} });

  await logout();

  // Otherwise a shared browser keeps delivering the previous account's
  // book-request notifications to whoever signs in next.
  expect(unsubscribe).toHaveBeenCalled();
});

it('still logs out when unsubscribing fails', async () => {
  stubServiceWorkerThatThrows();
  setToken('t');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
  const assign = vi.fn();
  vi.stubGlobal('location', {
    ...window.location,
    set href(v: string) {
      assign(v);
    },
  });

  // Push teardown is best-effort; a browser that cannot unsubscribe must not
  // be a browser that cannot log out.
  await expect(logout()).resolves.toBeUndefined();

  expect(getToken()).toBeNull();
  expect(assign).toHaveBeenCalledWith('/login');
});

it('does not hang forever when unsubscribing never settles', async () => {
  stubServiceWorkerThatHangs();
  setToken('t');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
  const assign = vi.fn();
  vi.stubGlobal('location', {
    ...window.location,
    set href(v: string) {
      assign(v);
    },
  });
  vi.useFakeTimers();

  const pending = logout();
  // Matches PUSH_TEARDOWN_TIMEOUT_MS in logout.ts (kept unexported — this
  // value must move in lockstep with it, the same tradeoff
  // password-result-modal/index.test.tsx makes with its 5000ms countdown).
  await vi.advanceTimersByTimeAsync(2000);
  await expect(pending).resolves.toBeUndefined();

  vi.useRealTimers();
  // The hang must not have prevented the rest of the teardown from running.
  expect(getToken()).toBeNull();
  expect(assign).toHaveBeenCalledWith('/login');
});

it('still clears the token and redirects when sessionStorage is blocked', async () => {
  // Blocked/partitioned storage makes `sessionStorage.setItem` throw a
  // SecurityError. `markLoggedOut()` runs FIRST in `logout()`, so an unguarded
  // throw there aborts the whole teardown: no `clearToken`, no redirect — and
  // in the password-change path the rejection surfaces as a FAILED password
  // change that actually succeeded. The marker is an optimisation; the
  // teardown is the contract.
  setToken('t');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('sessionStorage', {
    getItem: () => null,
    removeItem: () => {},
    clear: () => {},
    setItem: () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
  const assign = vi.fn();
  vi.stubGlobal('location', {
    ...window.location,
    set href(v: string) {
      assign(v);
    },
  });

  await expect(logout()).resolves.toBeUndefined();

  expect(getToken()).toBeNull();
  expect(assign).toHaveBeenCalledWith('/login');
});
