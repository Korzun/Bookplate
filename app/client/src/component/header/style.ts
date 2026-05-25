import { createUseStyles, type Theme } from '~/provider/theme';
import { applyTransparency } from '~/utils';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    backgroundColor: theme.color.bg.page,
    color: theme.color.gray[900],
    padding: `${theme.space.xxl} ${theme.space.xxxxl}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'sticky',
    top: '0px',
    zIndex: theme.zIndex.sticky,
    overflow: 'hidden',
    [theme.breakpoint.mobile]: {
      backgroundColor: 'transparent',
      position: 'static',
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
    [theme.breakpoint.mobile]: {
      display: 'none',
    },
  },
  navigation: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: '15px',
    width: '100vw',
    [theme.breakpoint.mobile]: {
      width: '100vw',
      height: 'auto',
      position: 'fixed',
      top: 'auto',
      bottom: 0,
      left: 0,
    },
  },
  navigationItemContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space.xxl,
    [theme.breakpoint.mobile]: {
      marginBottom: theme.space.xxxl,
      borderRadius: theme.radius.lg,
      padding: `${theme.space.xl} ${theme.space.xxxxxl}`,
      display: 'inline-flex',
      backgroundColor: theme.color.bg.page,
      gap: theme.space.xxl,
    },
  },
  navigationItem: {
    gap: theme.space.md,
    color: theme.color.gray[900],
    textDecoration: 'none',
    justifyContent: 'center',
    alignItems: 'center',
    fontSize: '0.80rem', // header-nav-specific size; not on global fontSize scale
    userSelect: 'none',
    '-webkit-user-select': 'none',
    transitionProperty: 'color, border-bottom-color',
    transitionDuration: '0.1s',
    transitionTimingFunction: 'ease-in',
    borderBottomStyle: 'solid',
    borderBottomWidth: '2px',
    borderBottomColor: 'transparent',
    cursor: 'pointer',
    display: 'inline-flex',
    borderStyle: 'none',
    outlineStyle: 'none',
    paddingBottom: '4px', // optical baseline tweak — geometry
    marginTop: '6px', // optical baseline tweak — geometry
    '&:hover': {
      transitionDuration: '0s',
      color: applyTransparency(theme.color.gray[900], 0.467), // matches old '#11111177'
    },
    '&$active': {
      color: theme.color.gray[900],
      borderBottomColor: theme.color.gray[900],
    },
    [theme.breakpoint.mobile]: {
      width: '40px',
      flexDirection: 'column',
      rowGap: theme.space.xxs,
      '&$active': {
        color: theme.color.brand.default,
        borderBottomColor: 'transparent',
      },
    },
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.xl,
    position: 'relative',
    zIndex: theme.zIndex.header,
  },
  active: {},
}));
