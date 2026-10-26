import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  /**
   * The shaded input row — `bg.cardHeader` + `radius.md`, the label inset on
   * the left with `TextInput.horizontal`'s offsets — built here because there
   * is no shared recipe for the shape yet (see `notification-settings`'
   * `eventRow`, which repeats it for the same reason). The picker paints no
   * track of its own (`surface="row"`), so this grey IS the track and only the
   * lens shows, where `TextInput` shows its white field. The row is taller
   * than a text row, so the label is centred rather than top-aligned. At phone
   * width it becomes the `vertical` form of the same panel: label above the
   * picker, inside the grey.
   */
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
    overflow: 'hidden',
    backgroundColor: theme.color.bg.cardHeader,
    borderRadius: theme.radius.md,
    // The picker's children size it; `minWidth: 0` lets it shrink to the row.
    '& > [role="radiogroup"]': { flexGrow: 1, minWidth: 0 },
    [theme.breakpoint.mobile]: {
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: theme.space.xs,
    },
  },
  label: {
    ...theme.recipe.label,
    marginLeft: theme.space.sm,
    minWidth: '6rem',
    [theme.breakpoint.mobile]: {
      marginLeft: theme.space.md,
      marginTop: theme.space.xs,
    },
  },
  details: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
}));
