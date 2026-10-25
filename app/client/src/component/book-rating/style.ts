import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  // Two columns, label and picker, so every picker starts on the same line
  // whatever the label's width. At phone width the label moves above its
  // picker and the picker takes the whole card.
  root: {
    display: 'grid',
    gridTemplateColumns: 'max-content minmax(0, 1fr)',
    alignItems: 'center',
    columnGap: theme.space.xxl,
    rowGap: theme.space.md,
    [theme.breakpoint.mobile]: {
      gridTemplateColumns: 'minmax(0, 1fr)',
      rowGap: theme.space.sm,
    },
  },
  label: {
    fontSize: theme.fontSize.sm,
    color: theme.color.text.secondary,
    [theme.breakpoint.mobile]: {
      marginTop: theme.space.md,
      '&:first-child': { marginTop: 0 },
    },
  },
  overall: {
    color: theme.color.text.primary,
    fontWeight: theme.fontWeight.semibold,
  },
}));
