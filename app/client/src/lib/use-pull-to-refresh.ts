import { useEffect, useRef, useState } from 'react';

export type PullPhase = 'idle' | 'pulling' | 'armed' | 'refreshing';

export type PullState = { phase: PullPhase; offset: number };

/** How far past the top (in px of overscroll) the page has to be pulled before a release refreshes. */
export const PULL_THRESHOLD = 70;

// The indicator stops following the overscroll here, so a long pull does not
// drag it down over the page's controls. (Fixed chrome does not ride the
// rubber-band on iOS, so the indicator is moved by this number, not the page.)
const MAX_OFFSET = PULL_THRESHOLD * 1.5;

const IDLE: PullState = { phase: 'idle', offset: 0 };

// iOS reports the rubber-band as a negative scroll position while the page is
// pulled past its top; anywhere else, and on platforms that clamp, this is 0.
const overscroll = () => Math.max(0, -window.scrollY);

/**
 * A pull-down-to-refresh gesture for the installed (standalone) app, where the
 * browser's own pull-to-refresh is not available.
 *
 * Rides the scroller's own overscroll rather than running a gesture of its own:
 * while a finger is down, the page's rubber-band past the top IS the pull, and
 * the hook reports how far it has gone so a caller can draw an indicator. Past
 * `PULL_THRESHOLD` the pull is armed; lifting the finger then calls `onRefresh`
 * and holds `refreshing` (with the offset pinned at the threshold) until the
 * returned promise settles, success or not.
 *
 * Nothing here cancels a touch, so there is no gesture to claim and no way to
 * lose one. An earlier version tracked touches itself and default-prevented
 * the moves to keep the page from rubber-banding under its indicator — but the
 * scroller decides on a touch's FIRST move whether it owns the gesture, and
 * after that nothing can take it back. A pull that began as a scroll and
 * carried on past the top, or that landed while the previous scroll was still
 * settling, was the scroller's, and the same motion did two different things
 * depending on what the finger had done a moment earlier. Letting the page
 * bounce and measuring the bounce makes every pull past the top the same pull.
 *
 * Deliberately left alone: touches that start inside an open `<dialog>` (modals
 * scroll on their own), overscroll with no finger on the screen (a fling that
 * bounces off the top is not a request), and anything while a refresh is
 * already in flight.
 */
export function usePullToRefresh(
  onRefresh: () => Promise<unknown>,
  { enabled = true }: { enabled?: boolean } = {}
): PullState {
  const [state, setState] = useState<PullState>(IDLE);
  // The refresh callback is read through a ref so a caller passing an inline
  // closure does not re-bind the listeners on every render.
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const refreshingRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let armed = false;
    let published: PullState = IDLE;

    const publish = (next: PullState) => {
      if (next.phase === published.phase && next.offset === published.offset) return;
      published = next;
      setState(next);
    };

    // Read on every move AND every scroll event while the finger is down: the
    // finger keeps moving when the scroller is quiet, and the scroller keeps
    // reporting when the finger pauses.
    const track = () => {
      const offset = Math.min(overscroll(), MAX_OFFSET);
      armed = offset >= PULL_THRESHOLD;
      publish(offset > 0 ? { phase: armed ? 'armed' : 'pulling', offset } : IDLE);
    };

    const onEnd = () => {
      stopTracking();
      if (!armed) {
        publish(IDLE);
        return;
      }
      armed = false;
      refreshingRef.current = true;
      publish({ phase: 'refreshing', offset: PULL_THRESHOLD });
      const settle = () => {
        refreshingRef.current = false;
        publish(IDLE);
      };
      let result: Promise<unknown>;
      try {
        result = onRefreshRef.current();
      } catch {
        settle();
        return;
      }
      result.then(settle, settle);
    };

    const onCancel = () => {
      stopTracking();
      publish(IDLE);
    };

    const stopTracking = () => {
      document.removeEventListener('touchmove', track);
      window.removeEventListener('scroll', track);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onCancel);
    };

    const onStart = (event: TouchEvent) => {
      if (refreshingRef.current) return;
      if (event.target instanceof Element && event.target.closest('dialog[open]')) return;

      armed = false;
      document.addEventListener('touchmove', track, { passive: true });
      window.addEventListener('scroll', track, { passive: true });
      document.addEventListener('touchend', onEnd);
      document.addEventListener('touchcancel', onCancel);
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      stopTracking();
    };
  }, [enabled]);

  return state;
}
