import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    ...theme.recipe.modal.dialog,
  },
  dialog: {
    display: 'flex',
    flexDirection: 'column',
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
  emphasisDanger: {
    color: theme.color.danger.default,
    fontWeight: theme.fontWeight.semibold,
  },
  emphasisStrong: {
    fontWeight: theme.fontWeight.semibold,
  },
  countsRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space.md,
    flexWrap: 'wrap',
    marginBottom: theme.space.lg,
  },
  toggle: {
    flexShrink: 0,
  },
  messageList: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  group: {
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
    // Keep the severity/id/location row spaced with xs, but tighten the vertical
    // gap to the wrapped message text below it.
    columnGap: theme.space.xs,
    rowGap: theme.space.xxs,
    fontSize: theme.fontSize.sm,
  },
  severityBlocking: {
    color: theme.color.danger.default,
    fontWeight: theme.fontWeight.semibold,
  },
  severityMuted: {
    color: theme.color.text.muted,
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
  },
  footer: {
    ...theme.recipe.modal.footer,
    flexShrink: 0,
  },
}));
