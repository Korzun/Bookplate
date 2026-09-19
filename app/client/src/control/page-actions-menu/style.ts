import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    position: 'fixed',
    // Shared with the back button, and shared with the library-switcher band that
    // pushes both of them clear of itself — see `theme.layout.floatingControlTop`.
    top: theme.layout.floatingControlTop,
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
  popoverAnchor: {
    position: 'absolute',
    top: `calc(100% + ${theme.space.sm})`,
    right: 0,
  },
}));
