import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  inputContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  submit: {
    marginTop: theme.space.xxl,
  },
}));
