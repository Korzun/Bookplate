import cx from 'classnames';
import { Link, useLocation } from 'react-router-dom';

import { LibrarySwitcher } from '~/component/library-switcher';
import { BookIcon, UploadIcon, UserIcon, UsersIcon } from '~/icon';
import { useIsAdmin } from '~/provider/auth';
import { path } from '~/router';

import { useStyle } from './style';

export const Header = () => {
  const [isAdmin] = useIsAdmin();
  const styles = useStyle();
  const { pathname } = useLocation();

  return (
    <header className={styles.root}>
      <svg className={styles.noise} aria-hidden="true">
        <filter id="header-noise">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.75"
            numOctaves="4"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#header-noise)" />
      </svg>
      <nav className={styles.navigation}>
        <div className={styles.navigationItemContainer}>
          <Link
            className={cx(styles.navigationItem, {
              [styles.active]: pathname.startsWith(path.library()),
            })}
            to={path.library()}
          >
            <BookIcon height={14} width={14} />
            Library
          </Link>
          <Link
            className={cx(styles.navigationItem, {
              [styles.active]: pathname === path.upload(),
            })}
            to={path.upload()}
          >
            <UploadIcon height={14} width={14} />
            Upload
          </Link>
          {isAdmin && (
            <Link
              className={cx(styles.navigationItem, {
                [styles.active]: pathname === path.userList(),
              })}
              to={path.userList()}
            >
              <UsersIcon height={14} width={14} />
              Users
            </Link>
          )}
          <Link
            className={cx(styles.navigationItem, {
              [styles.active]: pathname === path.user(),
            })}
            to={path.user()}
          >
            <UserIcon height={14} width={14} />
            Profile
          </Link>
        </div>
        <LibrarySwitcher />
      </nav>
    </header>
  );
};
