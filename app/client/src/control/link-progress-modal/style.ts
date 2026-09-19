import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    ...theme.recipe.modal.dialog,
  },
  dialog: {
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: theme.color.bg.card,
  },
  header: {
    ...theme.recipe.modal.header,
  },
  body: {
    padding: `${theme.space.md} ${theme.space.xxl}`,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  searchInput: {
    // Share the input recipe (0.8rem text with a 16px mobile floor) and the
    // single-line control height so this filter matches every other input.
    ...theme.recipe.input,
    height: theme.layout.controlHeight,
    width: '100%',
    boxSizing: 'border-box',
  },
  bookList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    maxHeight: '240px',
    overflowY: 'auto',
    border: `1px solid ${theme.color.border.default}`,
    borderRadius: theme.radius.md,
  },
  bookItem: {
    padding: `${theme.space.md} ${theme.space.xl}`,
    cursor: 'pointer',
    borderBottom: `1px solid ${theme.color.border.light}`,
    '&:last-child': {
      borderBottom: 'none',
    },
    // Hover is a neutral scrim, selection is the brand tint. Both used to be
    // `brand.light`, so merely pointing at an unselected row made it look
    // picked — and the Link button's enabled state, which follows the real
    // selection, then disagreed with what the list appeared to say.
    //
    // Shaped like `control/select`'s option rule: `:hover` first, the selected
    // modifier nested after it. `.bookItem:hover` and `.bookItem$selected`
    // have equal specificity, so source order is what makes selection win
    // while the pointer is on the row.
    '&:hover': {
      backgroundColor: theme.color.bg.hover,
    },
    '&$bookItemSelected': {
      backgroundColor: theme.color.brand.light,
      color: theme.color.brand.default,
    },
  },
  bookItemButton: {
    display: 'block',
    width: '100%',
    background: 'none',
    border: 'none',
    padding: 0,
    fontFamily: 'inherit',
    fontSize: 'inherit',
    color: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
  },
  // Declared empty: the paint lives in `bookItem`'s `&$bookItemSelected`
  // nesting above, which is what wins over the hover rule.
  bookItemSelected: {},
  bookTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.medium,
  },
  bookAuthor: {
    fontSize: theme.fontSize.sm,
    color: theme.color.text.muted,
    marginTop: theme.space.xxxs,
  },
  emptyMessage: {
    padding: `${theme.space.xxl} ${theme.space.xl}`,
    textAlign: 'center',
    color: theme.color.text.faint,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.color.danger.default,
    fontSize: theme.fontSize.sm,
    padding: `0 0 ${theme.space.md} 0`,
  },
  footer: {
    ...theme.recipe.modal.footer,
  },
}));
