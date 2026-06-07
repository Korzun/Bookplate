import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.1rem', // single-component tight gap
  },
  username: {
    color: theme.color.danger.default,
    fontWeight: theme.fontWeight.extrabold,
  },
  undone: {
    fontWeight: theme.fontWeight.extrabold,
  },
}));
