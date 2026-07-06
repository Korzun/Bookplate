import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.space.lg,
    margin: `0 0 ${theme.space.xxxxl}`,
  },
  logo: {
    color: theme.color.text.primary,
    height: 'auto',
    maxWidth: '60vw',
  },
  title: {
    margin: 0,
    fontSize: theme.fontSize.xl,
    color: theme.color.text.primary,
    fontWeight: theme.fontWeight.semibold,
    textAlign: 'center',
  },
}));
