import { createUseStyles, type Theme } from '~/provider/theme';
import { applyTransparency } from '~/utils';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: `${theme.space.xxl} ${theme.space.xxxxl}`,
    backgroundColor: theme.color.bg.page,
    color: theme.color.text.primary,
    overflow: 'hidden',
    [theme.breakpoint.mobile]: {
      display: 'none',
    },
  },
  items: {
    position: 'relative',
    zIndex: theme.zIndex.header,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space.xxl,
    marginTop: '15px', // optical baseline tweak — geometry
  },
  item: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space.md,
    color: theme.color.text.primary,
    textDecoration: 'none',
    fontSize: '0.80rem', // nav-specific size; not on the global fontSize scale
    cursor: 'pointer',
    userSelect: 'none',
    '-webkit-user-select': 'none',
    marginTop: '6px', // optical baseline tweak — geometry
    paddingBottom: '4px', // optical baseline tweak — geometry
    borderBottomStyle: 'solid',
    borderBottomWidth: '2px',
    borderBottomColor: 'transparent',
    transitionProperty: 'color, border-bottom-color',
    transitionDuration: '0.1s',
    transitionTimingFunction: 'ease-in',
    '&:hover': {
      transitionDuration: '0s',
      color: applyTransparency(theme.color.text.primary, 0.467), // matches old '#11111177'
    },
    '&$active': {
      color: theme.color.text.primary,
      borderBottomColor: theme.color.text.primary,
    },
  },
  active: {},
  badge: {
    minWidth: '16px',
    height: '16px',
    padding: `0 ${theme.space.xs}`,
    marginLeft: theme.space.xs,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.danger.default,
    color: theme.color.bg.page,
    fontSize: '0.65rem',
    lineHeight: '16px',
    textAlign: 'center',
  },
  badgeDot: {
    width: '8px',
    height: '8px',
    marginLeft: theme.space.xs,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.danger.default,
    display: 'inline-block',
  },
}));
