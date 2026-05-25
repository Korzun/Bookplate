import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xl,
  },
  rowContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xs,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.xs,
  },
  field: {
    flexGrow: 1,
  },
}));
