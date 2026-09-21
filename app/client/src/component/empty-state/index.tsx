import cx from 'classnames';
import type { ReactNode } from 'react';

import { useStyle } from './style';

export type EmptyStateProps = {
  /** The one line that says what is not here. */
  title: string;
  /** The optional second line: what to do about it, or why it is empty. */
  children?: ReactNode;
  /** Tints the title — for a load FAILURE, not for an honestly empty list. */
  danger?: boolean;
};

/**
 * The centred "nothing here" block a page shows in place of a list.
 *
 * This exists because a list's empty/loading/error text has to read
 * differently depending on whether it sits INSIDE a `Card` or directly on the
 * page. Inside a card, a plain left-aligned line is right — it is one line of
 * card content, indented and bounded like every other. Rendered bare on a
 * page it has nothing around it, and reads as stray text jammed against the
 * left edge, which is exactly what `/add/request` shipped with when its
 * `Card` wrapper was dropped in the add-page reorg.
 */
export const EmptyState = ({ title, children, danger = false }: EmptyStateProps) => {
  const styles = useStyle();

  return (
    <div className={styles.root}>
      <div className={cx(styles.title, { [styles.danger]: danger })}>{title}</div>
      {children !== undefined && <div className={styles.subtitle}>{children}</div>}
    </div>
  );
};
