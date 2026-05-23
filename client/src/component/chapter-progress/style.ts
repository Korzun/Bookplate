import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.space.xs,
    color: theme.color.text.primary,
  },
  label: {
    fontSize: theme.fontSize.sm,
  },
}));
