import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  // Positioned by the row `component/page` puts it in (sticky, so it rides the
  // page up and then holds), not by itself.
  root: {
    ...theme.recipe.glass,
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
