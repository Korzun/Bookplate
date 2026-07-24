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
      '& $input': { flexGrow: 1 },
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
      '& $input': { flexGrow: 1 },
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
  input: {
    ...theme.recipe.input,
    // Shared single-line control height so inputs/select/chips line up on one row.
    height: theme.layout.controlHeight,
  },
  danger: {},
  horizontal: {},
  vertical: {},
  inline: {},
}));
