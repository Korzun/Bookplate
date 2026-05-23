import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    padding: `${theme.space.md} ${theme.space.xl}`,
    background: theme.color.brand.light,
    color: theme.color.blue[600],
    borderRadius: theme.radius.md,
    fontSize: theme.fontSize.sm,
  },
}));
