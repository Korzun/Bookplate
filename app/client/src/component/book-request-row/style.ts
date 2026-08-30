import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xxxs,
    padding: `${theme.space.sm}px 0`,
    borderBottom: `1px solid ${theme.color.border.default}`,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.sm,
  },
  title: {
    fontSize: theme.fontSize.md,
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  author: {
    fontSize: theme.fontSize.md,
    color: theme.color.text.muted,
  },
  note: {
    fontSize: theme.fontSize.md,
    color: theme.color.text.muted,
  },
  resolution: {
    fontSize: theme.fontSize.md,
  },
}));
