import { useCallback, useRef, useState } from 'react';

import { ActionMenuList, type PageActionItem } from '../action-menu-list';
import { useDismiss } from '../action-menu-list/use-dismiss';
import { Button } from '../button';

import { useStyle } from './style';

interface PageActionsBarProps {
  items: PageActionItem[];
}

export function PageActionsBar({ items }: PageActionsBarProps) {
  const styles = useStyle();
  const [open, setOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, moreRef);

  const primary = items.filter((item) => item.primary);
  const leading = primary.filter((item) => item.align === 'leading');
  const trailing = primary.filter((item) => item.align !== 'leading');
  const overflow = items.filter((item) => !item.primary);

  const handleSelect = useCallback((item: PageActionItem) => {
    setOpen(false);
    item.onClick();
  }, []);

  const renderButton = (item: PageActionItem) => (
    <Button key={item.label} onClick={item.onClick} disabled={item.disabled} danger={item.danger}>
      {item.label}
    </Button>
  );

  return (
    <div className={styles.root}>
      {leading.map(renderButton)}
      <div className={styles.spacer} />
      {trailing.map(renderButton)}
      {overflow.length > 0 && (
        <div className={styles.more} ref={moreRef}>
          <button
            type="button"
            className={styles.moreTrigger}
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            More…
          </button>
          {open && (
            <div className={styles.popoverAnchor}>
              <ActionMenuList items={overflow} surface="solid" onSelect={handleSelect} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
