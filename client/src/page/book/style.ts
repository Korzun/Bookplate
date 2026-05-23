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
      borderTopColor: '#E6E6E9', // book-page-specific section divider shade
      paddingTop: theme.space.xl,
    },
    '& > div:first-child': {
      borderTopStyle: 'none',
      paddingTop: 0,
    },
  },
  buttonContainer: {
    display: 'flex',
    gap: theme.space.md,
  },
  spacer: {
    flexGrow: 1,
  },
  coverPlaceholder: {
    width: 80,
    height: 118,
    background: theme.color.border.default,
    borderRadius: theme.radius.md,
    flexShrink: 0,
  },
  coverImg: {
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
  title: {
    margin: `0 0 ${theme.space.xs}`,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.color.text.primary,
  },
  author: {
    color: theme.color.text.secondary,
    marginBottom: theme.space.sm,
  },
  series: {
    fontSize: theme.fontSize.md,
    marginBottom: theme.space.sm,
    color: theme.color.text.secondary,
    // position: 'absolute',
    // top: '8px',
    // right: 0,
    // cursor: 'pointer',
  },
  description: {
    color: '#585863', // book-description-specific shade
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
}));
