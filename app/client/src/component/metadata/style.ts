import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    gap: theme.space.xs,
    fontSize: theme.fontSize.sm,
    color: theme.color.text.primary,
    whiteSpace: 'nowrap',
  },
  title: {
    color: theme.color.text.faint,
    textTransform: 'capitalize',
  },
  value: {
    maxWidth: theme.size.metadataValue,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
}));
