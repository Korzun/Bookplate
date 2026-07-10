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
  hero: {
    display: 'flex',
    gap: theme.space.xxxl,
  },
  title: {
    margin: `0 0 ${theme.space.xs}`,
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
  bookList: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  // Mobile-only spacer so the fixed floating back button doesn't overlap the first
  // card, with breathing room below it. Height is tunable on-device during verification.
  topInset: {
    display: 'none',
    [theme.breakpoint.mobile]: {
      display: 'block',
      height: theme.space.xxxxxl,
    },
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
  metadata: {
    display: 'flex',
    gap: theme.space.xxl,
  },
  subjects: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.space.md,
  },
}));
