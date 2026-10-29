import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => {
  // Fade the whole frosted layer (translucent tint + blur) via a mask. Deliberately
  // subtle: a low peak alpha so the scrim stays mostly see-through, held across the
  // status-bar inset, then faded to nothing over a short `tail`. Only rendered in
  // standalone (see NavLayout).
  //
  // The tail is SHORT on purpose. It used to run `space.xxxxxl * 4` (128px) below
  // the inset so the gradient was gradual, but anything the page puts in that band
  // is drawn through a partial blur and tint even at scroll top. The admin's
  // library-switcher band (`router/nav-layout-style`) put its picker `space.xxl`
  // (16px) below the inset, where the old tail still had ~⅓ of its strength: on an
  // iPhone the picker's text rendered greyer and softer — no pixel at full text
  // colour, and measurably lower edge contrast — than with the fade gone. With the
  // tail at `space.md` the same device screenshots measure pixel-identical to the
  // fade being absent (device screenshots, 2026-10-26), so the blur has ended before
  // the picker begins while content scrolling up still blurs across the inset and
  // dissolves over the tail instead of hitting a hard edge.
  //
  // The chrome that rests nearest this edge in the installed app — the picker, and
  // the fixed back / page-actions controls — keeps `space.xxxxl` between the inset
  // and itself (`theme.layout.floatingControlTopBase`, `router/nav-layout-style`),
  // so there is clear page between where the blur ends and where they start.
  const peak = 'rgba(0, 0, 0, 0.4)';
  const holdTo = 'env(safe-area-inset-top)';
  const tail = theme.space.md;
  const mask = `linear-gradient(to bottom, ${peak}, ${peak} ${holdTo}, transparent)`;

  return {
    root: {
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      // The mask's gradient ends at 100%, so the element's height IS the fade's extent.
      height: `calc(env(safe-area-inset-top) + ${tail})`,
      // Semi-transparent frosted glass: the theme's translucent tint over a light backdrop
      // blur, so content behind shows through softly rather than being covered. Both the
      // tint and blur are theme-aware / adapt to light and dark mode.
      backgroundColor: theme.color.bg.glass,
      backdropFilter: 'blur(8px)',
      '-webkit-backdrop-filter': 'blur(8px)',
      maskImage: mask,
      '-webkit-mask-image': mask,
      // Where backdrop-filter is unsupported, lean on the more opaque glass fallback.
      '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))': {
        backgroundColor: theme.color.bg.glassFallback,
      },
      // Above page content, below the floating controls / nav (theme.zIndex.sticky).
      zIndex: theme.zIndex.header,
      pointerEvents: 'none',
      [theme.breakpoint.normal]: {
        display: 'none',
      },
    },
  };
});
