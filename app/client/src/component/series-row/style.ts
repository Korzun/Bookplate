import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.xxl,
  },
  info: { flex: 1, minWidth: 0 },
  name: {
    fontWeight: theme.fontWeight.medium,
    marginBottom: theme.space.xxs,
    color: theme.color.text.primary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  ratingGlyph: {
    verticalAlign: '-2px',
    marginRight: theme.space.xxs,
  },
  meta: {
    fontSize: theme.fontSize.sm,
    color: theme.color.text.muted,
    marginBottom: '.1rem',
  },
}));
