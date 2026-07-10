import cx from 'classnames';
import { useCallback, useEffect, useRef, useState } from 'react';

import { MoreIcon } from '~/icon';

import { useStyle } from './style';

export interface PageActionItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface PageActionsMenuProps {
  items: PageActionItem[];
}

export function PageActionsMenu({ items }: PageActionsMenuProps) {
  const styles = useStyle();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleItemClick = useCallback((item: PageActionItem) => {
    if (item.disabled) {
      return;
    }
    setOpen(false);
    item.onClick();
  }, []);

  return (
    <div className={styles.root} ref={containerRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreIcon width={20} height={20} aria-hidden="true" />
      </button>
      {open && (
        <div className={styles.popover} role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={cx(styles.item, { [styles.itemDanger]: item.danger })}
              disabled={item.disabled}
              onClick={() => handleItemClick(item)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
