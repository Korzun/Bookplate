import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  pill: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
    borderRadius: theme.radius.md,
    padding: `${theme.space.xl} ${theme.space.xxl}`,
    backgroundColor: theme.color.bg.input,
  },
  pillIcon: {
    flexShrink: 0,
    color: theme.color.text.faint,
  },
  password: {
    fontFamily: theme.fontFamily.mono,
    flex: 1,
    color: theme.color.text.primary,
    fontSize: theme.fontSize.md,
    letterSpacing: '0.03em',
  },
}));
