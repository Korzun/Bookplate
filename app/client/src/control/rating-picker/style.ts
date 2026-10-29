import { createUseStyles, type Theme } from '~/provider/theme';

// The same track, lens and segment recipe as `control/segmented-control`
// (see the notes there on why the track is borderless and the lens carries the
// only outlined edge). Not shared because this control's lens can be absent —
// an unrated field has no checked segment — and its segments stack an icon
// over a name rather than holding a text label.
export const useStyle = createUseStyles((theme: Theme) => {
  const radius = theme.radius.md;
  // Shared by the real segments and the reveal's copies (see `reveal`), so the
  // two rows lay out identically and the brand copy covers the muted glyph
  // under it exactly.
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
    padding: `${theme.space.sm} ${theme.space.xs}`,
  } as const;
  // The lens's window, in the root's own width: one column, starting at the
  // checked column. The reveal is clipped to it with the SAME transition as
  // the lens, so the two move in lockstep.
  const column = `(100% / var(--seg-count))`;
  const lensWindow = `inset(0 calc((var(--seg-count) - var(--seg-index) - 1) * ${column}) 0 calc(var(--seg-index) * ${column}) round ${radius})`;
  return {
    root: {
      ...grid,
      position: 'relative',
      borderRadius: radius,
      '&$track': { backgroundColor: theme.color.bg.track },
      '&$row': { backgroundColor: 'transparent' },
      userSelect: 'none',
      '-webkit-user-select': 'none',
      '&:not($readOnly) $segment:hover': { color: theme.color.text.secondary },
      // Hovering the checked segment darkens the brand colour, which is painted
      // by the reveal, not by the segment: so recolour the reveal. It only
      // ever shows the checked column, so the whole layer can change.
      '&:not($readOnly):has($segment$active:hover) $reveal': { color: theme.color.brand.hover },
    },
    // Positioned with `left`, not the segmented control's `translateX`. A
    // transform is rasterised at a fractional offset, while the shaded row
    // around the picker clips (`overflow: hidden`) at a pixel-snapped edge; at
    // the right-most segment the two edges coincide and the lens's outer border
    // pixel was half lost. `left` goes through layout and snaps with the clip.
    lens: {
      position: 'absolute',
      boxSizing: 'border-box',
      zIndex: 0,
      top: 0,
      bottom: 0,
      left: 'calc(var(--seg-index) * (100% / var(--seg-count)))',
      width: 'calc(100% / var(--seg-count))',
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
    // to the lens's window (`lensWindow` above), so the brand shows only where the
    // lens is and is unmasked across every segment the lens travels over. The
    // nav's reveal measures its window from the DOM; here the columns are
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
    name: {
      maxWidth: '100%',
      fontSize: theme.fontSize.xs,
      fontWeight: theme.fontWeight.medium,
      lineHeight: 1.2,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      // Shown at every width: the five names are short, the row the picker
      // sits in gives it the full card width on a phone, and a first-time
      // reader needs the words, not just the hands.
    },
    active: {},
    readOnly: {},
    track: {},
    row: {},
  };
});
