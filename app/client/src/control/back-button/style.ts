import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    ...theme.recipe.glass,
    position: 'fixed',
    // One rule, both contexts (no iOS-unreliable display-mode query): a browser tab has
    // no top safe-area inset, so env() ≈ 0 and this resolves to the fixed floor (room for
    // the frosted shadow); in standalone the notch inset dominates and pushes the control
    // below the status bar.
    top: `max(${theme.space.xxxl}, calc(env(safe-area-inset-top) + ${theme.space.lg}))`,
    left: theme.space.lg,
    zIndex: theme.zIndex.sticky,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 46,
    height: 46,
    borderRadius: theme.radius.circle,
    color: theme.color.text.primary,
    cursor: 'pointer',
    userSelect: 'none',
    '-webkit-user-select': 'none',
    [theme.breakpoint.normal]: {
      display: 'none',
    },
  },
  // ChevronIcon points right by default; rotate to point left ("back").
  icon: {
    transform: 'rotate(180deg)',
  },
}));
