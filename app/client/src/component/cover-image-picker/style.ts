import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.xs,
  },
  thumbSlot: {
    width: '32px',
    height: '32px',
    flexShrink: 0,
    borderRadius: theme.radius.sm,
    overflow: 'hidden',
    border: `1px solid ${theme.color.border.default}`,
    background: theme.color.border.light,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  placeholderIcon: {
    color: theme.color.text.faint,
    lineHeight: 0,
    '& svg': {
      width: '15px',
      height: '15px',
    },
  },
  filename: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.color.text.primary,
    flexGrow: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  noFile: {
    fontSize: theme.fontSize.sm,
    color: theme.color.text.faint,
    flexGrow: 1,
  },
  size: {
    fontSize: theme.fontSize.xs,
    color: theme.color.text.faint,
    whiteSpace: 'nowrap',
  },
  actions: {
    display: 'flex',
    gap: theme.space.sm,
    marginTop: theme.space.xs,
  },
}));
