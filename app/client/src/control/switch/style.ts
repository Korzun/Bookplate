import { createUseStyles, type Theme } from '~/provider/theme';

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
    // CONCENTRIC with what this sits in, not a pill. A switch always appears
    // inside the shaded input row (`horizontal` below, and the notification
    // matrix's copy of it), which is itself inside a card: 16px card, 8px
    // row, 4px track, each step roughly halving. `radius.md` — what this was
    // — is 8px against a 16px-tall track, i.e. exactly half the height, so it
    // clamped to a full pill and read as a different family of shape from
    // every rounded rectangle around it.
    borderRadius: theme.radius.sm,
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
    // The concentric rule one level further in: the thumb is inset 2px from
    // the track on every side, so its radius is the track's less that inset.
    // Expressed as arithmetic rather than a token because that is what makes
    // it follow the track automatically if the track's radius ever changes —
    // and because there is no 2px step on the scale.
    borderRadius: `calc(${theme.radius.sm} - 2px)`,
    backgroundColor: theme.color.bg.input,
    transitionProperty: 'left',
    transitionDuration: '0.1s',
    transitionTimingFunction: 'ease-in',
    '$checked &': { left: '14px' },
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
