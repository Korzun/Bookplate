import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  heading: {
    flex: 1,
    margin: 0,
    fontSize: theme.fontSize.xl,
    color: theme.color.text.primary,
  },
}));
