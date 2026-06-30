import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  // Equal-width columns: every segment is `1fr`, so the lens has a constant width
  // and only its horizontal position changes. `--seg-count` / `--seg-index` are set
  // inline by the component.
  root: {
    position: 'relative',
    display: 'inline-grid',
    gridAutoFlow: 'column',
    gridAutoColumns: '1fr',
    padding: theme.space.xxs,
    backgroundColor: theme.color.bg.card,
    borderStyle: 'solid',
    borderWidth: '1px',
    borderColor: theme.color.border.strong,
    borderRadius: theme.radius.pill,
    userSelect: 'none',
    '-webkit-user-select': 'none',
    '&$disabled': { opacity: 0.5, cursor: 'not-allowed' },
  },
  // The active highlight. Width = inner track / count; slides one own-width per step.
  lens: {
    ...theme.recipe.glassHighlight,
    position: 'absolute',
    zIndex: 0,
    top: theme.space.xxs,
    bottom: theme.space.xxs,
    left: theme.space.xxs,
    width: `calc((100% - 2 * ${theme.space.xxs}) / var(--seg-count))`,
    borderRadius: theme.radius.pill,
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
    borderRadius: theme.radius.pill,
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
}));
