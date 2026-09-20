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
  card: {
    [theme.breakpoint.mobile]: {
      width: '100%',
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
  lead: {
    textAlign: 'center',
    color: theme.color.text.muted,
    fontSize: theme.fontSize.sm,
    margin: `0 0 ${theme.space.xxl}`,
  },
  error: {
    textAlign: 'center',
    color: theme.color.danger.default,
    fontSize: theme.fontSize.sm,
    margin: 0,
  },
  link: {
    textAlign: 'center',
    fontSize: theme.fontSize.sm,
    marginTop: theme.space.md,
  },
}));
