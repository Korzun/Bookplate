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
      '& $textareaWrapper': { flexGrow: 1 },
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
      '& $textareaWrapper': { flexGrow: 1 },
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
    fontFamily: theme.fontFamily.body,
    fontSize: theme.fontSize.lg,
    outlineWidth: '2px',
    outlineStyle: 'solid',
    outlineColor: 'transparent',
    padding: theme.space.md,
    resize: 'none',
    '&$outlined': {
      ...theme.recipe.input,
    },
    '&$borderless': {
      borderStyle: 'none',
      borderRadius: theme.radius.md,
    },
    '&$autoResize': {
      overflowY: 'hidden',
    },
  },
  textareaWrapper: {
    display: 'flex',
    flexDirection: 'column',
  },
  counter: {
    alignSelf: 'flex-end',
    fontSize: theme.fontSize.xxs,
    color: theme.color.text.faint,
    padding: `${theme.space.xxs} ${theme.space.sm}`,
    lineHeight: theme.lineHeight.tight,
    userSelect: 'none',
  },
  counterDanger: {
    color: theme.color.danger.default,
  },
  danger: {},
  horizontal: {},
  vertical: {},
  inline: {},
  outlined: {},
  borderless: {},
  autoResize: {},
}));
