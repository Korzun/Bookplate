import cx from 'classnames';

import { useStyle } from './style';

export interface PageActionItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  primary?: boolean;
  align?: 'leading' | 'trailing';
}

export type ActionMenuSurface = 'solid' | 'glass';

interface ActionMenuListProps {
  items: PageActionItem[];
  surface: ActionMenuSurface;
  onSelect: (item: PageActionItem) => void;
}

export function ActionMenuList({ items, surface, onSelect }: ActionMenuListProps) {
  const styles = useStyle();
  const regular = items.filter((item) => !item.danger);
  const danger = items.filter((item) => item.danger);

  const renderItem = (item: PageActionItem) => (
    <button
      key={item.label}
      type="button"
      role="menuitem"
      className={cx(styles.item, { [styles.itemDanger]: item.danger })}
      disabled={item.disabled}
      onClick={() => onSelect(item)}
    >
      {item.label}
    </button>
  );

  return (
    <div className={cx(styles.popover, styles[surface])} role="menu">
      {regular.map(renderItem)}
      {danger.length > 0 && regular.length > 0 && (
        <div className={styles.separator} role="separator" />
      )}
      {danger.map(renderItem)}
    </div>
  );
}
