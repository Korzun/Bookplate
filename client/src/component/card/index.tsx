import cx from 'classnames';
import { PropsWithChildren, ReactNode, ReactElement, useCallback } from 'react';

import { useStyle } from './style';

export type Props = PropsWithChildren<{
  className?: string;
  headerAction?: ReactNode | ReactElement[];
  onClick?: () => void;
  onClickHeader?: () => void;
  size?: 'small' | 'large';
  subTitle?: string;
  title?: string | ReactNode;
}>;
export const Card = ({
  children,
  className,
  headerAction,
  onClick,
  onClickHeader,
  size = 'large',
  subTitle,
  title,
}: Props) => {
  const style = useStyle();

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        if (onClick) {
          onClick();
        }
      }
    },
    [onClick]
  );

  return (
    <div
      className={cx(style.root, style[size], className, {
        [style.clickable]: onClick !== undefined,
      })}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      {(title || subTitle || headerAction || onClickHeader) && (
        <div
          className={cx(style.header, {
            [style.collapsed]: !children,
            [style.clickable]: onClickHeader !== undefined,
          })}
          onClick={onClickHeader ?? undefined}
        >
          {title && <div className={style.title}>{title}</div>}
          {subTitle && <div className={style.subTitle}>{subTitle}</div>}
          <div className={style.spacer} />
          {headerAction}
        </div>
      )}
      {children && <div className={cx(style.content, style[size])}>{children}</div>}
    </div>
  );
};
