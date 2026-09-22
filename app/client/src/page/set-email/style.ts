import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    minHeight: '100vh',
    backgroundColor: theme.color.bg.page,
    padding: `0 ${theme.space.xxl}`,
    [theme.breakpoint.mobile]: {
      padding: `0 ${theme.space.xxl}`,
    },
  },
  // Holds the card and the secondary button below it. The root centres its
  // children, so this column shrink-wraps to the card's own width and the
  // stretched button beneath it lands exactly card-wide.
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xxl,
    [theme.breakpoint.mobile]: {
      width: '100%',
    },
  },
  // Matches the login card's field column, so moving between these screens
  // does not resize the card — and holds whichever stage is showing. On the
  // wrapper rather than the form so the two stages, which carry a different
  // number of fields and lines of copy, come out the same width.
  content: {
    minWidth: '400px',
    [theme.breakpoint.mobile]: {
      minWidth: 'auto',
    },
  },
  // A native <button> shrink-wraps its content even at `display: flex`, unlike
  // the div the Button renders outside submit mode. Making the form a column
  // stretches the submit button back across the card, matching the fields.
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  // Only the address stage now; the code stage no longer carries a lead.
  lead: {
    textAlign: 'center',
    color: theme.color.text.muted,
    fontSize: theme.fontSize.sm,
    margin: `0 0 ${theme.space.xxl}`,
  },
}));
