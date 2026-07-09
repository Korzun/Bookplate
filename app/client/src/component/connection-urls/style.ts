import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  rows: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  label: {
    flexShrink: 0,
    color: theme.color.text.secondary,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  pill: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
  },
  url: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    // Truncate the START of the URL (leading ellipsis) so the meaningful tail —
    // e.g. …/opds/device/kindle — stays visible. text-overflow trims the inline-end
    // edge, so flipping to rtl moves the ellipsis to the left; text-align:left keeps
    // short URLs anchored left instead of drifting to the right edge.
    direction: 'rtl',
    textAlign: 'left',
    fontFamily: theme.fontFamily.mono,
    color: theme.color.text.primary,
    fontSize: theme.fontSize.md,
    letterSpacing: '0.03em',
  },
}));
