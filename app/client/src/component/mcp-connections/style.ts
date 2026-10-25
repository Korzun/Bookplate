import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  // `Card`'s content has padding but no gap between its children — the same
  // column every other settings card supplies for itself.
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  // The clients modal: the shared modal recipe, as every other modal uses it.
  modal: {
    ...theme.recipe.modal.dialog,
  },
  dialog: {
    display: 'flex',
    flexDirection: 'column',
    maxHeight: 'calc(100dvh - 150px)',
    backgroundColor: theme.color.bg.card,
  },
  header: {
    ...theme.recipe.modal.header,
    flexShrink: 0,
  },
  body: {
    flex: '1 1 auto',
    minHeight: 0,
    overflowY: 'auto',
    paddingLeft: theme.space.xxl,
    paddingRight: theme.space.xxl,
    paddingBottom: theme.space.xxxxl,
    color: theme.color.text.secondary,
  },
  footer: {
    ...theme.recipe.modal.footer,
    flexShrink: 0,
  },
  hint: {
    margin: 0,
    color: theme.color.text.muted,
    fontSize: theme.fontSize.sm,
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space.md,
  },
  identity: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xxxs,
  },
  nameLine: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.sm,
    minWidth: 0,
  },
  // The same recipe every other row label on this page uses, as the push
  // device list does — not inherited body text.
  name: {
    ...theme.recipe.label,
    display: 'inline',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  meta: {
    color: theme.color.text.muted,
    fontSize: theme.fontSize.sm,
  },
}));
