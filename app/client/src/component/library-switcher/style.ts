import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    fontSize: '0.80rem',
    padding: `${theme.space.xs} ${theme.space.md}`,
    borderRadius: theme.radius.sm,
    border: `1px solid ${theme.color.border.default}`,
    backgroundColor: theme.color.bg.input,
    color: theme.color.text.primary,
    cursor: 'pointer',
    outline: 'none',
    '&:focus': {
      borderColor: theme.color.brand.default,
    },
  },
}));
