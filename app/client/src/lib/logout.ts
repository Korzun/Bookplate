import { LOCAL_SUBSCRIPTION_ID, unsubscribeFromPush } from './push';
import { clearToken } from './token';

const LOGGED_OUT_KEY = 'bookplate:logged-out';

/**
 * Bounds the wait on `unsubscribeFromPush()` inside `logout()`. A `try`/`catch`
 * only catches a promise that *rejects* — it does nothing for one that never
 * settles, and `register()`/`getSubscription()`/`unsubscribe()` are all
 * awaited with no timeout of their own. A stuck push-service round trip would
 * otherwise suspend `logout()` forever: no token clear, no redirect — which is
 * the one thing this best-effort block must never cause.
 */
const PUSH_TEARDOWN_TIMEOUT_MS = 2000;

/**
 * Arms a one-shot marker telling `AuthProvider` to skip its next mount-time
 * silent refresh.
 *
 * `sessionStorage`, not a module variable: `logout()` ends with a full document
 * navigation, so nothing in memory survives to be read on the other side.
 */
export function markLoggedOut(): void {
  sessionStorage.setItem(LOGGED_OUT_KEY, '1');
}

/**
 * Reads and CLEARS the marker. One-shot by construction, so it can never wedge
 * a real login: a user who logs out and immediately logs back in consumes it on
 * the `/login` mount, well before the new session exists.
 */
export function consumeLoggedOutMark(): boolean {
  const marked = sessionStorage.getItem(LOGGED_OUT_KEY) !== null;
  sessionStorage.removeItem(LOGGED_OUT_KEY);
  return marked;
}

/**
 * The single logout. BEST-EFFORT by design (step-10 spec §5): a failed
 * server-side cookie clear must not strand the user in a session they asked to
 * end. That is only safe because `markLoggedOut` stops the surviving refresh
 * cookie from silently re-authenticating them on arrival at `/login` — see
 * `provider/auth/provider.tsx`'s bootstrap effect.
 */
export async function logout(): Promise<void> {
  // Best-effort, and deliberately first: a shared browser that stayed
  // subscribed would keep showing the previous account's book-request
  // notifications to whoever signs in next. Must run before the session
  // teardown below — once the session cookie/token is gone, this browser has
  // no authenticated way to do anything about its subscription.
  //
  // Deliberately does NOT call the remove mutation: the server-side row is
  // left in place on purpose. Once the browser unsubscribes here, the
  // endpoint is dead, so the next push to it returns 410 and the driver
  // prunes the row automatically. Calling an authenticated mutation here
  // would race the session teardown that is about to invalidate the token,
  // which is worse than leaving a dead row for the driver to clean up.
  //
  // Both a `try`/`catch` AND a race, because they guard different failures:
  // the `catch` handles `unsubscribeFromPush()` throwing or rejecting; the
  // race (see `PUSH_TEARDOWN_TIMEOUT_MS`) handles it never settling at all.
  // A timeout is treated as success-ish, not an error, so logout proceeds
  // either way — a subscription left running past it is the same dead-row
  // case the comment above already covers.
  try {
    await Promise.race([
      unsubscribeFromPush(),
      new Promise<void>((resolve) => setTimeout(resolve, PUSH_TEARDOWN_TIMEOUT_MS)),
    ]);
    localStorage.removeItem(LOCAL_SUBSCRIPTION_ID);
  } catch {
    // Ignored on purpose; see above.
  }
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // best-effort; the local teardown below runs regardless
  }
  try {
    markLoggedOut();
  } catch {
    // Best-effort too. `sessionStorage` throws a SecurityError under blocked or
    // partitioned storage, and running first must not make the marker — an
    // optimisation guarding a failed-POST edge case — able to abort the
    // teardown that IS the contract. Unguarded, the rejection would also
    // surface in the password-change path as a FAILED password change that
    // actually succeeded.
  }
  clearToken();
  window.location.href = '/login';
}
