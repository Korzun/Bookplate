import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  book: {
    color: theme.color.danger.default,
    fontWeight: theme.fontWeight.extrabold,
  },
  undone: {
    fontWeight: theme.fontWeight.extrabold,
  },
}));
