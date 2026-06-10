import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  banner: {
    padding: theme.space.md,
    marginBottom: theme.space.md,
    borderRadius: theme.radius.md,
    borderStyle: 'solid',
    borderWidth: '1px',
    borderColor: theme.color.border.danger,
    backgroundColor: theme.color.danger.light,
    color: theme.color.danger.default,
    fontWeight: theme.fontWeight.semibold,
  },
}));
