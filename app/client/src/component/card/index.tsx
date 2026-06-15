import cx from 'classnames';
import { PropsWithChildren, ReactNode, ReactElement, useCallback, useState } from 'react';

import { ChevronCircleIcon } from '~/icon';

import { useStyle } from './style';

export type Props = PropsWithChildren<{
  className?: string;
  defaultCollapsed?: boolean;
  headerAction?: ReactNode | ReactElement[];
  isCollapsible?: boolean;
  onClick?: () => void;
  onClickHeader?: () => void;
  size?: 'small' | 'large';
  subTitle?: string;
  title?: string | ReactNode;
}>;
export const Card = ({
  children,
  className,
  defaultCollapsed = true,
  headerAction,
  isCollapsible = false,
  onClick,
  onClickHeader,
  size = 'large',
  subTitle,
  title,
}: Props) => {
  const style = useStyle();
  const [isExpanded, setIsExpanded] = useState<boolean>(!defaultCollapsed);
  const handleToggle = useCallback(() => setIsExpanded((prev) => !prev), []);

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

  const handleHeaderKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!isCollapsible) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleToggle();
      }
    },
    [handleToggle, isCollapsible]
  );

  const visibleChildren = isCollapsible ? (isExpanded ? children : null) : children;

  return (
    <div
      className={cx(style.root, style[size], className, {
        [style.clickable]: onClick !== undefined,
      })}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      {(title || subTitle || headerAction || onClickHeader || isCollapsible) && (
        <div
          className={cx(style.header, {
            [style.collapsed]: !visibleChildren,
            [style.clickable]: onClickHeader !== undefined || isCollapsible,
          })}
          onClick={isCollapsible ? handleToggle : (onClickHeader ?? undefined)}
          onKeyDown={handleHeaderKeyDown}
          role={isCollapsible ? 'button' : undefined}
          tabIndex={isCollapsible ? 0 : undefined}
          aria-expanded={isCollapsible ? isExpanded : undefined}
        >
          {(title || subTitle) && (
            <div className={style.titleGroup}>
              {title &&
                (isCollapsible ? (
                  <div className={style.titleWrapper}>
                    <ChevronCircleIcon
                      className={cx(
                        style.chevron,
                        isExpanded ? style.chevronExpanded : style.chevronCollapsed
                      )}
                    />
                    <div className={style.title}>{title}</div>
                  </div>
                ) : (
                  <div className={style.title}>{title}</div>
                ))}
              {subTitle && <div className={style.subTitle}>{subTitle}</div>}
            </div>
          )}
          <div className={style.spacer} />
          {headerAction && (
            <div
              className={style.headerAction}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {headerAction}
            </div>
          )}
        </div>
      )}
      {visibleChildren && <div className={cx(style.content, style[size])}>{visibleChildren}</div>}
    </div>
  );
};
