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
    // Optical centering, tuned by eye: an extra 1px below the text (system-ui
    // glyphs sit low in the line box) and 1px horizontally to balance the
    // hover inset against the vertical padding.
    padding: `${theme.space.md} calc(${theme.space.lg} + 1px) calc(${theme.space.md} + 1px)`,
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
    // Negative horizontal margin cancels the popover padding so the separator
    // runs clear across the menu, edge to edge.
    margin: `${theme.space.xxs} calc(${theme.space.xs} * -1)`,
    backgroundColor: theme.color.border.strong,
  },
}));
