import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    ...theme.recipe.modal.dialog,
  },
  dialog: {
    display: 'flex',
    flexDirection: 'column',
    width: `min(480px, calc(100vw - ${theme.space.xxl} * 2))`,
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
    ...theme.recipe.input,
    width: '100%',
    boxSizing: 'border-box',
    fontSize: theme.fontSize.md,
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
    '&:hover': {
      backgroundColor: theme.color.brand.light,
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
  bookItemSelected: {
    backgroundColor: theme.color.brand.light,
    color: theme.color.brand.default,
  },
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
