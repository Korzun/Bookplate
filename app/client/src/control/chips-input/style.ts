import { createUseStyles, Theme } from '~/provider/theme';

type StyleProps = { chipColor: keyof Theme['color']['chip']; dense: boolean };

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
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
      '& $controlRoot': { flexGrow: 1 },
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
      '& $controlRoot': { flexGrow: 1 },
    },
  },
  label: { ...theme.recipe.label },
  controlRoot: {
    position: 'relative',
  },
  chipsContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.space.xs,
    // Dense trims the vertical padding (chips stay full-size) so the row height
    // matches a standard input; the roomier default keeps the Subjects card look.
    padding: ({ dense }: StyleProps) =>
      dense ? `${theme.space.xs} ${theme.space.md}` : theme.space.md,
    // Dense matches a standard input's text size so the field lines up in height.
    fontSize: ({ dense }: StyleProps) => (dense ? '0.80rem' : theme.fontSize.sm),
    backgroundColor: theme.color.bg.input,
    border: `1px solid ${theme.color.border.default}`,
    borderRadius: theme.radius.md,
    cursor: 'text',
    // Dense floors the row at a standard input's height (tuned to recipe.input);
    // the default keeps the roomier 2.25rem for the Subjects card.
    minHeight: ({ dense }: StyleProps) => (dense ? '2.0625rem' : '2.25rem'),
    '&:focus-within': {
      borderColor: theme.color.border.focus,
    },
    '&$disabled': {
      cursor: 'default',
      color: theme.color.text.muted,
      '&:focus-within': {
        borderColor: theme.color.border.default,
      },
    },
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.space.xxs,
    padding: `${theme.space.xs} ${theme.space.md}`,
    borderRadius: theme.radius.sm,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    lineHeight: theme.lineHeight.tight,
    borderStyle: 'solid',
    borderWidth: '1px',
    background: ({ chipColor }: { chipColor: keyof Theme['color']['chip'] }) =>
      theme.color.chip[chipColor].bg,
    color: ({ chipColor }: { chipColor: keyof Theme['color']['chip'] }) =>
      theme.color.chip[chipColor].text,
    borderColor: ({ chipColor }: { chipColor: keyof Theme['color']['chip'] }) =>
      theme.color.chip[chipColor].border,
    // Dense pulls the first chip toward the field's left border so chips hug the
    // edge (tag-input style) while the empty input keeps its standard padding.
    '&:first-child': {
      marginLeft: ({ dense }: StyleProps) => (dense ? `-${theme.space.xs}` : 0),
    },
  },
  chipRemove: {
    display: 'flex',
    alignItems: 'center',
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    color: 'inherit',
    opacity: 0.5,
    lineHeight: 1,
    '&:hover': {
      opacity: 1,
      color: theme.color.danger.default,
    },
    '& > svg': {
      height: theme.fontSize.sm,
      width: theme.fontSize.sm,
    },
  },
  input: {
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    color: theme.color.text.primary,
    flexGrow: 1,
    minWidth: '8rem',
    // Keep font-size at the 16px floor on mobile so focusing it doesn't zoom iOS.
    [theme.breakpoint.mobile]: { fontSize: '1rem' },
    '&:disabled': {
      color: theme.color.text.muted,
      cursor: 'default',
    },
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: theme.space.xxs,
    padding: 0,
    listStyle: 'none',
    backgroundColor: theme.color.bg.input,
    border: `1px solid ${theme.color.border.default}`,
    borderRadius: theme.radius.md,
    boxShadow: theme.shadow.hoverLift,
    zIndex: theme.zIndex.sticky,
    maxHeight: '12rem',
    overflowY: 'auto',
  },
  dropdownItem: {
    padding: `${theme.space.md} ${theme.space.xl}`,
    cursor: 'pointer',
    fontSize: theme.fontSize.md,
    color: theme.color.text.primary,
    '&:hover': {
      backgroundColor: theme.color.bg.cardHeader,
    },
    '&$highlighted': {
      backgroundColor: theme.color.brand.light,
    },
  },
  highlighted: {},
  disabled: {},
  horizontal: {},
  vertical: {},
}));
