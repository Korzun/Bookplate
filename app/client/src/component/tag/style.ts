import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    padding: `${theme.space.xs} ${theme.space.md}`,
    background: theme.color.chip.subject.bg,
    color: theme.color.chip.subject.text,
    borderRadius: theme.radius.md,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    border: `1px solid ${theme.color.chip.subject.border}`,
  },
  // Compact variant: minimal vertical padding + tight line height so the chip
  // fits inside a normal text line, keeping fix rows the same height whether or
  // not they contain chips (no row min-height needed).
  sm: {
    padding: `${theme.space.xxxs} ${theme.space.sm}`,
    fontSize: theme.fontSize.xs,
    lineHeight: theme.lineHeight.tight,
  },
  clickable: {
    cursor: 'pointer',
    '&:hover': {
      background: 'rgba(138,94,0,0.15)',
      borderColor: 'rgba(138,94,0,0.40)',
    },
  },
}));
