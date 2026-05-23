import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  heading: {
    flex: 1,
    margin: 0,
    fontSize: theme.fontSize.xl,
    color: theme.color.text.primary,
  },
  cardContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  buttonContainer: {
    display: 'flex',
    gap: theme.space.md,
  },
  spacer: {
    flexGrow: 1,
  },
}));
