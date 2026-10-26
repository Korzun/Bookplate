import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.xxl,
  },
  cover: {
    flexShrink: 0,
    borderRadius: theme.radius.sm,
  },
  coverImg: {
    width: 44,
    height: 66,
    objectFit: 'cover',
    borderRadius: theme.radius.md,
    display: 'block',
  },
  coverPlaceholder: {
    width: 44,
    height: 66,
    background: theme.color.bg.placeholder,
    borderRadius: 2, // placeholder-specific tiny radius
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontWeight: theme.fontWeight.medium,
    marginBottom: theme.space.xxs,
    color: theme.color.text.primary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  meta: {
    fontSize: theme.fontSize.sm,
    color: theme.color.text.muted,
    marginBottom: '.1rem', // single-component tight margin
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  navigate: {
    cursor: 'pointer',
    '&:hover': {
      '& $title': {
        color: theme.color.brand.hover,
      },
      '& $meta': {
        color: theme.color.brand.linkHover,
      },
    },
  },
}));
