import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  // `Card`'s content has padding but no gap between its children — the same
  // column every other settings card supplies for itself.
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  lead: {
    margin: 0,
    color: theme.color.text.description,
    fontSize: theme.fontSize.sm,
  },
  hint: {
    margin: 0,
    color: theme.color.text.muted,
    fontSize: theme.fontSize.sm,
  },
  code: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.sm,
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
