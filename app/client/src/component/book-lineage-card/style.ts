import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.color.danger.default,
    padding: `${theme.space.md} ${theme.space.xl}`,
  },
  loading: {
    fontSize: theme.fontSize.sm,
    color: theme.color.text.faint,
    padding: `${theme.space.md} ${theme.space.xl}`,
  },
}));
