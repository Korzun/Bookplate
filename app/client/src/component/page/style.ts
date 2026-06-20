import { createUseStyles, type Theme } from '~/provider/theme';

export type PageTypeValue = 'default' | 'minimal';
export enum PageType {
  default = 'default',
  minimal = 'minimal',
}

export const useStyle = createUseStyles((theme: Theme) => ({
  [PageType.default]: {
    maxWidth: 800,
    margin: `${theme.space.xxxxxl} auto`,
    padding: `0 ${theme.space.xxl}`,
    display: 'flex',
    gap: theme.fontSize.md, // historical: 0.875rem flexbox gap
    flexDirection: 'column',
    [theme.breakpoint.mobile]: {
      margin: 0,
      paddingBottom: 'calc(110px + env(safe-area-inset-bottom))',
    },
  },
  [PageType.minimal]: {},
  noise: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    opacity: 0.2,
    pointerEvents: 'none',
    zIndex: theme.zIndex.behind,
  },
}));
