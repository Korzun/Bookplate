import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    // Full-bleed: cancel the card body padding so the rule meets the card borders.
    marginLeft: `-${theme.space.xl}`,
    marginRight: `-${theme.space.xl}`,
    display: 'flex',
    alignItems: 'center',
  },
  line: {
    // Grows by default (fills a side / the whole width when there's no label).
    flexGrow: 1,
    height: '1px',
    backgroundColor: theme.color.border.strong,
  },
  lineStart: {},
  lineEnd: {},
  label: {
    padding: `0 ${theme.space.md}`,
    // Same colour as the toggle helper text, a step larger so it reads as a heading.
    fontSize: theme.fontSize.md,
    color: theme.color.text.faint,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  // Left/right: the label hugs that edge with a short stub of line poking past it;
  // the opposite line fills the rest. Center leaves both lines growing equally.
  left: {
    '& $lineStart': { flexGrow: 0, flexShrink: 0, width: theme.space.md },
  },
  center: {},
  right: {
    '& $lineEnd': { flexGrow: 0, flexShrink: 0, width: theme.space.md },
  },
}));
