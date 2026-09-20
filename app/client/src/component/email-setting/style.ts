import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  pill: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
  },
  address: {
    flex: 1,
    color: theme.color.text.primary,
    fontSize: theme.fontSize.md,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  badgeConfirmed: {
    flexShrink: 0,
    color: theme.color.success,
    fontSize: theme.fontSize.sm,
  },
  badgeUnconfirmed: {
    flexShrink: 0,
    color: theme.color.text.faint,
    fontSize: theme.fontSize.sm,
  },
  codeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
    marginTop: theme.space.md,
  },
  editRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
  },
}));
