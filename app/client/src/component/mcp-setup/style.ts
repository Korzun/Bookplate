import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  lead: {
    margin: 0,
    color: theme.color.text.description,
    fontSize: theme.fontSize.sm,
  },
  status: {
    margin: 0,
    color: theme.color.text.primary,
    fontSize: theme.fontSize.sm,
  },
  statusOn: {
    color: theme.color.success,
    fontWeight: theme.fontWeight.medium,
  },
  statusOff: {
    color: theme.color.text.muted,
    fontWeight: theme.fontWeight.medium,
  },
  steps: {
    margin: 0,
    paddingLeft: theme.space.lg,
    color: theme.color.text.primary,
    fontSize: theme.fontSize.sm,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xs,
  },
  code: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
}));
