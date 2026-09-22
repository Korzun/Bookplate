import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  hint: {
    margin: 0,
    marginBottom: theme.space.md,
    color: theme.color.text.description,
    fontSize: theme.fontSize.sm,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
}));
