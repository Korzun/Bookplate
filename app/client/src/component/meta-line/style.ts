import { createUseStyles, type Theme } from '~/provider/theme';

/**
 * Width of one " · " separator cell. In `em` so it scales with whatever font
 * size the caller sets on the line. The list below is shifted left by exactly
 * this much and its overflow clipped, so the separator that leads the FIRST
 * item on every line (not just the first line) falls outside the box.
 */
const separatorWidth = '1em';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    overflow: 'hidden',
  },
  list: {
    display: 'flex',
    flexWrap: 'wrap',
    marginLeft: `-${separatorWidth}`,
  },
  item: {
    // A datum never breaks across lines: it wraps as a whole, or not at all.
    whiteSpace: 'nowrap',
    // A single datum wider than the whole line shrinks and ellipsizes rather
    // than pushing the row wider.
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    '&::before': {
      content: '"·"',
      display: 'inline-block',
      width: separatorWidth,
      textAlign: 'center',
      color: theme.color.text.muted,
    },
  },
}));
