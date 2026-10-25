import { createUseStyles, type Theme } from '~/provider/theme';

// The same track, lens and segment recipe as `control/segmented-control`
// (see the notes there on why the track is borderless and the lens carries the
// only outlined edge). Not shared because this control's lens can be absent —
// an unrated field has no checked segment — and its segments stack an icon
// over a name rather than holding a text label.
export const useStyle = createUseStyles((theme: Theme) => {
  const radius = theme.radius.md;
  return {
    root: {
      position: 'relative',
      display: 'grid',
      gridAutoFlow: 'column',
      gridAutoColumns: '1fr',
      padding: 0,
      borderRadius: radius,
      '&$track': { backgroundColor: theme.color.bg.track },
      '&$row': { backgroundColor: 'transparent' },
      userSelect: 'none',
      '-webkit-user-select': 'none',
      '&:not($readOnly) $segment:hover': { color: theme.color.text.secondary },
      '&:not($readOnly) $segment$active:hover': { color: theme.color.brand.hover },
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
    segment: {
      position: 'relative',
      zIndex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.space.xxs,
      minWidth: 0,
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      fontFamily: theme.fontFamily.body,
      color: theme.color.text.muted,
      padding: `${theme.space.sm} ${theme.space.xs}`,
      borderRadius: radius,
      ...theme.recipe.focusRing,
      transitionProperty: 'color, outline-color',
      transitionDuration: '0.1s',
      transitionTimingFunction: 'ease-in',
      '&:focus-visible': { outlineColor: theme.color.brand.outline },
      '&$active': { color: theme.color.brand.default },
      '$readOnly &': { cursor: 'default' },
    },
    name: {
      maxWidth: '100%',
      fontSize: theme.fontSize.xs,
      fontWeight: theme.fontWeight.medium,
      lineHeight: 1.2,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      // Five named segments do not fit a phone-width card; the icons carry the
      // value there and the group's `title` still names the checked one.
      [theme.breakpoint.mobile]: { display: 'none' },
    },
    active: {},
    readOnly: {},
    track: {},
    row: {},
  };
});
