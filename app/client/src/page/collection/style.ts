import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  loading: {
    color: theme.color.text.muted,
    padding: theme.space.xxxxxl,
    textAlign: 'center',
  },
  notFound: {
    color: theme.color.text.muted,
    padding: theme.space.xxxxxl,
    textAlign: 'center',
  },
  title: {
    margin: `0 0 ${theme.space.xs}`,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.color.text.primary,
  },
  count: {
    color: theme.color.text.secondary,
  },
  bookList: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
}));
