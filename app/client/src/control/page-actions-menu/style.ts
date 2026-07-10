import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    position: 'fixed',
    // One rule, both contexts (no iOS-unreliable display-mode query): a browser tab has
    // no top safe-area inset, so env() ≈ 0 and this resolves to the fixed floor (room for
    // the frosted shadow); in standalone the notch inset dominates and pushes the control
    // below the status bar.
    top: `max(${theme.space.xxxl}, calc(env(safe-area-inset-top) + ${theme.space.lg}))`,
    right: theme.space.lg,
    zIndex: theme.zIndex.sticky,
    [theme.breakpoint.normal]: {
      display: 'none',
    },
  },
  trigger: {
    ...theme.recipe.glass,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 46,
    height: 46,
    padding: 0,
    borderRadius: theme.radius.circle,
    color: theme.color.text.primary,
    cursor: 'pointer',
    appearance: 'none',
    '-webkit-appearance': 'none',
  },
  popover: {
    ...theme.recipe.glass,
    position: 'absolute',
    top: `calc(100% + ${theme.space.sm})`,
    right: 0,
    minWidth: 190,
    padding: theme.space.xs,
    borderRadius: theme.radius.md,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xxs,
  },
  item: {
    appearance: 'none',
    '-webkit-appearance': 'none',
    background: 'none',
    border: 'none',
    textAlign: 'left',
    width: '100%',
    padding: `${theme.space.md} ${theme.space.lg}`,
    borderRadius: theme.radius.sm,
    fontSize: theme.fontSize.md,
    fontFamily: theme.fontFamily.body,
    color: theme.color.text.primary,
    cursor: 'pointer',
    '&:hover': { backgroundColor: theme.color.bg.hover },
    '&:disabled': { opacity: 0.5, cursor: 'default' },
  },
  itemDanger: {
    color: theme.color.danger.default,
  },
}));
