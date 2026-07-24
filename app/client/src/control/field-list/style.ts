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
    // The stacked mobile rows share the column axis with their own fields, so
    // widen the gap between rows to keep each scheme/value pair legible as a
    // group.
    [theme.breakpoint.mobile]: {
      gap: theme.space.lg,
    },
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.xs,
  },
  fields: {
    display: 'flex',
    flexGrow: 1,
    gap: theme.space.xs,
    minWidth: 0,
    // Stack the columns on narrow screens. Side by side, two inputs plus the
    // remove button overflow the card (which clips the value column and the
    // remove button); stacking keeps every field full-width and reachable.
    [theme.breakpoint.mobile]: {
      flexDirection: 'column',
    },
  },
  field: {
    flexGrow: 1,
    // Let the input shrink below its intrinsic width instead of forcing the
    // row wider than its container.
    minWidth: 0,
  },
}));
