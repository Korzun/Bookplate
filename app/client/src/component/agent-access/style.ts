import { createUseStyles, type Theme } from '~/provider/theme';

/**
 * Built from the same pieces as the neighbouring settings cards rather than new
 * ones: `stack`/`hint`/`list`/`row`/`name`/`meta` repeat `notification-
 * settings`' device list, and `pill`/`mono` repeat `sync-password`'s
 * credential row.
 */
export const useStyle = createUseStyles((theme: Theme) => ({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  hint: {
    margin: 0,
    color: theme.color.text.description,
    fontSize: theme.fontSize.sm,
  },
  pill: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
  },
  mono: {
    fontFamily: theme.fontFamily.mono,
    flex: 1,
    minWidth: 0,
    overflowWrap: 'anywhere',
    color: theme.color.text.primary,
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
  name: {
    ...theme.recipe.label,
    display: 'block',
  },
  meta: {
    display: 'block',
    marginTop: theme.space.xxxs,
    color: theme.color.text.muted,
    fontSize: theme.fontSize.sm,
  },
}));
