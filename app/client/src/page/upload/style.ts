import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  queue: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  scanRow: {
    display: 'flex',
  },
  spacer: {
    flexGrow: 1,
  },
}));
