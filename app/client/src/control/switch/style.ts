import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'inline-flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: theme.space.xs,
    cursor: 'pointer',
    userSelect: 'none',
    '-webkit-user-select': 'none',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
  },
  description: {
    // Indent under the label (past the 28px track + row gap) so it reads as
    // helper text for this toggle rather than a separate row.
    marginLeft: `calc(28px + ${theme.space.md})`,
    fontSize: theme.fontSize.sm,
    color: theme.color.text.faint,
    cursor: 'auto',
  },
  track: {
    position: 'relative',
    width: '28px',
    height: '16px',
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.border.default,
    ...theme.recipe.focusRing,
    transitionProperty: 'background-color, outline-color',
    transitionDuration: '0.1s',
    transitionTimingFunction: 'ease-in',
    '$root:hover &': { outlineColor: theme.color.brand.outline },
    '$root:focus &': { outlineColor: theme.color.brand.outline },
    '&$checked': { backgroundColor: theme.color.brand.default },
    '&$disabled': { opacity: 0.4, cursor: 'not-allowed' },
  },
  thumb: {
    position: 'absolute',
    top: '2px',
    left: '2px',
    width: '12px',
    height: '12px',
    borderRadius: theme.radius.circle,
    backgroundColor: theme.color.bg.input,
    transitionProperty: 'left',
    transitionDuration: '0.1s',
    transitionTimingFunction: 'ease-in',
    '$checked &': { left: '14px' },
  },
  label: {
    ...theme.recipe.label,
  },
  horizontal: {
    display: 'flex',
    width: '100%',
    backgroundColor: theme.color.bg.cardHeader,
    borderRadius: theme.radius.md,
    '& $row': {
      width: '100%',
      // No left padding so the label lines up with the other fields' label column.
      paddingTop: theme.space.md,
      paddingBottom: theme.space.md,
      paddingRight: theme.space.lg,
      gap: theme.space.md,
    },
    '& $label': {
      // Matches the other controls' label column (right-aligned, 6rem wide).
      minWidth: '6rem',
      textAlign: 'right',
      marginLeft: theme.space.sm,
      flexShrink: 0,
    },
    '& $track': {
      // Toggle pinned to the far right of the row.
      marginLeft: 'auto',
    },
    '& $description': {
      margin: 0,
      paddingBottom: theme.space.md,
      paddingRight: theme.space.lg,
      // Align the helper text under the content column (past the label + gap).
      marginLeft: `calc(${theme.space.sm} + 6rem + ${theme.space.md})`,
    },
  },
  checked: {},
  disabled: {},
  danger: {},
}));
