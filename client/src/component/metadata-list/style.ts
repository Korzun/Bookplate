import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.space.xxl,
    rowGap: theme.space.sm,
  },
}));
