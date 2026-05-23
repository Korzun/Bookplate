import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xxxs,
  },
}));
