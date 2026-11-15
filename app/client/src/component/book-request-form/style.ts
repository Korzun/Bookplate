import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  message: {
    fontSize: theme.fontSize.md,
  },
  error: {
    color: theme.color.danger.default,
  },
  // Cancel and Save side by side, sharing the width the create form's single
  // Request button takes on its own.
  actions: {
    display: 'flex',
    gap: theme.space.sm,
    '& > *': {
      flex: 1,
    },
  },
}));
