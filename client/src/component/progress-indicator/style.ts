import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.space.xs,
  },
  track: {
    fill: 'transparent',
  },
  sector: {
    fill: theme.color.brand.default,
  },
  ring: {
    fill: 'none',
    stroke: theme.color.text.primary,
    strokeWidth: 6,
  },
  label: {
    fontSize: theme.fontSize.sm,
    color: theme.color.text.primary,
  },
}));
