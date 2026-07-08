import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  loading: {
    color: theme.color.text.muted,
    textAlign: 'center',
    padding: theme.space.xxxxxl,
  },
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
}));
