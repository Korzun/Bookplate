import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  rows: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  pill: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
  },
  url: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: theme.fontFamily.mono,
    color: theme.color.text.primary,
    fontSize: theme.fontSize.md,
    letterSpacing: '0.03em',
  },
}));
