import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EXPAND_AFTER, MINIMIZE_SPEED, useMinimizeOnScroll } from './use-minimize-on-scroll';

// jsdom never scrolls, so the position is faked. `scrollY` is an accessor on
// `window`, hence `defineProperty` rather than an assignment.
const scrollTo = (y: number) =>
  Object.defineProperty(window, 'scrollY', { value: y, writable: true, configurable: true });

// A page tall enough that nothing below is clamped as a bottom bounce.
const PAGE_HEIGHT = 5000;
const setPageHeight = (height: number) =>
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    value: height,
    configurable: true,
  });

// The speed is position over `performance.now()`, so the clock is driven by
// hand: each scroll sample says how many ms have passed since the last.
let now = 0;
const FRAME = 16;

const touch = () => fireEvent.touchStart(document.body, { touches: [{ clientX: 0, clientY: 0 }] });
// The scroller reporting the page at `y`, `after` ms on from the previous report.
const scrolledTo = (y: number, after = FRAME) => {
  now += after;
  scrollTo(y);
  fireEvent.scroll(window);
};

// Per-frame distances either side of the line.
const FAST = Math.ceil(MINIMIZE_SPEED * FRAME) + 1;
const SLOW = Math.floor(MINIMIZE_SPEED * FRAME) - 1;

const render = (resetKey = 'a') =>
  renderHook(({ key }: { key: string }) => useMinimizeOnScroll({ resetKey: key }), {
    initialProps: { key: resetKey },
  });

// A finger that has already set the page moving, so there is a sample to
// measure the next frame against.
const underway = (y: number) => {
  touch();
  scrolledTo(y);
};

beforeEach(() => {
  setPageHeight(PAGE_HEIGHT);
  scrollTo(0);
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  scrollTo(0);
  vi.restoreAllMocks();
});

describe('useMinimizeOnScroll', () => {
  it('starts expanded', () => {
    const { result } = render();
    expect(result.current.minimized).toBe(false);
  });

  it('minimizes on a frame that moves down faster than the threshold', () => {
    const { result } = render();
    act(() => underway(100));
    act(() => scrolledTo(100 + FAST));
    expect(result.current.minimized).toBe(true);
  });

  it('stays expanded however far a slow scroll goes', () => {
    const { result } = render();
    act(() => underway(100));
    for (let y = 100 + SLOW; y < 3000; y += SLOW) {
      act(() => scrolledTo(y));
    }
    expect(result.current.minimized).toBe(false);
  });

  it('judges speed by time, not by distance per event', () => {
    const { result } = render();
    act(() => underway(100));
    // The same distance as a fast frame, but taken over four frames' time:
    // a dropped-frame scroller reporting late, or a slow finger.
    act(() => scrolledTo(100 + FAST, FRAME * 4));
    expect(result.current.minimized).toBe(false);
    // And a small distance in a sliver of time is fast.
    act(() => scrolledTo(100 + FAST + 2, 1));
    expect(result.current.minimized).toBe(true);
  });

  it('does not measure a new touch against where the last gesture ended', () => {
    const { result } = render();
    act(() => underway(100));
    // The finger lifts; much later a new touch lands and the page is first
    // reported far below — the scroller catching up, not a fast frame.
    act(() => {
      touch();
      scrolledTo(100 + FAST * 10, 1);
    });
    expect(result.current.minimized).toBe(false);
  });

  it('expands once the page has scrolled back up past the threshold', () => {
    const { result } = render();
    act(() => underway(400));
    act(() => scrolledTo(400 + FAST));
    const peak = 400 + FAST;
    expect(result.current.minimized).toBe(true);

    act(() => scrolledTo(peak - EXPAND_AFTER + 1));
    expect(result.current.minimized).toBe(true);

    act(() => scrolledTo(peak - EXPAND_AFTER));
    expect(result.current.minimized).toBe(false);
  });

  it('measures the way up from the highest point reached, not frame to frame', () => {
    const { result } = render();
    act(() => underway(400));
    act(() => scrolledTo(400 + FAST));
    act(() => scrolledTo(900));
    // Small upward steps no single one of which crosses the threshold.
    act(() => scrolledTo(900 - 5));
    act(() => scrolledTo(900 - 10));
    expect(result.current.minimized).toBe(true);
    act(() => scrolledTo(900 - EXPAND_AFTER));
    expect(result.current.minimized).toBe(false);
  });

  it('expands at the top of the page however it got there', () => {
    const { result } = render();
    act(() => underway(400));
    act(() => scrolledTo(400 + FAST));
    expect(result.current.minimized).toBe(true);

    // A pull past the top is reported as a negative position on iOS.
    act(() => scrolledTo(-30));
    expect(result.current.minimized).toBe(false);
  });

  it('ignores the bounce past the bottom of the page', () => {
    const { result } = render();
    const max = PAGE_HEIGHT - window.innerHeight;
    act(() => underway(max - FAST));
    act(() => scrolledTo(max));
    expect(result.current.minimized).toBe(true);

    // Overshoot, then snap back to the maximum: no real upward travel.
    act(() => scrolledTo(max + 80));
    act(() => scrolledTo(max));
    expect(result.current.minimized).toBe(true);
  });

  /**
   * `router/scroll-restoration` puts a page back where it was on the way in,
   * and re-applies that for several frames while the page grows. Every one
   * of those is a fast jump down; none is the user asking for more room.
   */
  it('ignores scrolls before any touch or wheel on this page', () => {
    const { result } = render();
    act(() => scrolledTo(800, 1));
    act(() => scrolledTo(1200, 1));
    expect(result.current.minimized).toBe(false);

    // Once the user takes over, the first frame is only a sample…
    act(() => {
      touch();
      scrolledTo(1200 + FAST);
    });
    expect(result.current.minimized).toBe(false);
    // …and the next one is measured.
    act(() => scrolledTo(1200 + FAST * 2));
    expect(result.current.minimized).toBe(true);
  });

  it('counts a wheel as the user taking over, for a narrow window with a mouse', () => {
    const { result } = render();
    act(() => {
      fireEvent.wheel(window, { deltaY: 10 });
      scrolledTo(100);
      // Every wheel tick fires again; the samples must survive it.
      fireEvent.wheel(window, { deltaY: 10 });
      scrolledTo(100 + FAST);
    });
    expect(result.current.minimized).toBe(true);
  });

  it('expands and disarms when the reset key changes', () => {
    const { result, rerender } = render('a');
    act(() => underway(400));
    act(() => scrolledTo(400 + FAST));
    expect(result.current.minimized).toBe(true);

    rerender({ key: 'b' });
    expect(result.current.minimized).toBe(false);

    // The new page's restore jump is not a scroll down.
    act(() => scrolledTo(900, 1));
    expect(result.current.minimized).toBe(false);
  });

  it('expands on request, and minimizes again only on a fresh fast frame', () => {
    const { result } = render();
    act(() => underway(400));
    act(() => scrolledTo(400 + FAST));
    expect(result.current.minimized).toBe(true);

    act(() => result.current.expand());
    expect(result.current.minimized).toBe(false);

    act(() => scrolledTo(400 + FAST + SLOW));
    expect(result.current.minimized).toBe(false);
    act(() => scrolledTo(400 + FAST + SLOW + FAST));
    expect(result.current.minimized).toBe(true);
  });
});
