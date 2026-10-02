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

  /**
   * The nav's inset on all three open sides: how far it floats above the
   * bottom edge, and how far the capsule and its accessory sit in from the
   * left and right. One distance framing the whole bar rather than three
   * unrelated ones.
   *
   * One expression reused rather than values that happen to agree: it
   * resolves differently per device (a browser tab has no bottom inset, so
   * `env()` is 0 and this falls to the fixed floor; in standalone the home
   * indicator dominates), and hard-coded side padding would match on a
   * desktop screenshot while drifting apart on the device where the inset
   * actually does something.
   */
  const bottomInset = `max(${theme.space.xxxl}, calc(env(safe-area-inset-bottom) - ${theme.space.xl}))`;

  return {
    root: {
      position: 'fixed',
      bottom: 0,
      left: 0,
      width: '100vw',
      zIndex: theme.zIndex.sticky,
      // The side padding below is INSIDE the 100vw above; without this the
      // nav would be two insets wider than the viewport and put a horizontal
      // scrollbar on every page. There is no global `border-box` reset in
      // this app, so it is declared here.
      boxSizing: 'border-box',
      display: 'flex',
      // SPIKE: a row again. The accessory buttons sit BESIDE the capsule
      // rather than above it, so the nav keeps its single-line height.
      alignItems: 'center',
      // Pushed to opposite edges: the capsule takes one side and its
      // accessory the other, each inset by the same distance the bar floats
      // above the bottom.
      justifyContent: 'space-between',
      paddingLeft: bottomInset,
      paddingRight: bottomInset,
      // Both modes are mounted and fixed at the same coordinates, so they
      // already occupy the same place with no stacking context to arrange —
      // only one is ever visible. Transitioning here is what turns the swap
      // into a cross-fade.
      transition: `opacity ${theme.transition.medium}, transform ${theme.transition.medium}`,
      '@media (prefers-reduced-motion: reduce)': {
        // Matching `lensReady`/`revealReady` above: the fade stays (it is what
        // makes the swap legible), the movement goes.
        transition: `opacity ${theme.transition.fast}`,
      },
      // A floor, not the spacing: `space-between` sets the real gap. This
      // only stops the two touching if the capsule ever grows wide enough to
      // close the distance itself.
      gap: bottomInset,
      // One rule, both contexts (no iOS-unreliable display-mode query): a browser tab has
      // no bottom safe-area inset, so env() ≈ 0 and this resolves to the fixed floor
      // (room for the frosted shadow); in standalone the home-indicator inset dominates
      // and the pill dips toward it while staying clear.
      paddingBottom: bottomInset,
      [theme.breakpoint.normal]: {
        display: 'none',
      },
    },
    /**
     * The mode that is not current. Still mounted — that is the whole point,
     * since an unmounted bar has nothing to animate from — but inert, out of
     * the accessibility tree, and transparent to clicks so the visible bar
     * beneath receives them.
     *
     * Scaled slightly down rather than slid away: the two bars occupy the same
     * box, so any translation large enough to read would leave one of them
     * visibly off-centre mid-flight.
     */
    inactiveMode: {
      opacity: 0,
      transform: 'scale(0.96)',
      pointerEvents: 'none',
    },

    // Plain positioning/layout container. It deliberately has NO backdrop-filter:
    // the frosted glass lives in a separate `glass` layer so the lens and links are
    // its siblings, not its descendants (see `glass` below).
    capsule: {
      ...grid,
      position: 'relative',
      marginBottom: 0,
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
    /**
     * SPIKE. A one-item capsule beside the main one: the settings button in
     * the default mode, and the collapsed "back to the main tabs" button in
     * settings mode.
     *
     * Its own glass surface, matching the capsule's, so the two read as
     * siblings of one system rather than a bar with something stuck to it.
     * Square padding keeps it circular-ish at `radius.pill`.
     */
    accessory: {
      ...theme.recipe.glass,
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      boxSizing: 'border-box',
      borderRadius: theme.radius.pill,
      // Matches the capsule's height by STRETCHING to it rather than by
      // padding the icon to a number that happens to agree today: the capsule
      // is sized by its own content (icon + label + paddings), so any change
      // to a tab's type or spacing would silently desync a hand-tuned value.
      // `root` centres its children, so this opts out for itself alone.
      alignSelf: 'stretch',
      // Width comes from the capsule's MEASURED height (set inline), which is
      // what makes this a circle rather than the tall oval `aspect-ratio`
      // produces on a flex item — see `LensBox.capsuleHeight`.
      padding: 0,
      color: theme.color.text.primary,
      textDecoration: 'none',
      cursor: 'pointer',
      userSelect: 'none',
      '-webkit-user-select': 'none',
    },
    /** The accessory for the section you are currently in. */
    accessoryActive: {
      color: theme.color.brand.default,
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
    // The positioning context for the badge — the icon alone, not the whole
    // item. The previous `top: 2px; right: 10px` was measured against the
    // item's capsule, so it tracked the capsule's geometry rather than the
    // icon's.
    iconWrap: {
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    // A real pill, matching `nav-desktop`. This style used to be shared with
    // the dot below — an 8x8 box with no padding — so a numeric badge was
    // squeezed into a dot and clipped.
    badge: {
      position: 'absolute',
      top: '-6px',
      right: '-8px',
      minWidth: '16px',
      height: '16px',
      padding: `0 ${theme.space.xs}`,
      boxSizing: 'border-box',
      borderRadius: theme.radius.pill,
      backgroundColor: theme.color.danger.default,
      color: theme.color.bg.page,
      fontSize: '0.65rem',
      lineHeight: '16px',
      textAlign: 'center',
      pointerEvents: 'none',
    },
    badgeDot: {
      position: 'absolute',
      top: '-3px',
      right: '-4px',
      width: '8px',
      height: '8px',
      borderRadius: theme.radius.pill,
      backgroundColor: theme.color.danger.default,
      pointerEvents: 'none',
    },
  };
});
