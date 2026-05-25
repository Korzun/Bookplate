import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    marginBottom: theme.space.xxl,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: theme.space.sm,
  },
}));
