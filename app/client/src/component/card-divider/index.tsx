import type { ReactNode } from 'react';

import { useStyle } from './style';

export type CardDividerProps = {
  // Optional label shown at the left of the rule. Without it the divider is a plain line.
  children?: ReactNode;
};

export const CardDivider = ({ children }: CardDividerProps) => {
  const style = useStyle();
  return (
    <div className={style.root} role="separator">
      {children ? <span className={style.label}>{children}</span> : null}
      <span className={style.line} />
    </div>
  );
};
