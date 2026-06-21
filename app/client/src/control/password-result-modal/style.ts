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
  inset: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.space.xxxl,
    marginLeft: '-1px',
    marginRight: '-1px',
    border: `1px solid ${theme.color.border.default}`,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.bg.input,
    padding: theme.space.md,
  },
  password: {
    fontFamily: theme.fontFamily.mono,
    fontSize: '1.1em',
    wordBreak: 'break-all',
    flexGrow: 1,
    marginLeft: theme.space.sm,
  },
  charNumber: { color: theme.color.brand.default },
  charSymbol: { color: theme.color.danger.default },
  copyButton: {
    flexGrow: 0,
  },
  footer: {
    ...theme.recipe.modal.footer,
  },
}));
