import { createUseStyles, type Theme } from '~/provider/theme';

// Measured minimum width of one sub-rating row: the longest label
// ("Characters", ~4rem at fontSize.sm) + the row gap (space.md, 0.5rem) + five
// 32px circles with four space.sm (0.375rem) gaps (~11.5rem at a 16px root).
export const SUB_RATING_ROW_MIN = '16rem';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.lg,
  },
  grid: {
    display: 'grid',
    // As many columns as fit, never a row narrower than its content: two on a
    // wide page, one at phone width and in the 641-680px band where a fixed
    // two-column grid overflowed. The min()
    // guard keeps a lone column from forcing overflow in a narrower container.
    gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${SUB_RATING_ROW_MIN}), 1fr))`,
    columnGap: theme.space.xxl,
    rowGap: theme.space.md,
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
