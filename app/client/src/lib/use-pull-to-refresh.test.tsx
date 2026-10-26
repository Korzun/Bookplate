import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PULL_THRESHOLD, usePullToRefresh } from './use-pull-to-refresh';

// jsdom never scrolls, so the offset is faked. `scrollY` is an accessor on
// `window`, hence `defineProperty` rather than an assignment.
const scrollTo = (y: number) =>
  Object.defineProperty(window, 'scrollY', { value: y, writable: true, configurable: true });

const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });

// A finger landing at (x, y) and travelling to each of `path` in turn. Returns
// the last move event so a test can inspect whether it was default-prevented.
const drag = (target: Element, from: [number, number], ...path: [number, number][]) => {
  fireEvent.touchStart(target, touch(...from));
  let last: Event | undefined;
  for (const [x, y] of path) {
    const event = new TouchEvent('touchmove', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: [{ clientX: x, clientY: y }] });
    target.dispatchEvent(event);
    last = event;
  }
  return last;
};

const release = (target: Element) => fireEvent.touchEnd(target, { touches: [] });

// The pull a finger has to make on screen to arm: the hook damps the raw
// distance, so this is comfortably more than the threshold itself.
const ARMING_PULL = PULL_THRESHOLD * 4;

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

  it('follows a downward pull from the top of the page', () => {
    const { result } = renderHook(() => usePullToRefresh(() => Promise.resolve()));

    act(() => {
      drag(document.body, [100, 100], [100, 140]);
    });

    expect(result.current.phase).toBe('pulling');
    expect(result.current.offset).toBeGreaterThan(0);
    expect(result.current.offset).toBeLessThan(PULL_THRESHOLD);
  });

  it('arms once the pull passes the threshold', () => {
    const { result } = renderHook(() => usePullToRefresh(() => Promise.resolve()));

    act(() => {
      drag(document.body, [100, 100], [100, 100 + ARMING_PULL]);
    });

    expect(result.current.phase).toBe('armed');
    expect(result.current.offset).toBeGreaterThanOrEqual(PULL_THRESHOLD);
  });

  it('tucks away without refreshing when released short of the threshold', () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    act(() => {
      drag(document.body, [100, 100], [100, 140]);
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
      drag(document.body, [100, 100], [100, 100 + ARMING_PULL]);
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
      drag(document.body, [100, 100], [100, 100 + ARMING_PULL]);
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
      drag(document.body, [100, 100], [100, 100 + ARMING_PULL]);
      release(document.body);
      drag(document.body, [100, 100], [100, 100 + ARMING_PULL]);
      release(document.body);
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('refreshing');
  });

  it('does nothing when the page is scrolled down', () => {
    scrollTo(120);
    const onRefresh = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    act(() => {
      drag(document.body, [100, 100], [100, 100 + ARMING_PULL]);
      release(document.body);
    });

    expect(onRefresh).not.toHaveBeenCalled();
    expect(result.current).toEqual({ phase: 'idle', offset: 0 });
  });

  it('does nothing for a drag that goes mostly sideways', () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    act(() => {
      // Commits sideways first; the later downward travel must not count.
      drag(document.body, [100, 100], [140, 102], [300, 100 + ARMING_PULL]);
      release(document.body);
    });

    expect(onRefresh).not.toHaveBeenCalled();
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
      drag(inner, [100, 100], [100, 100 + ARMING_PULL]);
      release(inner);
    });

    expect(onRefresh).not.toHaveBeenCalled();
    expect(result.current).toEqual({ phase: 'idle', offset: 0 });
  });

  it('does nothing when disabled', () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => usePullToRefresh(onRefresh, { enabled: false }));

    act(() => {
      drag(document.body, [100, 100], [100, 100 + ARMING_PULL]);
      release(document.body);
    });

    expect(onRefresh).not.toHaveBeenCalled();
    expect(result.current).toEqual({ phase: 'idle', offset: 0 });
  });

  it('cancels the native overscroll while pulling, so the page does not rubber-band under the indicator', () => {
    renderHook(() => usePullToRefresh(() => Promise.resolve()));

    let move: Event | undefined;
    act(() => {
      move = drag(document.body, [100, 100], [100, 140]);
    });

    expect(move?.defaultPrevented).toBe(true);
  });

  it('leaves a normal upward scroll alone', () => {
    renderHook(() => usePullToRefresh(() => Promise.resolve()));

    let move: Event | undefined;
    act(() => {
      move = drag(document.body, [100, 200], [100, 160]);
    });

    expect(move?.defaultPrevented).toBe(false);
  });

  it('stops listening once unmounted', () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    const { unmount } = renderHook(() => usePullToRefresh(onRefresh));
    unmount();

    act(() => {
      drag(document.body, [100, 100], [100, 100 + ARMING_PULL]);
      release(document.body);
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });
});
