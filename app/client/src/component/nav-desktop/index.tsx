import cx from 'classnames';
import { Link } from 'react-router';

import type { NavItem } from '../nav/types';
import { useStyle } from './style';

export interface NavDesktopProps {
  items: NavItem[];
}

// Wide navigation bar pinned to the top of the viewport (desktop only). The active
// link is marked with a gray underline. Hidden below the mobile breakpoint.
export const NavDesktop = ({ items }: NavDesktopProps) => {
  const styles = useStyle();

  return (
    <header className={styles.root}>
      <nav className={styles.items}>
        {items.map(({ to, label, Icon, active, badge }) => (
          <Link
            key={to}
            className={cx(styles.item, { [styles.active]: active })}
            aria-current={active ? 'page' : undefined}
            to={to}
          >
            {/* The icon and its badge share a positioned wrapper so the badge
                can sit on the icon's upper-right corner, the way an app badge
                does. Anchoring to the whole item instead would pin it to the
                item's corner — past the end of the label. */}
            <span className={styles.iconWrap}>
              <Icon height={14} width={14} />
              {typeof badge === 'number' && badge > 0 && (
                <span className={styles.badge}>{badge}</span>
              )}
              {badge === 'dot' && <span className={styles.badgeDot} data-testid="nav-badge-dot" />}
            </span>
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
};
