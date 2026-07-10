import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    ...theme.recipe.modal.dialog,
  },
  dialog: {
    display: 'flex',
    flexDirection: 'column',
    maxWidth: '540px',
    // Bound the dialog to the viewport (the shared modal recipe positions it 100px from
    // the top and 50px from the bottom) so a long message list scrolls inside the body
    // instead of being clipped by the recipe's `overflow: hidden`.
    maxHeight: 'calc(100dvh - 150px)',
    backgroundColor: theme.color.bg.card,
  },
  header: {
    ...theme.recipe.modal.header,
    flexShrink: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  body: {
    // Scroll container: absorbs the dialog's free height and scrolls its overflow so the
    // header and footer stay pinned. minHeight: 0 lets this flex child shrink below the
    // intrinsic height of the message list.
    flex: '1 1 auto',
    minHeight: 0,
    overflowY: 'auto',
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
    flexShrink: 0,
  },
}));
