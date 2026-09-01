import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { SegmentedControl } from '~/control';
import { path } from '~/router';

const OPTIONS = [
  { value: 'upload', label: 'Upload' },
  { value: 'request', label: 'Request' },
];

/**
 * Navigation, not mirrored state: the value is DERIVED from the pathname and
 * `onChange` navigates, so there is no local state that can fall out of sync
 * with the URL and the back button works between the two views.
 */
export const AddToggle = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const value = pathname === path.addRequest() ? 'request' : 'upload';
  const handleChange = useCallback(
    (next: string) => navigate(next === 'request' ? path.addRequest() : path.add()),
    [navigate]
  );
  return (
    <SegmentedControl name="Add mode" value={value} options={OPTIONS} onChange={handleChange} />
  );
};
