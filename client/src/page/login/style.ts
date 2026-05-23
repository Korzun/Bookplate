import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: theme.color.bg.page,
    padding: `0 ${theme.space.xxl}`,
    [theme.breakpoint.mobile]: {
      padding: `0 ${theme.space.xxl}`,
    },
  },
  card: {
    [theme.breakpoint.mobile]: {
      width: '100%',
    },
  },
  inputContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
    marginBottom: theme.space.xxl,
    minWidth: '400px',
    [theme.breakpoint.mobile]: {
      minWidth: 'auto',
    },
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
}));
