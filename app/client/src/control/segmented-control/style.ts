import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => {
  // The lens fills the track edge-to-edge (no padding gap), so its corners sit directly
  // against the track's 1px border. Matching the track's inner radius (outer radius minus
  // the border) makes the two corners coincide — one rounded edge, no nested "double" radii.
  const innerRadius = `calc(${theme.radius.md} - 1px)`;

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
      backgroundColor: theme.color.bg.cardHeader,
      borderStyle: 'solid',
      borderWidth: '1px',
      borderColor: theme.color.border.strong,
      borderRadius: theme.radius.md,
      userSelect: 'none',
      '-webkit-user-select': 'none',
      '&$disabled': { opacity: 0.5, cursor: 'not-allowed' },
    },
    // The active highlight fills the full track height and one column, sliding one own-width
    // per step. Raised button-like tile: `input` surface, a hairline border, and the flat
    // `cardStack` stack-shadow (no blurred drop shadow). The recessed `cardHeader` track makes
    // the lighter tile read clearly; with no gap the tile border sits flush against the track
    // border — one crisp edge, not a separated concentric arc.
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
      '&$active': { color: theme.color.text.primary },
      '&:disabled': { cursor: 'not-allowed' },
    },
    active: {},
    disabled: {},
  };
});
