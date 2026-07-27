import cx from 'classnames';
import { Fragment } from 'react';

import { useStyle } from './style';

export interface PageActionItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  primary?: boolean;
  align?: 'leading' | 'trailing';
  /** Render a divider immediately above this item (ignored on the first item),
   * grouping it apart from the items before it. `danger` only affects styling,
   * not grouping — a caller that wants a destructive item set off must say so
   * explicitly here. */
  separatorBefore?: boolean;
}

export type ActionMenuSurface = 'solid' | 'glass';

interface ActionMenuListProps {
  items: PageActionItem[];
  surface: ActionMenuSurface;
  onSelect: (item: PageActionItem) => void;
}

export function ActionMenuList({ items, surface, onSelect }: ActionMenuListProps) {
  const styles = useStyle();

  return (
    <div className={cx(styles.popover, styles[surface])} role="menu">
      {items.map((item, index) => (
        <Fragment key={item.label}>
          {item.separatorBefore && index > 0 && (
            <div className={styles.separator} role="separator" />
          )}
          <button
            type="button"
            role="menuitem"
            className={cx(styles.item, { [styles.itemDanger]: item.danger })}
            disabled={item.disabled}
            onClick={() => onSelect(item)}
          >
            {item.label}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
