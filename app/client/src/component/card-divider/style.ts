import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    // Full-bleed: cancel the card body padding so the rule meets the card borders.
    marginLeft: `-${theme.space.xl}`,
    marginRight: `-${theme.space.xl}`,
    display: 'flex',
    alignItems: 'center',
    // Reserve the label's line height so the divider takes the same vertical space
    // with or without a label.
    minHeight: `calc(${theme.fontSize.md} * ${theme.lineHeight.body})`,
  },
  line: {
    // Grows by default (fills a side / the whole width when there's no content).
    flexGrow: 1,
    height: '1px',
    backgroundColor: theme.color.border.strong,
  },
  // A line segment that hugs an edge: a short fixed stub instead of growing, so
  // content pinned to that side pokes past it toward the border.
  stub: {
    flexGrow: 0,
    flexShrink: 0,
    width: theme.space.md,
  },
  // Wraps the content at a position (label and/or actions). Padding separates it
  // from the flanking lines; the gap spaces stacked label + actions.
  group: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.space.md,
    padding: `0 ${theme.space.md}`,
    flexShrink: 0,
  },
  label: {
    // Same colour as the toggle helper text, a step larger so it reads as a heading.
    fontSize: theme.fontSize.md,
    lineHeight: theme.lineHeight.body,
    color: theme.color.text.faint,
    whiteSpace: 'nowrap',
  },
  actions: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.space.md,
  },
}));
