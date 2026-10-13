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
  // Matches the login card's field column, so moving between the two screens
  // does not resize the card — and holds whichever state is showing.
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
  // Only the done-state confirmation now; the form no longer carries a lead.
  lead: {
    textAlign: 'center',
    color: theme.color.text.muted,
    fontSize: theme.fontSize.sm,
    margin: 0,
  },
  error: {
    textAlign: 'center',
    color: theme.color.danger.default,
    fontSize: theme.fontSize.sm,
    margin: 0,
  },
}));
