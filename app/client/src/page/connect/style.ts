import { createUseStyles, type Theme } from '~/provider/theme';

// The same minimal-page shell `page/set-email` and `page/login` use, so the
// consent card sits exactly where the login card did a moment earlier.
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
    minWidth: '400px',
    maxWidth: '480px',
    [theme.breakpoint.mobile]: {
      minWidth: 'auto',
    },
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  title: {
    margin: 0,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.color.text.primary,
  },
  lead: {
    margin: 0,
    color: theme.color.text.muted,
    fontSize: theme.fontSize.sm,
  },
  bullets: {
    margin: 0,
    paddingLeft: theme.space.lg,
    color: theme.color.text.primary,
    fontSize: theme.fontSize.sm,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xs,
  },
  actions: {
    display: 'flex',
    gap: theme.space.md,
    '& > *': { flex: 1 },
  },
}));
