import cx from 'classnames';
import type { ReactNode } from 'react';

import { useStyle } from './style';

export type MetaLineProps = {
  /** The data to show, in order. Falsy entries are skipped. */
  items: ReactNode[];
  /** Applied to the outer element; the font size and colour set here reach every item. */
  className?: string;
};

/**
 * A row's secondary line: a few short data ("Frank Herbert", "Book 3", "42%")
 * separated by middots. When the line is too narrow for all of them, it wraps
 * between data, never inside one, and no separator is left dangling at the end
 * of a line or leading the next.
 *
 * The separators are CSS, not text: each item draws its own leading "·" in a
 * fixed-width cell, the list is shifted left by one cell and the overflow
 * clipped. Whichever item starts a line, its separator is the one hidden —
 * which is exactly the one that should not show. Keeping them out of the DOM
 * also means screen readers read the data, not the punctuation.
 */
export const MetaLine = ({ items, className }: MetaLineProps) => {
  const styles = useStyle();
  const present = items.filter((item) => item !== null && item !== undefined && item !== false);
  if (present.length === 0) {
    return null;
  }
  return (
    <div className={cx(styles.root, className)}>
      <div className={styles.list}>
        {present.map((item, i) => (
          <span key={i} className={styles.item} data-testid="meta-item">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
};
