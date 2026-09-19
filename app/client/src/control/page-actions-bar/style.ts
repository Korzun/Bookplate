import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    gap: theme.space.md,
    alignItems: 'center',
    // Takes whatever width the page's own header content leaves, so `$spacer`
    // below can hold the trailing actions hard right. Growing HERE rather than
    // in `component/page`'s header row is what keeps that content at its
    // natural size: it must not change width with the actions beside it.
    flexGrow: 1,
    [theme.breakpoint.mobile]: {
      display: 'none',
    },
  },
  spacer: {
    flexGrow: 1,
  },
  more: {
    position: 'relative',
    display: 'inline-flex',
  },
  // Native button styled to match the default Button variant, so it can carry
  // aria-haspopup / aria-expanded (the Button primitive is a role="button" div).
  moreTrigger: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5em',
    color: theme.color.text.primary,
    ...theme.recipe.focusRing,
    backgroundColor: theme.color.bg.input,
    borderColor: theme.color.border.default,
    borderStyle: 'solid',
    borderWidth: '1px',
    borderRadius: theme.radius.lg,
    boxShadow: theme.shadow.cardStack,
    padding: `${theme.space.md} ${theme.space.xxl}`,
    fontSize: '0.80rem',
    fontFamily: theme.fontFamily.body,
    cursor: 'pointer',
    appearance: 'none',
    '-webkit-appearance': 'none',
    transitionProperty: 'color, background-color',
    transitionDuration: '0.1s',
    transitionTimingFunction: 'ease-in',
    '&:hover, &:focus, &:active': { transitionDuration: '0s' },
    '&:hover': {
      borderColor: theme.color.brand.hover,
      color: theme.color.brand.hover,
    },
    '&:focus': {
      borderColor: '#FFF',
      outlineColor: theme.color.brand.outline,
      boxShadow: `0px 2px 0px transparent`,
    },
    '&:active': {
      borderColor: theme.color.brand.active,
      color: theme.color.brand.active,
    },
  },
  popoverAnchor: {
    position: 'absolute',
    top: `calc(100% + ${theme.space.sm})`,
    right: 0,
    zIndex: theme.zIndex.sticky,
  },
}));
