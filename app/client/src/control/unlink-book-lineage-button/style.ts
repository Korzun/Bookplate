import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  document: {
    color: theme.color.danger.default,
    fontWeight: theme.fontWeight.extrabold,
    wordBreak: 'break-all',
  },
  book: {
    fontWeight: theme.fontWeight.extrabold,
    display: 'inline-block',
  },
}));
