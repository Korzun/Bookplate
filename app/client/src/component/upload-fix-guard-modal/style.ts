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
  body: {
    paddingLeft: theme.space.xxl,
    paddingRight: theme.space.xxl,
    paddingBottom: theme.space.xxxxl,
    color: theme.color.text.secondary,
  },
  footer: {
    ...theme.recipe.modal.footer,
  },
}));
