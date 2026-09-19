import { useEffect } from 'react';

/**
 * The custom property this hook publishes on the document element. Exported so
 * the stylesheet that consumes it (`router/nav-layout-style`) names the same
 * string rather than repeating a literal that could drift.
 */
export const scrollOffsetProperty = '--page-scroll-y';

// Past the tallest chrome anything slides out from under, every consumer has
// long since hit the position it clamps to, so a larger number would change
// nothing on screen — it would only cost a style recalculation per scrolled
// pixel, for the whole length of a library. 200 clears the switcher band (~84px)
// with room for the largest notch inset on top of it.
const maxOffset = 200;

/**
 * Publishes how far the page has scrolled as a CSS custom property, so that
 * chrome positioned against the VIEWPORT can move with chrome positioned in the
 * PAGE — something CSS alone cannot express.
 *
 * The one thing that needs this today is the mobile back / page-actions
 * buttons: they are `position: fixed`, and the admin's library-switcher band
 * sits above them in the page's flow. Offsetting them by the band's height
 * (`router/nav-layout-style`) keeps them off it, but a fixed offset is only
 * right while the page is at the top — scroll, and the band slides away while
 * the buttons hang behind at a height that no longer means anything. Subtract
 * this offset from theirs and they ride the band up, then stop at the position
 * they have when there is no band at all.
 *
 * `enabled` is not a convenience: an UNSET property is what tells a consumer
 * there is nothing above it, so for every reader — no band — the property must
 * never appear and the `var()` fallback must stand. Writing `0px` would pin the
 * buttons under a band that was never rendered.
 */
export function useScrollOffsetProperty(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const root = document.documentElement;
    let published = -1;

    const publish = () => {
      const offset = Math.min(window.scrollY, maxOffset);
      // Clamped, so scrolling on past the cap stops writing entirely rather
      // than setting the same value over and over.
      if (offset === published) return;
      published = offset;
      root.style.setProperty(scrollOffsetProperty, `${offset}px`);
    };

    // Immediately, not on the first scroll event: a restored scroll position
    // (`router/scroll-restoration`) means the page can mount part-way down.
    publish();

    // Passive, and a bare property write — no rAF throttle, matching the scroll
    // listener `router/scroll-restoration` already runs on every page.
    window.addEventListener('scroll', publish, { passive: true });
    return () => {
      window.removeEventListener('scroll', publish);
      root.style.removeProperty(scrollOffsetProperty);
    };
  }, [enabled]);
}
