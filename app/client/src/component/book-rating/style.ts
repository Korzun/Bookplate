import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.lg,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    columnGap: theme.space.xxl,
    rowGap: theme.space.md,
    [theme.breakpoint.mobile]: {
      gridTemplateColumns: '1fr',
    },
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space.md,
  },
  label: {
    fontSize: theme.fontSize.sm,
    color: theme.color.text.secondary,
  },
}));
