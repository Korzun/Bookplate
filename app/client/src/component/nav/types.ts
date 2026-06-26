import type { ReactElement } from 'react';

import type { IconProps } from '~/icon';

/** A single navigation destination, shared by the desktop and mobile layouts. */
export interface NavItem {
  to: string;
  label: string;
  Icon: (props: IconProps) => ReactElement;
  active: boolean;
}
