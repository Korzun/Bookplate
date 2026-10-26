import { useEffect, useRef, useState } from 'react';

export type PullPhase = 'idle' | 'pulling' | 'armed' | 'refreshing';

export type PullState = { phase: PullPhase; offset: number };

/** How far (in damped px) the indicator has to travel before a release refreshes. */
export const PULL_THRESHOLD = 70;

// The raw finger travel is halved, so arming takes a deliberate pull rather than
// a flick, and capped so the indicator stops short of the page's floating controls.
const DAMPING = 0.5;
const MAX_OFFSET = PULL_THRESHOLD * 1.5;
// A drag is treated as sideways (and left alone) once it has moved this far
// before its vertical travel caught up.
const DIRECTION_LOCK = 8;

const IDLE: PullState = { phase: 'idle', offset: 0 };

/**
 * A pull-down-to-refresh gesture for the installed (standalone) app, where the
 * browser's own pull-to-refresh is not available.
 *
 * Tracks a touch that lands while the window is scrolled to the very top and
 * reports how far the user has pulled, damped, so a caller can draw an
 * indicator following the finger. Past `PULL_THRESHOLD` the gesture is armed;
 * releasing then calls `onRefresh` and holds `refreshing` (with the offset
 * pinned at the threshold) until the returned promise settles, success or not.
 *
 * Deliberately left alone: touches that start inside an open `<dialog>` (modals
 * scroll on their own), drags that commit sideways first, anything while the
 * page is scrolled, and anything while a refresh is already in flight.
 *
 * While a pull is being tracked the move events are default-prevented: at the
 * top of the page the only native behaviour left is the overscroll
 * rubber-band, which would otherwise drag the whole page down underneath the
 * indicator. The move listener is only attached for the duration of a gesture,
 * so the non-passive listener costs nothing the rest of the time.
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

    let startX = 0;
    let startY = 0;
    let direction: 'undecided' | 'vertical' = 'undecided';
    let armed = false;

    const onMove = (event: TouchEvent) => {
      const point = event.touches[0];
      if (!point) return;
      const dx = point.clientX - startX;
      const dy = point.clientY - startY;

      if (direction === 'undecided') {
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > DIRECTION_LOCK) {
          stopTracking();
          return;
        }
        if (dy <= 0) return; // A normal scroll up the page; not ours.
        direction = 'vertical';
      }

      event.preventDefault();
      const offset = Math.min(Math.max(dy, 0) * DAMPING, MAX_OFFSET);
      armed = offset >= PULL_THRESHOLD;
      setState({ phase: armed ? 'armed' : 'pulling', offset });
    };

    const onEnd = () => {
      stopTracking();
      if (!armed) {
        setState(IDLE);
        return;
      }
      armed = false;
      refreshingRef.current = true;
      setState({ phase: 'refreshing', offset: PULL_THRESHOLD });
      const settle = () => {
        refreshingRef.current = false;
        setState(IDLE);
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
      setState(IDLE);
    };

    const stopTracking = () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onCancel);
    };

    const onStart = (event: TouchEvent) => {
      if (refreshingRef.current) return;
      if (window.scrollY > 0) return;
      const point = event.touches[0];
      if (!point) return;
      if (event.target instanceof Element && event.target.closest('dialog[open]')) return;

      startX = point.clientX;
      startY = point.clientY;
      direction = 'undecided';
      armed = false;
      document.addEventListener('touchmove', onMove, { passive: false });
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
