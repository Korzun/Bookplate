import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  // A native <button> shrink-wraps its content even at `display: flex`, unlike
  // the div the Button renders outside submit mode. Making the form a column
  // stretches the Register button back across the card, matching the field.
  form: {
    display: 'flex',
    flexDirection: 'column',
  },
  inputContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  submit: {
    marginTop: theme.space.xxl,
  },
}));
