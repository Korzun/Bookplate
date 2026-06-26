import { useLocation } from 'react-router-dom';

import { BookIcon, SettingsIcon, UploadIcon, UsersIcon } from '~/icon';
import { useIsAdmin } from '~/provider/auth';
import { path } from '~/router';

import { NavDesktop } from '../nav-desktop';
import { NavMobile } from '../nav-mobile';

import type { NavItem } from './types';

// Owns the navigation destinations (which links exist, which is active, admin
// gating) and renders both layouts. Each layout hides itself at the wrong
// breakpoint via CSS, so only one is ever visible (and in the accessibility tree).
export const Nav = () => {
  const [isAdmin] = useIsAdmin();
  const { pathname } = useLocation();

  const items: NavItem[] = [
    {
      to: path.library(),
      label: 'Library',
      Icon: BookIcon,
      active: pathname.startsWith(path.library()),
    },
    {
      to: path.upload(),
      label: 'Upload',
      Icon: UploadIcon,
      active: pathname === path.upload(),
    },
    ...(isAdmin
      ? [
          {
            to: path.userList(),
            label: 'Users',
            Icon: UsersIcon,
            active: pathname === path.userList(),
          },
        ]
      : []),
    {
      to: path.user(),
      label: 'Settings',
      Icon: SettingsIcon,
      active: pathname === path.user(),
    },
  ];

  return (
    <>
      <NavDesktop items={items} />
      <NavMobile items={items} />
    </>
  );
};
