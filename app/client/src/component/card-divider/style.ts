import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    // Full-bleed: cancel the card body padding so the rule meets the card borders.
    marginLeft: `-${theme.space.xl}`,
    marginRight: `-${theme.space.xl}`,
    display: 'flex',
    alignItems: 'center',
  },
  label: {
    // Left-aligned to the card's content edge, with a gap before the rule.
    paddingLeft: theme.space.xl,
    paddingRight: theme.space.md,
    // Same colour as the toggle helper text, a step larger so it reads as a heading.
    fontSize: theme.fontSize.md,
    color: theme.color.text.faint,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  line: {
    // Fills the remaining width to the right border; spans the whole width with no label.
    flexGrow: 1,
    height: '1px',
    backgroundColor: theme.color.border.strong,
  },
}));
