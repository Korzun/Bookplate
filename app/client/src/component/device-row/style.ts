import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  rowActions: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
  },
  deviceName: {
    fontWeight: theme.fontWeight.semibold,
  },
  undone: {
    color: theme.color.danger.default,
  },
  error: {
    color: theme.color.danger.default,
    fontSize: theme.fontSize.sm,
    margin: `${theme.space.sm} 0 0`,
  },
}));
