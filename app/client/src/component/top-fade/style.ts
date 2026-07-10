import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => {
  // Fade the whole frosted layer (translucent tint + blur) via a mask. Deliberately
  // subtle: a low peak alpha so the scrim stays mostly see-through, held only across the
  // status-bar inset, then a long gradual fade to nothing over the space below (including
  // behind the floating top controls). Only rendered in standalone (see NavLayout).
  const peak = 'rgba(0, 0, 0, 0.4)';
  const holdTo = 'env(safe-area-inset-top)';
  const mask = `linear-gradient(to bottom, ${peak}, ${peak} ${holdTo}, transparent)`;

  return {
    root: {
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      // Tall enough that the long fade (from the status-bar inset to here) runs past the
      // floating top controls before it completes.
      height: `calc(env(safe-area-inset-top) + ${theme.space.xxxxxl} * 4)`,
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
