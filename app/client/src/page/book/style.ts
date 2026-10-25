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
  // Cover in the first column, title block and rating stacked in the second.
  // At phone width the second column is too narrow for a row of rating circles
  // (it overflowed and the Card's `overflow: hidden` clipped the Awesome
  // circle), so the rating drops below the cover and spans the whole card.
  // A grid rather than a wrapping flex row: on wide layouts the rating must sit
  // directly under the author, not below the cover's 120px.
  detail: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    // The last row absorbs any height the cover adds, so the rating never
    // drifts away from the author line.
    gridTemplateRows: 'auto 1fr',
    columnGap: theme.space.xxxl,
    alignItems: 'start',
    position: 'relative',
  },
  cover: {
    gridColumn: 1,
    gridRow: '1 / span 2',
    [theme.breakpoint.mobile]: {
      gridRow: 1,
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
    gridColumn: 2,
    gridRow: 1,
    minWidth: 0,
  },
  rating: {
    gridColumn: 2,
    gridRow: 2,
    minWidth: 0,
    marginTop: theme.space.md,
    [theme.breakpoint.mobile]: {
      gridColumn: '1 / -1',
      marginTop: theme.space.xl,
    },
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
