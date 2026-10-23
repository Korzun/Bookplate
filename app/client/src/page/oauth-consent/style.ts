import { createUseStyles, type Theme } from '~/provider/theme';

/** The `set-email` page's frame — the same minimal, centred, login-width card. */
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
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xxl,
    [theme.breakpoint.mobile]: {
      width: '100%',
    },
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
    minWidth: '400px',
    maxWidth: '480px',
    [theme.breakpoint.mobile]: {
      minWidth: 'auto',
    },
  },
  title: {
    margin: 0,
    textAlign: 'center',
    color: theme.color.text.primary,
    fontSize: theme.fontSize.md,
  },
  text: {
    margin: 0,
    color: theme.color.text.description,
    fontSize: theme.fontSize.sm,
  },
  list: {
    margin: 0,
    paddingLeft: theme.space.xl,
    color: theme.color.text.description,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.sm,
  },
}));
