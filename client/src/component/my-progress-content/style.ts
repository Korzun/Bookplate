import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  message: {
    fontSize: theme.fontSize.md,
  },
  error: {
    color: theme.color.danger.default,
  },
}));
