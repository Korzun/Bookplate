import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  validLine: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.xs,
  },
  checkIcon: {
    color: theme.color.success,
    flexShrink: 0,
  },
}));
