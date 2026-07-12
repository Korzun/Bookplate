import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  loading: {
    color: theme.color.text.muted,
    padding: theme.space.xxxxxl,
    textAlign: 'center',
  },
  notFound: {
    color: theme.color.text.muted,
    padding: theme.space.xxxxxl,
    textAlign: 'center',
  },
  detail: {
    display: 'flex',
    gap: theme.space.xxxl,
    alignItems: 'flex-start',
    position: 'relative',
  },
  cardContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xxl,
    '& > div': {
      borderTopStyle: 'solid',
      borderTopWidth: '1px',
      borderTopColor: theme.color.border.section,
      paddingTop: theme.space.xl,
    },
    '& > div:first-child': {
      borderTopStyle: 'none',
      paddingTop: 0,
    },
  },
  // Mobile-only spacer so the fixed floating back/actions buttons (46px tall at
  // top: safe-area + space.lg) don't overlap the first card, with breathing room
  // below them. Height is tunable on-device during verification.
  topInset: {
    display: 'none',
    [theme.breakpoint.mobile]: {
      display: 'block',
      height: theme.space.xxxxxl,
    },
  },
  coverPlaceholder: {
    width: 80,
    height: 120,
    background: theme.color.border.default,
    borderRadius: theme.radius.md,
    flexShrink: 0,
  },
  coverImg: {
    width: 80,
    height: 120,
    flexShrink: 0,
    borderRadius: theme.radius.md,
    display: 'block',
    objectFit: 'cover',
  },
  metadata: {
    display: 'flex',
    gap: theme.space.xxl,
  },
  info: {
    flex: 1,
    minWidth: 0,
    height: '100%',
  },
  titleContainer: {
    margin: `0 0 ${theme.space.xs}`,
  },
  title: {
    display: 'inline-block',
    marginRight: '0.5rem',
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.color.text.primary,
  },
  author: {
    display: 'inline-block',
    color: theme.color.text.secondary,
    marginBottom: theme.space.sm,
    cursor: 'pointer',
    '&:hover': { color: theme.color.brand.default },
  },
  series: {
    display: 'inline-block',
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.bold,
    marginBottom: theme.space.sm,
    color: theme.color.text.secondary,
    cursor: 'pointer',
    breakBefore: 'always',
    breakAfter: 'always',
    breakInside: 'avoid',
    '&:hover': { color: theme.color.brand.default },
  },
  description: {
    color: theme.color.text.description,
    lineHeight: theme.lineHeight.body,
    whiteSpace: 'pre-wrap',
    '& > p': {
      marginBottom: '0.5em',
    },
    '& > p:last-child': {
      marginBottom: 0,
    },
  },
  subjects: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.space.md,
  },
  deleteBook: {
    color: theme.color.danger.default,
    fontWeight: theme.fontWeight.extrabold,
  },
  deleteUndone: {
    fontWeight: theme.fontWeight.extrabold,
  },
}));
