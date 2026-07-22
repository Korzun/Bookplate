import cx from 'classnames';
import type { ReactNode } from 'react';

import { useStyle } from './style';

export type CardDividerAlign = 'left' | 'center' | 'right';

export type CardDividerProps = {
  // Optional label. Without it the divider is a plain full-width line and `align` is ignored.
  children?: ReactNode;
  // Where the label sits. Left/right leave a small stub of line poking past the label
  // toward that edge; center puts equal line on both sides. Only applies with a label.
  align?: CardDividerAlign;
};

export const CardDivider = ({ children, align = 'left' }: CardDividerProps) => {
  const style = useStyle();

  if (!children) {
    return (
      <div className={style.root} role="separator">
        <span className={style.line} />
      </div>
    );
  }

  return (
    <div className={cx(style.root, style[align])} role="separator">
      <span className={cx(style.line, style.lineStart)} />
      <span className={style.label}>{children}</span>
      <span className={cx(style.line, style.lineEnd)} />
    </div>
  );
};
