import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    ...theme.recipe.modal.dialog,
  },
  dialog: {
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: theme.color.bg.card,
  },
  header: {
    ...theme.recipe.modal.header,
  },
  intro: {
    margin: 0,
    padding: `0 ${theme.space.xxl} ${theme.space.xl}`,
    lineHeight: 1.5,
    color: theme.color.text.secondary,
  },
  body: {
    overflowY: 'auto',
    maxHeight: '60vh',
  },
  error: {
    margin: 0,
    padding: `0 ${theme.space.xxl} ${theme.space.xxl}`,
    lineHeight: 1.5,
    color: theme.color.danger.default,
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: `0 ${theme.space.xxl} ${theme.space.xxl}`,
  },
  footer: {
    ...theme.recipe.modal.footer,
  },
}));
