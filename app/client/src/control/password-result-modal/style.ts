import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    ...theme.recipe.modal.dialog,
  },
  dialog: {
    display: 'flex',
    flexDirection: 'column',
    maxWidth: '500px',
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
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
    marginTop: theme.space.md,
  },
  password: {
    fontFamily: 'monospace',
    fontSize: '1.1em',
    flex: 1,
  },
  footer: {
    ...theme.recipe.modal.footer,
  },
}));
