import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => {
  const radius = theme.radius.md;
  // Shared by the real segments and the reveal's copies (see `reveal`), so
  // the two rows lay out identically and the brand copy covers the muted
  // glyph under it exactly.
  const grid = {
    display: 'grid',
    gridAutoFlow: 'column',
    gridAutoColumns: '1fr',
    padding: 0,
  } as const;
  const segment = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space.xxs,
    minWidth: 0,
    boxSizing: 'border-box',
    fontFamily: theme.fontFamily.body,
    padding: `${theme.space.sm} ${theme.space.xl}`,
  } as const;
  // The lens's window, in the root's own width: one column, starting at the
  // checked column. The reveal is clipped to it with the SAME transition as
  // the lens, so the two move in lockstep.
  const column = `(100% / var(--seg-count))`;
  const lensWindow = `inset(0 calc((var(--seg-count) - var(--seg-index) - 1) * ${column}) 0 calc(var(--seg-index) * ${column}) round ${radius})`;

  return {
    // The track has no border of its own, so the lens (which does) is the
    // control's only outlined edge; the lens fills the track edge to edge and
    // shares its radius, so at the ends the two corners coincide. Being
    // borderless, `bg.track` is the ONLY thing holding the track apart from
    // the surface under it — its own token because `bg.cardHeader` is a single
    // channel-step from `bg.page` in dark mode.
    root: {
      ...grid,
      position: 'relative',
      borderRadius: radius,
      '&$card': { backgroundColor: theme.color.bg.track },
      '&$row': { backgroundColor: 'transparent' },
      userSelect: 'none',
      '-webkit-user-select': 'none',
      // Icon-over-caption segments are narrow; the text padding would squeeze
      // five of them off a phone-width row.
      '&$iconic $segment, &$iconic $layerItem': {
        padding: `${theme.space.sm} ${theme.space.xs}`,
      },
      '&:not($readOnly) $segment:hover': { color: theme.color.text.secondary },
      // Hovering the checked segment darkens the brand colour, which is
      // painted by the reveal, not by the segment: so recolour the reveal. It
      // only ever shows the checked column, so the whole layer can change.
      '&:not($readOnly):has($segment$active:hover) $reveal': { color: theme.color.brand.hover },
    },
    card: {},
    row: {},
    // Positioned with `left`, not `translateX`. A transform is rasterised at a
    // fractional offset, while a shaded row around the control clips
    // (`overflow: hidden`) at a pixel-snapped edge; at the last segment the
    // two edges coincide and the lens's outer border pixel was half lost.
    // `left` goes through layout and snaps with the clip.
    //
    // Button-like tile: `input` surface, a hairline border, the flat
    // `cardStack` shadow. Which of tile and track is lighter flips between
    // modes, and that is fine: light mode recesses the track below a white
    // tile, dark mode raises it above a dark-well tile, like every other dark
    // control here. What matters is the separation, which `bg.track`
    // guarantees in both.
    lens: {
      position: 'absolute',
      boxSizing: 'border-box',
      zIndex: 0,
      top: 0,
      bottom: 0,
      left: `calc(var(--seg-index) * ${column})`,
      width: `calc(${column})`,
      backgroundColor: theme.color.bg.input,
      borderStyle: 'solid',
      borderWidth: '1px',
      borderColor: theme.color.border.default,
      boxShadow: theme.shadow.cardStack,
      borderRadius: radius,
      transition: `left ${theme.transition.spring}`,
      '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
    },
    // Always muted, checked or not: the brand colour comes from the `reveal`
    // copy above it. A brand `$active` rule here would light the destination
    // the moment it is checked, ahead of the lens, which is the very thing
    // the reveal exists to avoid.
    segment: {
      ...segment,
      position: 'relative',
      zIndex: 1,
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      color: theme.color.text.muted,
      borderRadius: radius,
      ...theme.recipe.focusRing,
      transitionProperty: 'color, outline-color',
      transitionDuration: '0.1s',
      transitionTimingFunction: 'ease-in',
      '&:focus-visible': { outlineColor: theme.color.brand.outline },
      '$readOnly &': { cursor: 'default' },
    },
    // The brand-coloured copy of the row, above the real segments and clipped
    // to the lens's window (`lensWindow` above), so the brand shows only where
    // the lens is and is unmasked across every segment the lens travels over.
    // The nav's reveal measures its window from the DOM; here the columns are
    // equal fractions of the root, so the window is the same `--seg-index`
    // arithmetic the lens uses, in CSS alone. Not interactive: the real
    // segment under each copy takes the click, the focus ring and the hover.
    reveal: {
      ...grid,
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: 2,
      color: theme.color.brand.default,
      pointerEvents: 'none',
      clipPath: lensWindow,
      willChange: 'clip-path',
      transition: `clip-path ${theme.transition.spring}, color 0.1s ease-in`,
      '@media (prefers-reduced-motion: reduce)': { transition: 'color 0.1s ease-in' },
    },
    layerItem: {
      ...segment,
    },
    label: {
      fontSize: theme.fontSize.md,
      fontWeight: theme.fontWeight.medium,
    },
    // The label under an icon: small, one line, clipped rather than wrapped.
    caption: {
      maxWidth: '100%',
      fontSize: theme.fontSize.xs,
      lineHeight: 1.2,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    active: {},
    readOnly: {},
    iconic: {},
  };
});
