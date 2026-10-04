import { createUseStyles, type Theme } from '~/provider/theme';

/**
 * Shared by the header cell and the toggle cell so the two columns cannot
 * drift apart — and kept as close to the longest channel header ("Email",
 * ~34px at `fontSize.sm`) as that allows.
 *
 * The slack between this and the 28px switch inside it is dead space to the
 * LEFT of every toggle, because both cells align right. It therefore adds to
 * the gap between the two columns on top of `toggleGroup`'s own: at the 3rem
 * this started as, two adjacent toggles sat 28px apart while their headers
 * sat the same 28px apart, which read as two unrelated controls rather than
 * one row. Narrowing it to 2.25rem halves that without letting "Email" touch
 * its neighbour. If a platform's system-ui renders that header wider than
 * this, it overflows left rather than clipping, and the right edge the
 * column is aligned on stays correct.
 */
const TOGGLE_CELL_WIDTH = '2.25rem';

export const useStyle = createUseStyles((theme: Theme) => ({
  /**
   * `Card`'s content has padding but no gap between its children, so every
   * card supplies its own — `device-form` wraps its whole body in exactly
   * this (a flex column at `space.md`), which is what gives its `CardDivider`s
   * room. Without it the divider butts straight against the control above and
   * the list below.
   */
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  hint: {
    margin: 0,
    marginBottom: theme.space.md,
    color: theme.color.text.description,
    fontSize: theme.fontSize.sm,
  },
  matrix: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.sm,
  },
  /**
   * Unshaded, and padded on the right by the SAME amount as a row, so its
   * labels sit directly over the toggles rather than near them. Each header
   * cell is the width of a toggle cell, so the two track each other by
   * construction instead of by eye.
   */
  headerRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: theme.space.md,
    paddingRight: theme.space.lg,
  },
  headerCell: {
    width: TOGGLE_CELL_WIDTH,
    // RIGHT, not centre, for the same reason `toggleCell` is: the cell is
    // wider than a toggle, so centring left the last toggle 10px further from
    // the row's edge than the single-toggle row below it. Aligning both ends
    // to the same edge keeps the column reading as a column AND puts the last
    // toggle exactly where `Switch.horizontal` puts its own.
    textAlign: 'right',
    color: theme.color.text.description,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  /**
   * One shaded row per event — the same row every other toggle and input on
   * this page sits in. `Switch`'s `horizontal` layout and `TextInput`'s build
   * it from exactly these two values (`bg.cardHeader` + `radius.md`), and this
   * repeats them because there is no shared recipe for the shape yet. The
   * padding is `Switch.horizontal`'s verbatim, so a two-toggle row here lines
   * up with the single-toggle row in the card below.
   */
  eventRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space.md,
    backgroundColor: theme.color.bg.cardHeader,
    borderRadius: theme.radius.md,
    padding: `${theme.space.md} ${theme.space.lg} ${theme.space.md} ${theme.space.sm}`,
  },
  /**
   * The SAME recipe `Switch` and `TextInput` give their own labels, not a
   * hand-set colour: these rows sit directly above and below those controls,
   * so anything else reads as a different kind of thing. Inheriting body text
   * (what this did before) made them larger and darker than every other row
   * label on the page.
   */
  eventLabel: {
    ...theme.recipe.label,
  },
  toggleGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
  },
  /** Fixed width so an empty cell still holds its column. See `headerCell`. */
  toggleCell: {
    width: TOGGLE_CELL_WIDTH,
    display: 'flex',
    justifyContent: 'flex-end',
  },
  deviceList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.sm,
  },
  device: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space.md,
  },
  /**
   * The same recipe every other row label on this page uses. Inheriting body
   * text left it 16px/500 in near-black — the largest, darkest text in either
   * card, and the only thing here not drawn from the shared label.
   */
  deviceName: {
    ...theme.recipe.label,
    display: 'inline',
  },
  thisDevice: {
    marginLeft: theme.space.sm,
    padding: `${theme.space.xxxs} ${theme.space.sm}`,
    borderRadius: theme.radius.md,
    fontSize: theme.fontSize.xs,
    color: theme.color.text.description,
    background: theme.color.bg.cardHeader,
  },
  deviceMeta: {
    display: 'block',
    marginTop: theme.space.xxxs,
    color: theme.color.text.muted,
    fontSize: theme.fontSize.sm,
  },
}));
