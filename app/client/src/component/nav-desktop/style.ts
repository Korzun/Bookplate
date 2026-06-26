import { createUseStyles, type Theme } from '~/provider/theme';
import { applyTransparency } from '~/utils';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    position: 'sticky',
    top: '0px',
    zIndex: theme.zIndex.sticky,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: `${theme.space.xxl} ${theme.space.xxxxl}`,
    backgroundColor: theme.color.bg.page,
    color: theme.color.gray[900],
    overflow: 'hidden',
    [theme.breakpoint.mobile]: {
      display: 'none',
    },
  },
  noise: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: theme.zIndex.behind,
    opacity: 0.2,
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
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space.md,
    color: theme.color.gray[900],
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
      color: applyTransparency(theme.color.gray[900], 0.467), // matches old '#11111177'
    },
    '&$active': {
      color: theme.color.gray[900],
      borderBottomColor: theme.color.gray[900],
    },
  },
  active: {},
}));
