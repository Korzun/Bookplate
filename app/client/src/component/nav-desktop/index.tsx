import cx from 'classnames';
import { Link } from 'react-router-dom';

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
      <svg className={styles.noise} aria-hidden="true">
        <filter id="nav-desktop-noise">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.75"
            numOctaves="4"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#nav-desktop-noise)" />
      </svg>
      <nav className={styles.items}>
        {items.map(({ to, label, Icon, active }) => (
          <Link
            key={to}
            className={cx(styles.item, { [styles.active]: active })}
            aria-current={active ? 'page' : undefined}
            to={to}
          >
            <Icon height={14} width={14} />
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
};
