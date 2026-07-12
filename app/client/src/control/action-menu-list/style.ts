import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  popover: {
    minWidth: 190,
    padding: theme.space.xs,
    borderRadius: theme.radius.md,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xxs,
  },
  glass: {
    ...theme.recipe.glass,
  },
  solid: {
    backgroundColor: theme.color.bg.card,
    borderStyle: 'solid',
    borderWidth: '1px',
    borderColor: theme.color.border.strong,
    boxShadow: theme.shadow.cardStack,
  },
  item: {
    appearance: 'none',
    '-webkit-appearance': 'none',
    background: 'none',
    border: 'none',
    textAlign: 'left',
    width: '100%',
    padding: `${theme.space.md} ${theme.space.lg}`,
    borderRadius: theme.radius.sm,
    fontSize: theme.fontSize.md,
    fontFamily: theme.fontFamily.body,
    color: theme.color.text.primary,
    cursor: 'pointer',
    '&:hover': { backgroundColor: theme.color.bg.hover },
    '&:disabled': { opacity: 0.5, cursor: 'default' },
  },
  itemDanger: {
    color: theme.color.danger.default,
  },
  separator: {
    height: '1px',
    margin: `${theme.space.xxs} ${theme.space.sm}`,
    backgroundColor: theme.color.border.strong,
  },
}));
