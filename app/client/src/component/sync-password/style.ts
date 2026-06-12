import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
    // border: `1px solid ${theme.color.border.default}`,
    borderRadius: theme.radius.md,
    padding: theme.space.lg,
    backgroundColor: theme.color.gray[100],
  },
  password: {
    fontFamily: 'monospace',
    flex: 1,
    color: theme.color.text.primary,
  },
}));
