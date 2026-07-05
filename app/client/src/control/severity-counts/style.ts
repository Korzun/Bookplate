import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.space.sm,
    alignItems: 'center',
  },
  chip: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    whiteSpace: 'nowrap',
  },
  blocking: {
    color: theme.color.danger.default,
  },
  muted: {
    color: theme.color.text.muted,
  },
}));
