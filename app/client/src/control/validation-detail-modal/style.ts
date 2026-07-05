import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    ...theme.recipe.modal.dialog,
  },
  dialog: {
    display: 'flex',
    flexDirection: 'column',
    maxWidth: '540px',
    backgroundColor: theme.color.bg.card,
  },
  header: {
    ...theme.recipe.modal.header,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  body: {
    paddingLeft: theme.space.xxl,
    paddingRight: theme.space.xxl,
    paddingBottom: theme.space.xxxxl,
    color: theme.color.text.secondary,
  },
  intro: {
    marginTop: 0,
  },
  counts: {
    marginBottom: theme.space.lg,
  },
  messageList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  message: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: theme.space.xs,
    fontSize: theme.fontSize.sm,
  },
  severity: {
    color: theme.color.danger.default,
    fontWeight: theme.fontWeight.semibold,
  },
  id: {
    fontFamily: theme.fontFamily.mono,
    color: theme.color.text.muted,
  },
  text: {
    color: theme.color.text.primary,
    flexBasis: '100%',
  },
  location: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
    color: theme.color.text.faint,
    flexBasis: '100%',
  },
  footer: {
    ...theme.recipe.modal.footer,
  },
}));
