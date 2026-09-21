import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => {
  // The track has no border of its own, so the lens (which does) is the only outlined edge.
  // The lens fills the track edge-to-edge (no padding gap) and shares the track's radius, so
  // at the ends the tile's rounded corner sits exactly on the track's — one edge, no double radii.
  //
  // Because the track is borderless, `bg.track` is the ONLY thing holding it apart from the
  // surface underneath — which is why it is its own token rather than the `bg.cardHeader` it
  // used to borrow. `cardHeader` reads on a card but is a single channel-step from `bg.page`
  // in dark mode, so the `page`-surface copy of this control (the Add page's Upload/Request
  // toggle) had no visible track at all.
  const innerRadius = theme.radius.md;
  // The `page` surface, in one place: the track, the lens and the segments all
  // take it together, because the lens shares the track's radius by design (see
  // the note above) — rounding one without the others is what produces the
  // double-radius sliver at the ends.
  const pageRadius = theme.radius.lg;

  return {
    // Equal-width columns: every segment is `1fr`, so the lens has a constant width
    // and only its horizontal position changes. `--seg-count` / `--seg-index` are set
    // inline by the component.
    root: {
      position: 'relative',
      display: 'grid',
      gridAutoFlow: 'column',
      gridAutoColumns: '1fr',
      padding: 0,
      backgroundColor: theme.color.bg.track,
      borderRadius: theme.radius.md,
      userSelect: 'none',
      '-webkit-user-select': 'none',
      '&$disabled': { opacity: 0.5, cursor: 'not-allowed' },
      '&$page': {
        borderRadius: pageRadius,
        '& $lens': { borderRadius: pageRadius },
        '& $segment': { borderRadius: pageRadius },
      },
    },
    // The two surfaces, exactly as `control/select` names them: `card` is the
    // default and adds nothing — the control as it has always looked, `radius.md`,
    // the squarer corner that belongs inside a card (`component/theme-setting`
    // sits in one). `page` matches what a control sitting DIRECTLY on the page
    // is surrounded by — `recipe.card.shell`, the `page`-surface `Select`, the
    // actions bar's own trigger — all of which are `radius.lg`.
    card: {},
    page: {},
    // The active highlight fills the full track height and one column, sliding one own-width
    // per step. Button-like tile: `input` surface, a hairline border, and the flat `cardStack`
    // stack-shadow (no blurred drop shadow). The tile's border is the control's only outlined
    // edge — no track border to double against.
    //
    // Which of the two is lighter flips between modes, and that is fine: light mode recesses
    // the track below a white tile, dark mode raises the track above a dark-well tile, the way
    // every other dark control here (`recipe.input`, the page-surface Select) is a dark well on
    // a lighter page. What matters is the separation, which `bg.track` now guarantees in both.
    lens: {
      position: 'absolute',
      boxSizing: 'border-box',
      zIndex: 0,
      top: 0,
      bottom: 0,
      left: 0,
      width: `calc(100% / var(--seg-count))`,
      backgroundColor: theme.color.bg.input,
      borderStyle: 'solid',
      borderWidth: '1px',
      borderColor: theme.color.border.default,
      boxShadow: theme.shadow.cardStack,
      borderRadius: innerRadius,
      transform: 'translateX(calc(var(--seg-index) * 100%))',
      transition: `transform ${theme.transition.spring}`,
      '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
    },
    segment: {
      position: 'relative',
      zIndex: 1,
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      fontFamily: theme.fontFamily.body,
      fontSize: theme.fontSize.md,
      fontWeight: theme.fontWeight.medium,
      color: theme.color.text.muted,
      padding: `${theme.space.sm} ${theme.space.xl}`,
      borderRadius: innerRadius,
      ...theme.recipe.focusRing,
      transitionProperty: 'color, outline-color',
      transitionDuration: '0.1s',
      transitionTimingFunction: 'ease-in',
      '&:focus-visible': { outlineColor: theme.color.brand.outline },
      '&$active': { color: theme.color.brand.default },
      '&:disabled': { cursor: 'not-allowed' },
    },
    active: {},
    disabled: {},
  };
});
