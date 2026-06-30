import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => {
  // Shared so the real tab row and the blue reveal row lay out identically (and
  // therefore stay pixel-aligned). The grid gives every tab an equal width (sized to
  // the widest label), so the lens has a constant width and simply slides between tabs.
  const grid = {
    display: 'inline-grid',
    gridAutoFlow: 'column',
    gridAutoColumns: '1fr',
    alignItems: 'center',
    gap: theme.space.xs,
    padding: theme.space.xs,
  } as const;

  const tab = {
    display: 'flex', // block-level so each tab stretches to fill its equal grid column
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    rowGap: theme.space.xxs,
    padding: `${theme.space.sm} ${theme.space.lg}`,
    fontSize: '0.80rem', // nav-specific size; not on the global fontSize scale
  } as const;

  return {
    root: {
      position: 'fixed',
      bottom: 0,
      left: 0,
      width: '100vw',
      zIndex: theme.zIndex.sticky,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      paddingBottom: 'env(safe-area-inset-bottom)',
      [theme.breakpoint.normal]: {
        display: 'none',
      },
    },
    // Plain positioning/layout container. It deliberately has NO backdrop-filter:
    // the frosted glass lives in a separate `glass` layer so the lens and links are
    // its siblings, not its descendants (see `glass` below).
    capsule: {
      ...grid,
      position: 'relative',
      marginBottom: theme.space.xxxl,
    },
    // Frosted-glass background as its own layer behind everything. The backdrop-filter
    // MUST live here and NOT on an ancestor of the lens/links: Safari and Firefox trap
    // positioned descendants of a backdrop-filter element in a stacking sandbox where
    // they don't repaint/animate. As a sibling, the lens morphs freely.
    glass: {
      ...theme.recipe.glass,
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: 0,
      boxSizing: 'border-box',
      borderRadius: theme.radius.pill,
      pointerEvents: 'none',
    },
    // The active-tab lens. Vertical extent is fixed here (top/bottom insets ⇒ always
    // concentric with the capsule); horizontal position + width come from inline style
    // (measured from the active tab). The base rule only transitions opacity, so the
    // first placement jumps into position (no slide-in from the corner). The `lensReady`
    // modifier — added one frame after mount, decoupled from any position change — turns
    // on the morph transition.
    lens: {
      ...theme.recipe.glassHighlight,
      position: 'absolute',
      zIndex: 1,
      left: 0,
      top: theme.space.xs,
      bottom: theme.space.xs,
      boxSizing: 'border-box',
      borderRadius: theme.radius.pill,
      opacity: 0,
      pointerEvents: 'none',
      willChange: 'transform',
      transition: `opacity ${theme.transition.fast}`,
    },
    // Tabs are equal width, so only position changes between tabs — animate transform
    // only (compositor-accelerated, so it stays smooth even while a new page loads on
    // the main thread). Applied to the lens AND the blue reveal so they move in lockstep.
    lensReady: {
      transition: `transform ${theme.transition.spring}, opacity ${theme.transition.fast}`,
      '@media (prefers-reduced-motion: reduce)': {
        transition: `opacity ${theme.transition.fast}`,
      },
    },
    // The real, interactive tabs — kept for layout (they size the capsule), clicks, and
    // aria-current — but rendered transparent. The visible gray + blue come from the two
    // absolute overlays below, so they share one rounding and overlap perfectly.
    item: {
      ...tab,
      position: 'relative',
      zIndex: 2,
      color: 'transparent',
      textDecoration: 'none',
      cursor: 'pointer',
      userSelect: 'none',
      '-webkit-user-select': 'none',
    },
    // The two visible text rows. Both are absolute, shrink-to-fit at the capsule origin,
    // with the same grid — so the browser rounds them to the exact same device pixels and
    // `reveal` (blue) overlays `grayLayer` with no sub-pixel fringe. `reveal` is clipped to
    // a lens-shaped window (set inline) that animates across it; `grayLayer` is always full.
    grayLayer: {
      ...grid,
      position: 'absolute',
      top: 0,
      left: 0,
      zIndex: 3,
      color: theme.color.text.primary,
      pointerEvents: 'none',
    },
    reveal: {
      ...grid,
      position: 'absolute',
      top: 0,
      left: 0,
      zIndex: 4,
      color: theme.color.brand.default,
      pointerEvents: 'none',
      opacity: 0,
      willChange: 'clip-path',
      transition: `opacity ${theme.transition.fast}`,
    },
    revealReady: {
      transition: `clip-path ${theme.transition.spring}, opacity ${theme.transition.fast}`,
      '@media (prefers-reduced-motion: reduce)': {
        transition: `opacity ${theme.transition.fast}`,
      },
    },
    layerItem: {
      ...tab,
    },
  };
});
