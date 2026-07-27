import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  // The uploaded epub's filename, hoisted to the top of the modal body.
  fileName: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.color.text.primary,
    wordBreak: 'break-word',
    marginBottom: theme.space.md,
  },
  // "Book is valid" — matches the fix-review row font (sm, primary text) with a green check.
  validLine: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.sm,
    fontSize: theme.fontSize.sm,
    color: theme.color.text.primary,
    marginTop: theme.space.sm,
    marginBottom: theme.space.sm,
  },
  invalidLine: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.color.danger.default,
    marginTop: theme.space.sm,
    marginBottom: theme.space.sm,
  },
  checkIcon: {
    color: theme.color.success,
    flexShrink: 0,
  },
  muted: {
    fontSize: theme.fontSize.sm,
    color: theme.color.text.faint,
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.color.danger.default,
  },
}));
