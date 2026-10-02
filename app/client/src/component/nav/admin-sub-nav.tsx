import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { SegmentedControl } from '~/control';
import { path } from '~/router';

const OPTIONS = [
  { value: 'users', label: 'Users' },
  { value: 'devices', label: 'Devices' },
];

/**
 * The Admin tab's second level, shown above the mobile capsule.
 *
 * Mobile only. Desktop keeps Users and Devices as top-level items, so there is
 * nothing for this to pick between there — it is rendered by `NavMobile` and
 * never by `NavDesktop`.
 *
 * Navigation, not mirrored state: the value is DERIVED from the pathname and
 * `onChange` navigates, so nothing can fall out of sync with the URL and the
 * back button works between the two. This is the same shape the Add page's
 * Upload/Request toggle had before those two became their own nav items —
 * that file is gone, and this is the pattern moving up a level rather than a
 * copy of it.
 */
export const AdminSubNav = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const value = pathname === path.devices() ? 'devices' : 'users';
  const handleChange = useCallback(
    (next: string) => navigate(next === 'devices' ? path.devices() : path.userList()),
    [navigate]
  );
  return (
    <SegmentedControl
      name="Admin section"
      value={value}
      options={OPTIONS}
      onChange={handleChange}
      // `page`, matching the capsule's own `radius.pill` family rather than
      // the squarer `card` default: this sits on the page, directly above a
      // fully rounded capsule, not inset in a card.
      surface="page"
    />
  );
};
