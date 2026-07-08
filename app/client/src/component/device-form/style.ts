import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  submit: {
    marginTop: theme.space.xxl,
  },
}));
