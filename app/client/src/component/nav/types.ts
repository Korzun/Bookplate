import type { ReactElement } from 'react';

import type { IconProps } from '~/icon';

/** A single navigation destination, shared by the desktop and mobile layouts. */
export interface NavItem {
  to: string;
  label: string;
  Icon: (props: IconProps) => ReactElement;
  active: boolean;
  /** A count of pending fixes, or `'dot'` for "active, nothing to decide yet". */
  badge?: number | 'dot';
}
