import cx from 'classnames';
import { useCallback } from 'react';

import { SpinnerIcon } from '~/icon';

import { ButtonType, ButtonTypeValue, useStyle } from './style';

type ButtonProps = React.PropsWithChildren<{
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  tabIndex?: number;
  title?: string;
  type?: ButtonTypeValue;
}>;
export const Button = ({
  children,
  danger = false,
  disabled = false,
  loading = false,
  onClick = () => {},
  tabIndex,
  title,
  type = ButtonType.Default as ButtonTypeValue,
}: ButtonProps) => {
  const styles = useStyle();
  const className = cx(
    styles.root,
    styles[type],
    { [styles.danger]: danger },
    { [styles.loading]: loading },
    { [styles.disabled]: disabled }
  );

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      if (!disabled && !loading) {
        event.stopPropagation();
        onClick();
      }
    },
    [loading, disabled, onClick]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.stopPropagation();
        onClick();
      }
    },
    [onClick]
  );

  return (
    <div
      role="button"
      tabIndex={tabIndex}
      className={className}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      title={title}
    >
      {loading && <SpinnerIcon className={styles.spinner} />}
      {children}
    </div>
  );
};

export type { ButtonTypeValue };
