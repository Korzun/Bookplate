import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  // The card body's top line: the request's identity on the left, its status on
  // the right. `align-items: flex-start` so a wrapped title does not drag the
  // badge down with it.
  identity: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.space.sm,
  },
  identityText: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xxxs,
    minWidth: 0,
  },
  // The card footer: the dismissive action (decline, or the reader's withdraw)
  // on the left, the resolving actions on the right. `space-between` carries
  // that split even when only one side is present.
  footerBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: theme.space.sm,
    width: '100%',
  },
  footerRight: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.space.sm,
    marginLeft: 'auto',
  },
  // Typography lifted from the Book page's own book card (`page/book/style.ts`'s
  // `title`/`author`) so a request reads like the book it is asking for. The
  // page's `cursor`/`:hover` are deliberately NOT copied: there the author is a
  // clickable filter link, here it is plain text.
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.color.text.primary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  author: {
    color: theme.color.text.secondary,
  },
  note: {
    fontSize: theme.fontSize.md,
    color: theme.color.text.muted,
  },
  resolution: {
    fontSize: theme.fontSize.md,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xxxs,
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.space.sm,
  },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: 0,
  },
  suggestions: {
    fontSize: theme.fontSize.sm,
    color: theme.color.text.muted,
  },
  notClosed: {
    fontSize: theme.fontSize.sm,
    color: theme.color.danger.default,
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.color.danger.default,
  },
  reasonLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xxxs,
    fontSize: theme.fontSize.md,
  },
  reasonInput: {
    ...theme.recipe.input,
    minHeight: '6rem',
    width: '100%',
    boxSizing: 'border-box',
    resize: 'vertical',
  },
}));
