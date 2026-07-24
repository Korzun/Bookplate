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
  // stretches the Change password button back across the card, matching the fields.
  form: {
    display: 'flex',
    flexDirection: 'column',
  },
  inputContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
    marginBottom: theme.space.xxl,
    marginTop: theme.space.xxl,
    minWidth: '400px',
    [theme.breakpoint.mobile]: {
      minWidth: 'auto',
    },
  },
  title: {
    margin: `0 0 ${theme.space.xxxxl}`,
    fontSize: theme.fontSize.xl,
    color: theme.color.text.primary,
    fontWeight: theme.fontWeight.semibold,
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
    justifyContent: 'center',
  },
  banner: {
    textAlign: 'center',
    color: theme.color.danger.default,
    fontWeight: theme.fontWeight.semibold,
    fontSize: theme.fontSize.md,
  },
}));
