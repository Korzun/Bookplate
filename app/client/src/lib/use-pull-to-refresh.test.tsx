import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PULL_THRESHOLD, usePullToRefresh } from './use-pull-to-refresh';

// jsdom never scrolls, so the position is faked. `scrollY` is an accessor on
// `window`, hence `defineProperty` rather than an assignment. A NEGATIVE value
// is how iOS reports the page pulled past its top (the rubber-band).
const scrollTo = (y: number) =>
  Object.defineProperty(window, 'scrollY', { value: y, writable: true, configurable: true });

const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });

const press = (target: Element) => fireEvent.touchStart(target, touch(100, 100));
const release = (target: Element) => fireEvent.touchEnd(target, { touches: [] });

// A finger that has dragged the page `by` px past its top: the scroller
// reports the overscroll, and both the move and the scroll event reach the hook.
const pullTo = (target: Element, by: number) => {
  scrollTo(-by);
  const move = new TouchEvent('touchmove', { bubbles: true, cancelable: true });
  Object.defineProperty(move, 'touches', { value: [{ clientX: 100, clientY: 100 + by * 2 }] });
  target.dispatchEvent(move);
  fireEvent.scroll(window);
  return move;
};

// An overscroll comfortably past the threshold.
const ARMING_PULL = PULL_THRESHOLD + 20;

const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

afterEach(() => {
  scrollTo(0);
  document.body.innerHTML = '';
});

describe('usePullToRefresh', () => {
  it('starts idle with no offset', () => {
    const { result } = renderHook(() => usePullToRefresh(() => Promise.resolve()));

    expect(result.current).toEqual({ phase: 'idle', offset: 0 });
  });

  it('follows the overscroll while a finger pulls the page past its top', () => {
    const { result } = renderHook(() => usePullToRefresh(() => Promise.resolve()));

    act(() => {
      press(document.body);
      pullTo(document.body, 40);
    });

    expect(result.current).toEqual({ phase: 'pulling', offset: 40 });
  });

  it('arms once the overscroll passes the threshold', () => {
    const { result } = renderHook(() => usePullToRefresh(() => Promise.resolve()));

    act(() => {
      press(document.body);
      pullTo(document.body, ARMING_PULL);
    });

    expect(result.current).toEqual({ phase: 'armed', offset: ARMING_PULL });
  });

  it('stops following the overscroll past its cap', () => {
    const { result } = renderHook(() => usePullToRefresh(() => Promise.resolve()));

    act(() => {
      press(document.body);
      pullTo(document.body, PULL_THRESHOLD * 4);
    });

    expect(result.current.phase).toBe('armed');
    expect(result.current.offset).toBe(PULL_THRESHOLD * 1.5);
  });

  it('disarms when the finger pushes the page back before letting go', () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    act(() => {
      press(document.body);
      pullTo(document.body, ARMING_PULL);
      pullTo(document.body, 20);
      release(document.body);
    });

    expect(onRefresh).not.toHaveBeenCalled();
    expect(result.current).toEqual({ phase: 'idle', offset: 0 });
  });

  it('tucks away without refreshing when released short of the threshold', () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    act(() => {
      press(document.body);
      pullTo(document.body, 40);
      release(document.body);
    });

    expect(onRefresh).not.toHaveBeenCalled();
    expect(result.current).toEqual({ phase: 'idle', offset: 0 });
  });

  it('refreshes when released while armed, and holds the indicator until the refresh settles', async () => {
    const refresh = deferred();
    const onRefresh = vi.fn(() => refresh.promise);
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    act(() => {
      press(document.body);
      pullTo(document.body, ARMING_PULL);
      release(document.body);
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('refreshing');
    expect(result.current.offset).toBe(PULL_THRESHOLD);

    await act(async () => {
      refresh.resolve();
      await refresh.promise;
    });

    expect(result.current).toEqual({ phase: 'idle', offset: 0 });
  });

  it('returns to idle when the refresh fails', async () => {
    const refresh = deferred();
    const { result } = renderHook(() => usePullToRefresh(() => refresh.promise));

    act(() => {
      press(document.body);
      pullTo(document.body, ARMING_PULL);
      release(document.body);
    });
    expect(result.current.phase).toBe('refreshing');

    await act(async () => {
      refresh.reject(new Error('network'));
      await refresh.promise.catch(() => {});
    });

    expect(result.current).toEqual({ phase: 'idle', offset: 0 });
  });

  it('ignores a new pull while a refresh is in flight', () => {
    const refresh = deferred();
    const onRefresh = vi.fn(() => refresh.promise);
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    act(() => {
      press(document.body);
      pullTo(document.body, ARMING_PULL);
      release(document.body);
      press(document.body);
      pullTo(document.body, ARMING_PULL);
      release(document.body);
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('refreshing');
  });

  it('does nothing while the page is scrolled down', () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    act(() => {
      press(document.body);
      scrollTo(120);
      fireEvent.scroll(window);
      release(document.body);
    });

    expect(onRefresh).not.toHaveBeenCalled();
    expect(result.current).toEqual({ phase: 'idle', offset: 0 });
  });

  it('ignores an overscroll with no finger on the screen', () => {
    const { result } = renderHook(() => usePullToRefresh(() => Promise.resolve()));

    act(() => {
      // A fling bouncing off the top: the scroller overshoots on its own.
      scrollTo(-40);
      fireEvent.scroll(window);
    });

    expect(result.current).toEqual({ phase: 'idle', offset: 0 });
  });

  it('does nothing for a touch that starts inside an open modal', () => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    const inner = document.createElement('div');
    dialog.append(inner);
    document.body.append(dialog);
    const onRefresh = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    act(() => {
      press(inner);
      pullTo(inner, ARMING_PULL);
      release(inner);
    });

    expect(onRefresh).not.toHaveBeenCalled();
    expect(result.current).toEqual({ phase: 'idle', offset: 0 });
  });

  it('does nothing when disabled', () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => usePullToRefresh(onRefresh, { enabled: false }));

    act(() => {
      press(document.body);
      pullTo(document.body, ARMING_PULL);
      release(document.body);
    });

    expect(onRefresh).not.toHaveBeenCalled();
    expect(result.current).toEqual({ phase: 'idle', offset: 0 });
  });

  it('never cancels a move: the scroller keeps every gesture', () => {
    renderHook(() => usePullToRefresh(() => Promise.resolve()));

    let move: Event | undefined;
    act(() => {
      press(document.body);
      move = pullTo(document.body, ARMING_PULL);
    });

    expect(move?.defaultPrevented).toBe(false);
  });

  it('stops listening once unmounted', () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    const { unmount } = renderHook(() => usePullToRefresh(onRefresh));
    unmount();

    act(() => {
      press(document.body);
      pullTo(document.body, ARMING_PULL);
      release(document.body);
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });
});
