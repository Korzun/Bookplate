import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    ...theme.recipe.glass,
    position: 'fixed',
    // Shared with the page actions menu, and shared with the library-switcher band
    // that pushes both of them clear of itself — see
    // `theme.layout.floatingControlTop`.
    top: theme.layout.floatingControlTop,
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
