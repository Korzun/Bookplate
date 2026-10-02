import { createUseStyles, type Theme } from '~/provider/theme';

/**
 * Named for what the switch SITS IN rather than for a size, matching
 * `ButtonRadius`: a caller knows its own surroundings, not which step of the
 * radius scale suits a 16px-tall track.
 *
 * Deliberately two values, where `ButtonRadius` has four. A switch's track is
 * 16px tall, so any radius of 8px or more clamps to a full pill — `card`
 * (`radius.md`) and `pill` would be the same shape, named twice, and could
 * never diverge while the track keeps that height.
 */
export type SwitchRadiusValue = 'inset' | 'pill';
export enum SwitchRadius {
  /**
   * Concentric with the shaded input row the switch sits in: 16px card, 8px
   * row, 4px track, 2px thumb. The default, because that row is where every
   * switch in this app currently lives.
   */
  Inset = 'inset',
  /**
   * The classic capsule, and the rule for a switch in a CARD HEADER.
   *
   * Not about shading — a card header is painted `bg.cardHeader`, the same
   * colour as the input row. It is about whether there is anything nearby to
   * be concentric WITH. An input row is a small rounded rectangle wrapping the
   * switch, so a 4px track echoes its 8px corner a few pixels away. A card
   * header is a full-width bar whose only corners are the card's own, far off
   * at either end: nothing for the track to relate to, so it reads better as a
   * self-contained control than as a square-ish chip floating in a bar.
   */
  Pill = 'pill',
}

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'inline-flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: theme.space.xs,
    cursor: 'pointer',
    userSelect: 'none',
    '-webkit-user-select': 'none',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
  },
  description: {
    // Indent under the label (past the 28px track + row gap) so it reads as
    // helper text for this toggle rather than a separate row.
    marginLeft: `calc(28px + ${theme.space.md})`,
    fontSize: theme.fontSize.sm,
    // Dedicated description colour — darker than faint for readable helper text,
    // especially on the shaded background of the horizontal layout.
    color: theme.color.text.description,
    cursor: 'auto',
  },
  track: {
    position: 'relative',
    width: '28px',
    height: '16px',
    backgroundColor: theme.color.border.default,
    ...theme.recipe.focusRing,
    transitionProperty: 'background-color, outline-color',
    transitionDuration: '0.1s',
    transitionTimingFunction: 'ease-in',
    '$root:hover &': { outlineColor: theme.color.brand.outline },
    '$root:focus &': { outlineColor: theme.color.brand.outline },
    '&$checked': { backgroundColor: theme.color.brand.default },
    '&$disabled': { opacity: 0.4, cursor: 'not-allowed' },
  },
  thumb: {
    position: 'absolute',
    top: '2px',
    left: '2px',
    width: '12px',
    height: '12px',
    backgroundColor: theme.color.bg.input,
    transitionProperty: 'left',
    transitionDuration: '0.1s',
    transitionTimingFunction: 'ease-in',
    '$checked &': { left: '14px' },
  },
  /**
   * Each value sets the track AND its thumb together, because the two are not
   * independent: the thumb is inset 2px on every side, so a concentric thumb
   * is always the track's radius less that inset. Splitting them into two
   * props would let a caller produce a square thumb in a capsule track.
   */
  [SwitchRadius.Inset]: {
    borderRadius: theme.radius.sm,
    // Arithmetic rather than a token so it follows the track automatically if
    // that radius ever changes — and because the scale has no 2px step.
    '& $thumb': { borderRadius: `calc(${theme.radius.sm} - 2px)` },
  },
  [SwitchRadius.Pill]: {
    borderRadius: theme.radius.pill,
    '& $thumb': { borderRadius: theme.radius.circle },
  },

  label: {
    ...theme.recipe.label,
  },
  content: {},
  horizontal: {
    // Two columns: content (label + description) on the left, toggle on the right.
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    width: '100%',
    backgroundColor: theme.color.bg.cardHeader,
    borderRadius: theme.radius.md,
    padding: `${theme.space.md} ${theme.space.lg} ${theme.space.md} ${theme.space.sm}`,
    '& $content': {
      display: 'flex',
      flexDirection: 'column',
      gap: theme.space.xs,
      flexGrow: 1,
      minWidth: 0,
    },
    '& $label': {
      // Left-aligned to the same edge as the other fields' labels.
      textAlign: 'left',
    },
    '& $description': {
      margin: 0,
      // The whole shaded row toggles, so the description shows the toggle cursor too.
      cursor: 'pointer',
    },
    '& $track': {
      // Kept in its own column so the description never runs beneath it.
      flexShrink: 0,
    },
  },
  checked: {},
  disabled: {},
  danger: {},
}));
