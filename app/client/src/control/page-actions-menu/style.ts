import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  // Positioned by the row `component/page` puts it in (sticky, so it rides the
  // page up and then holds), not by itself. `relative` anchors the popover;
  // `auto` keeps it at the trailing end whether or not a back button leads.
  root: {
    position: 'relative',
    marginLeft: 'auto',
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
