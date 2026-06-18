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
  clickable: {
    cursor: 'pointer',
    '&:hover': {
      background: 'rgba(138,94,0,0.15)',
      borderColor: 'rgba(138,94,0,0.40)',
    },
  },
}));
