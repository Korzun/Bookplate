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
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.lg,
    paddingLeft: theme.space.xxl,
    paddingRight: theme.space.xxl,
    paddingBottom: theme.space.xxxxl,
    color: theme.color.text.secondary,
  },
  reason: {
    margin: 0,
    fontSize: theme.fontSize.sm,
    color: theme.color.text.faint,
  },
  footer: {
    ...theme.recipe.modal.footer,
  },
}));
