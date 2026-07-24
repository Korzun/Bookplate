import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router';

// Navigation state that pages (e.g. the back control) can attach to a push so this
// manager restores the destination's remembered scroll instead of jumping to the top.
export type ScrollRestoreState = { restoreScroll?: boolean };

// Remembered scroll offsets, keyed by pathname+search rather than history key: the
// back control performs a *forward* push (a new history entry) rather than a real
// POP, so keying by history entry would never find the position saved on the way in.
// A path key survives that round-trip. Module-scoped so it persists for the session.
const positions = new Map<string, number>();

const keyOf = (location: { pathname: string; search: string }) =>
  location.pathname + location.search;

// Re-apply a restore until the page has grown tall enough to reach it. Detail pages
// (e.g. a series) mount showing a short "Loading…" card and only render their full
// height a tick later, so a single scrollTo would be clamped near the top. Returns a
// cancel function so a subsequent navigation can abandon a pending restore.
function restoreTo(y: number): () => void {
  window.scrollTo(0, y);
  if (y === 0 || typeof requestAnimationFrame !== 'function') return () => {};

  let frame = 0;
  let rafId = 0;
  const step = () => {
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    if (maxScroll >= y) {
      // Page is finally tall enough — land on the saved offset and stop.
      window.scrollTo(0, y);
      return;
    }
    // Still too short (content loading). Keep waiting, up to ~half a second, then
    // give up rather than spin forever if the page never regains its old height.
    if (frame++ < 30) rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);
  return () => cancelAnimationFrame(rafId);
}

// Manages window scroll across client-side navigations: new pages open at the top,
// while returning to a page (browser back, or the in-app back control) restores where
// the user left off. Render once inside the router, above the routes.
export const ScrollRestoration = () => {
  const location = useLocation();
  const navigationType = useNavigationType();
  const key = keyOf(location);

  const keyRef = useRef(key);
  const cancelRef = useRef<() => void>(() => {});

  // Continuously record the current page's scroll so that, however the user leaves it,
  // the last offset is already saved for a future return.
  useEffect(() => {
    try {
      // Take over from the browser's native restoration; it fires before async page
      // content has laid out, so it restores against the wrong (short) height.
      window.history.scrollRestoration = 'manual';
    } catch {
      // Non-fatal: some environments expose a read-only history.
    }
    const onScroll = () => positions.set(keyRef.current, window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useLayoutEffect(() => {
    cancelRef.current();
    keyRef.current = key;

    const state = location.state as ScrollRestoreState | null;
    const shouldRestore = navigationType === 'POP' || state?.restoreScroll === true;
    const saved = positions.get(key);

    if (shouldRestore && saved !== undefined) {
      cancelRef.current = restoreTo(saved);
    } else {
      window.scrollTo(0, 0);
      cancelRef.current = () => {};
    }
    // Keyed on location.key so this runs on every navigation, including repeat visits
    // to the same path. navigationType/state are read fresh at run time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  useEffect(() => () => cancelRef.current(), []);

  return null;
};
