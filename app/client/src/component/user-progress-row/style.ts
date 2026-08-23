import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  loading: {
    fontSize: theme.fontSize.md,
    color: theme.color.text.muted,
  },
  error: {
    fontSize: theme.fontSize.md,
    color: theme.color.danger.default,
  },
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
  },
  progress: {
    display: 'flex',
    alignItems: 'center',
  },
  book: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.sm,
    flexGrow: 1,
    minWidth: 0,
    fontSize: theme.fontSize.md,
  },
  bookUnresolved: {
    color: theme.color.text.muted,
  },
  orphanIcon: {
    flexShrink: 0,
    color: theme.color.danger.default,
  },
  title: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  metadata: {
    fontSize: theme.fontSize.md,
  },
}));
