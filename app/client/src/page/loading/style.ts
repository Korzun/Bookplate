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
  },
  title: {
    margin: `0 0 ${theme.space.xxxxl}`,
    fontSize: theme.fontSize.xl,
    color: theme.color.text.primary,
    fontWeight: theme.fontWeight.semibold,
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
    justifyContent: 'center',
  },
  spinner: {
    ...theme.recipe.spinner,
    height: '2rem',
    width: '2rem',
  },
}));
