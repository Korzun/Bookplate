import cx from 'classnames';
import { PropsWithChildren, useCallback } from 'react';

import { useStyle } from './style';

export type CardRowProps = PropsWithChildren<{
  onClick?: () => void;
}>;
export const CardRow = ({ children, onClick }: CardRowProps) => {
  const styles = useStyle();

  const handleBookKeyDown = useCallback(
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
      className={cx(styles.root, { [styles.clickable]: onClick !== undefined })}
      onClick={onClick}
      onKeyDown={handleBookKeyDown}
    >
      {children}
    </div>
  );
};
