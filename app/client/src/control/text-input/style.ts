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
  inputContainer: {
    display: 'flex',
    flexDirection: 'row',
    flexGrow: 1,
    alignItems: 'center',
    position: 'relative',
  },
  input: {
    ...theme.recipe.input,
    flexGrow: 1,
    zIndex: theme.zIndex.base,
    '&$isAction': { paddingRight: theme.space.xxxxxl },
  },
  action: {
    paddingBottom: '2px',
    paddingTop: '6px',
    position: 'absolute',
    right: theme.space.md,
    zIndex: theme.zIndex.base,
  },
  counter: {
    flexShrink: 0,
    fontSize: theme.fontSize.xxs,
    color: theme.color.text.faint,
    padding: `0 ${theme.space.sm}`,
    lineHeight: theme.lineHeight.tight,
    userSelect: 'none',
    zIndex: theme.zIndex.base,
  },
  counterDanger: {
    color: theme.color.danger.default,
  },
  danger: {},
  horizontal: {},
  vertical: {},
  inline: {},
  isAction: {},
}));
