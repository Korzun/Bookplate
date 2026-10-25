import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.space.sm,
  },
  // The button is the whole hit target — the circle plus, with `showNames`, the
  // name under it — so clicking the name selects too. It draws nothing itself:
  // the circle carries the fill and the focus ring, so the ring stays round
  // whether or not a name hangs below it.
  radio: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.space.xs,
    padding: 0,
    border: 'none',
    background: 'transparent',
    color: theme.color.text.secondary,
    cursor: 'pointer',
    outline: 'none',
    fontFamily: 'inherit',
    '&:focus-visible $circle': { outlineColor: theme.color.brand.outline },
    '&:hover:not($readOnly)': { color: theme.color.text.primary },
    '&$checked, &$checked:hover': { color: theme.color.text.primary },
    '&$readOnly': { cursor: 'default' },
  },
  circle: {
    ...theme.recipe.focusRing,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.circle,
    color: 'inherit',
    transition: `background-color ${theme.transition.fast}, color ${theme.transition.fast}`,
    '$checked &': {
      backgroundColor: theme.color.brand.default,
      color: theme.color.text.onPrimary,
    },
  },
  md: {
    '& $circle': { width: '40px', height: '40px' },
  },
  sm: {
    '& $circle': { width: '32px', height: '32px' },
  },
  name: {
    fontSize: theme.fontSize.xs,
    lineHeight: 1.2,
    color: theme.color.text.secondary,
    '$checked &': { color: theme.color.text.primary },
  },
  checked: {},
  readOnly: {},
}));
