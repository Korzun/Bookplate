import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xxxs,
    padding: `${theme.space.sm}px 0`,
    borderBottom: `1px solid ${theme.color.border.default}`,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.sm,
  },
  title: {
    fontSize: theme.fontSize.md,
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  author: {
    fontSize: theme.fontSize.md,
    color: theme.color.text.muted,
  },
  note: {
    fontSize: theme.fontSize.md,
    color: theme.color.text.muted,
  },
  resolution: {
    fontSize: theme.fontSize.md,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xxxs,
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.space.sm,
  },
  uploadLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    backgroundColor: theme.color.bg.input,
    border: `1px solid ${theme.color.border.default}`,
    borderRadius: theme.radius.lg,
    padding: `${theme.space.md} ${theme.space.xxl}`,
    fontSize: '0.80rem',
    color: theme.color.text.primary,
    cursor: 'pointer',
    '&:hover': {
      borderColor: theme.color.brand.hover,
      color: theme.color.brand.hover,
    },
  },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: 0,
  },
  suggestions: {
    fontSize: theme.fontSize.sm,
    color: theme.color.text.muted,
  },
  notClosed: {
    fontSize: theme.fontSize.sm,
    color: theme.color.danger.default,
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.color.danger.default,
  },
  reasonLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xxxs,
    fontSize: theme.fontSize.md,
  },
  reasonInput: {
    ...theme.recipe.input,
    minHeight: '6rem',
    width: '100%',
    boxSizing: 'border-box',
    resize: 'vertical',
  },
}));
