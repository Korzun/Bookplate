import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * How FAST the page has to move down, in px per ms, before the bar minimizes.
 * Speed rather than distance: a reader creeping down a long page line by line
 * never loses the bar however far they go, and a flick to get on with it
 * loses it at once. Measured between consecutive scroll events, so it is the
 * speed of the frame that crosses the line, not an average over the gesture.
 * Reading pace is a few tenths of a px per ms; a flick is several.
 */
export const MINIMIZE_SPEED = 0.8;

/**
 * How far the page has to travel UP, from the highest point reached since the
 * bar minimized, before it expands again. Distance, not speed, and a short
 * one: getting the navigation back should take less than losing it did.
 */
export const EXPAND_AFTER = 12;

// The page's position with the rubber-band taken out. iOS reports a pull past
// the top as a negative `scrollY` and a bounce past the bottom as one beyond
// the maximum; left in, the snap-back from a bottom bounce would read as a
// scroll UP and expand the bar at the end of every fling.
const position = () => {
  const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  return Math.min(Math.max(0, window.scrollY), max);
};

export interface MinimizeOnScroll {
  /** Whether the bar is currently minimized. */
  minimized: boolean;
  /** Expand the bar now (a tap on the minimized bar), as if the page had scrolled up. */
  expand: () => void;
}

/**
 * Minimize-on-scroll for bottom chrome, the way the iOS tab bar behaves:
 * scrolling down minimizes it, scrolling up — or reaching the top — brings it
 * back.
 *
 * The state is a single boolean toggled from the scroll listener, never a
 * per-frame position. On iOS the scroller runs on the compositor and a
 * main-thread write that chases it lands a frame late (which is why the page's
 * floating controls moved to `position: sticky`); a discrete toggle that CSS
 * then animates has nothing to chase.
 *
 * Only scrolls the USER drives count. `router/scroll-restoration` jumps the
 * page to a remembered offset on the way back into a page, and re-applies it
 * for several frames while the page grows — every one a jump down. The
 * listener therefore only infers direction once a touch or a wheel has been
 * seen since `resetKey` last changed; until then it tracks the position and
 * says nothing. A change of `resetKey` (the route) also expands the bar: a new
 * page starts with its navigation showing.
 *
 * The way back up has hysteresis — distance from the highest point reached
 * since minimizing, not frame to frame — so the bar does not flap while a
 * finger hovers or a fling settles.
 */
export function useMinimizeOnScroll({ resetKey }: { resetKey: string }): MinimizeOnScroll {
  const [minimized, setMinimized] = useState(false);
  // Mirrors the state for the listener, which must not re-bind on every toggle.
  const minimizedRef = useRef(false);
  // While minimized: the highest position reached, which `EXPAND_AFTER` is
  // measured back from.
  const peakRef = useRef(0);
  // The previous scroll sample, for the speed; `null` until one is taken AFTER
  // the user took over, so the first user-driven frame is never measured
  // against a programmatic jump that happened to land just before it.
  const lastRef = useRef<{ y: number; at: number } | null>(null);
  const armedRef = useRef(false);

  const set = useCallback((next: boolean) => {
    if (minimizedRef.current === next) return;
    minimizedRef.current = next;
    setMinimized(next);
  }, []);

  const expand = useCallback(() => set(false), [set]);

  useEffect(() => {
    set(false);
    armedRef.current = false;
    lastRef.current = null;
  }, [resetKey, set]);

  useEffect(() => {
    // A new touch is a new gesture: the speed between where the last one left
    // the page and this one's first frame means nothing, so the sample goes.
    // A wheel tick does NOT clear it — ticks arrive several per scroll, and
    // clearing on each would leave a mouse user with no two samples to speed.
    const armTouch = () => {
      armedRef.current = true;
      lastRef.current = null;
    };
    const armWheel = () => {
      armedRef.current = true;
    };

    const onScroll = () => {
      if (!armedRef.current) return;
      const y = position();
      const at = performance.now();
      const last = lastRef.current;
      lastRef.current = { y, at };

      if (y <= 0) {
        set(false);
        return;
      }
      if (minimizedRef.current) {
        if (y > peakRef.current) {
          peakRef.current = y;
        } else if (peakRef.current - y >= EXPAND_AFTER) {
          set(false);
        }
        return;
      }
      // Two samples in the same instant have no speed between them.
      if (last === null || at <= last.at) return;
      if ((y - last.y) / (at - last.at) >= MINIMIZE_SPEED) {
        set(true);
        peakRef.current = y;
      }
    };

    document.addEventListener('touchstart', armTouch, { passive: true });
    window.addEventListener('wheel', armWheel, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('touchstart', armTouch);
      window.removeEventListener('wheel', armWheel);
      window.removeEventListener('scroll', onScroll);
    };
  }, [set]);

  return { minimized, expand };
}
