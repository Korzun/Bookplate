import { createUseStyles, Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    overflow: 'hidden',
    borderRadius: theme.radius.md,
    '&$horizontal': {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'start',
      gap: theme.space.md,
      backgroundColor: theme.color.bg.cardHeader,
      '& $label': {
        marginTop: theme.space.md,
        marginLeft: theme.space.sm,
        minWidth: '6rem',
        textAlign: 'left',
      },
    },
    '&$vertical': {
      display: 'flex',
      flexDirection: 'column',
      gap: theme.space.xs,
      backgroundColor: theme.color.bg.cardHeader,
      '& $label': {
        marginTop: theme.space.xs,
        marginLeft: theme.space.md,
      },
    },
    '&$inline': {
      display: 'inline-flex',
      alignItems: 'baseline',
      gap: theme.space.md,
    },
  },
  label: {
    ...theme.recipe.label,
  },
  inputContainer: {
    display: 'flex',
    flexDirection: 'row',
    flexGrow: 1,
    alignItems: 'center',
    gap: theme.space.sm,
  },
  input: {
    ...theme.recipe.input,
    // Shared single-line control height so inputs/select/chips line up on one row.
    height: theme.layout.controlHeight,
    minWidth: 0,
    zIndex: theme.zIndex.base,
    // The native date/time inputs otherwise inherit the platform's own text
    // colour, which ignores dark mode and the design tokens.
    color: theme.color.text.primary,
    '&:disabled': {
      color: theme.color.text.faint,
      cursor: 'not-allowed',
    },
  },
  date: {
    flexGrow: 1,
  },
  // The time box is the exception, not the rule: most books carry a bare date,
  // so it stays small and sits beside the date rather than sharing its width.
  time: {
    flexShrink: 0,
    width: '7rem',
  },
  horizontal: {},
  vertical: {},
  inline: {},
}));
