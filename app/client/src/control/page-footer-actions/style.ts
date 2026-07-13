import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    gap: theme.space.md,
    alignItems: 'center',
  },
  spacer: {
    flexGrow: 1,
  },
}));
