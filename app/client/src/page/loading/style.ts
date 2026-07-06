import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    minHeight: '100vh',
    backgroundColor: theme.color.bg.page,
    padding: `0 ${theme.space.xxl}`,
    [theme.breakpoint.mobile]: {
      padding: `0 ${theme.space.xxl}`,
    },
  },
  spinner: {
    ...theme.recipe.spinner,
    height: '2rem',
    width: '2rem',
  },
}));
