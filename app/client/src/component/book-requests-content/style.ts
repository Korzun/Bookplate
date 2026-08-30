import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.sm,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xxxs,
  },
  message: {
    fontSize: theme.fontSize.md,
  },
  error: {
    color: theme.color.danger.default,
  },
}));
