import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    gap: theme.space.md,
    alignItems: 'center',
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
    '&:hover': {
      borderColor: theme.color.brand.hover,
      color: theme.color.brand.hover,
    },
  },
  popoverAnchor: {
    position: 'absolute',
    top: `calc(100% + ${theme.space.sm})`,
    right: 0,
    zIndex: theme.zIndex.sticky,
  },
}));
