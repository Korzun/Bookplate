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
    // Optical nudge up: system-ui glyphs sit low in the line box, so shift the
    // text up while keeping the overall row height symmetric.
    padding: `calc(${theme.space.md} - 2px) ${theme.space.lg} calc(${theme.space.md} + 2px)`,
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
    // No horizontal margin: the popover padding already insets the separator to
    // the same edges as the row hover background.
    margin: `${theme.space.xxs} 0`,
    backgroundColor: theme.color.border.strong,
  },
}));
