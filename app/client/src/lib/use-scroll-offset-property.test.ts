import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { scrollOffsetProperty, useScrollOffsetProperty } from './use-scroll-offset-property';

const read = () => document.documentElement.style.getPropertyValue(scrollOffsetProperty);

// jsdom never scrolls, so the offset is faked. `scrollY` is an accessor on
// `window`, hence `defineProperty` rather than an assignment.
const scrollTo = (y: number) => {
  Object.defineProperty(window, 'scrollY', { value: y, writable: true, configurable: true });
  fireEvent.scroll(window);
};

afterEach(() => {
  document.documentElement.style.removeProperty(scrollOffsetProperty);
  Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
});

describe('useScrollOffsetProperty', () => {
  it('publishes the offset on mount, before any scroll', () => {
    scrollTo(24);
    renderHook(() => useScrollOffsetProperty(true));

    // The page can already be scrolled when the hook mounts — a back
    // navigation restores an offset — so waiting for a scroll EVENT would
    // leave the chrome a whole page-height out of position until the user
    // touched the screen.
    expect(read()).toBe('24px');
  });

  it('follows the page as it scrolls', () => {
    renderHook(() => useScrollOffsetProperty(true));
    expect(read()).toBe('0px');

    scrollTo(40);

    expect(read()).toBe('40px');
  });

  it('stops growing once nothing on screen can move any further', () => {
    renderHook(() => useScrollOffsetProperty(true));

    scrollTo(10_000);

    // Whatever reads this property clamps against its own resting position, so
    // past a screenful the number stops meaning anything — and every further
    // pixel of scroll would be a style recalculation that changes nothing.
    expect(Number.parseInt(read(), 10)).toBeLessThanOrEqual(400);
  });

  it('publishes nothing at all when disabled', () => {
    renderHook(() => useScrollOffsetProperty(false));

    scrollTo(40);

    // Not "0px" — absent. The property is what tells a consumer there is
    // chrome above it to slide out from under; an unset property is what lets
    // its `var()` fallback stand.
    expect(read()).toBe('');
  });

  it('removes the property when it unmounts', () => {
    const { unmount } = renderHook(() => useScrollOffsetProperty(true));
    scrollTo(40);

    unmount();

    expect(read()).toBe('');
  });

  it('stops following the page once it unmounts', () => {
    const { unmount } = renderHook(() => useScrollOffsetProperty(true));
    unmount();

    scrollTo(40);

    // A listener left on `window` would keep writing to the document element
    // for the rest of the session, and nothing would ever clear it.
    expect(read()).toBe('');
  });
});
