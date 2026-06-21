import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: `4rem ${theme.space.xxl}`,
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
  pageError: {
    textAlign: 'center',
    padding: theme.space.md,
    color: theme.color.text.muted,
    fontSize: theme.fontSize.sm,
  },
  retryButton: {
    marginTop: theme.space.sm,
    cursor: 'pointer',
    color: theme.color.text.secondary,
    background: 'none',
    border: 'none',
    fontSize: theme.fontSize.sm,
    padding: 0,
  },
  link: {
    color: theme.color.brand.default,
    textDecoration: 'none',
    '&:hover': { textDecoration: 'underline' },
  },
  spinner: {
    ...theme.recipe.spinner,
    height: '2rem',
    width: '2rem',
    color: theme.color.text.muted,
  },
}));
