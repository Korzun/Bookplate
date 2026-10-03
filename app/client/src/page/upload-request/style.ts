import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  queue: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: `4rem ${theme.space.xxl}`, // 4rem is empty-state vertical padding
    gap: theme.space.md,
  },
  emptyStateTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.color.text.muted,
  },
  emptyStateSubtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.color.text.faint,
  },
  link: {
    color: theme.color.brand.default,
    textDecoration: 'none',
    '&:hover': { textDecoration: 'underline' },
  },
}));
